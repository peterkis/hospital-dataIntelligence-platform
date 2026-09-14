-- P0-04: immutable file revisions carry format/policy, never a content SHA.
SELECT pg_advisory_xact_lock(901002);
ALTER TABLE governance_catalog.import_input_revision DROP CONSTRAINT import_input_revision_digest_status_check;
ALTER TABLE governance_catalog.import_input_revision ADD CONSTRAINT import_input_revision_digest_status_check CHECK(digest_status IN ('DECLARED','PROTECTED_REFERENCE'));
CREATE OR REPLACE FUNCTION governance_catalog.import_job_command(actor text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; sc text:=input->>'scope'; action text:=input->>'action'; req uuid;
 job governance_catalog.import_job; prior governance_catalog.import_input_revision;
 existing vnext_control.outcome; snapshot jsonb; effective jsonb; metadata jsonb:=input->'input';
 request_digest text; new_revision uuid:=uuidv7(); result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 PERFORM 1 FROM vnext_control.actor a WHERE a.code=actor FOR SHARE;
 PERFORM 1 FROM vnext_control.actor_grant g WHERE g.actor_code=actor AND g.scope=sc FOR SHARE;
 identity:=vnext_control.authorize(actor,sc,'WRITE');
 PERFORM vnext_control.authorize(actor,sc,'READ');
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR length(input::text)>4096 OR
  EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('action','scope','requestId','reason','contractId','contractVersionId','profile','jobId','expectedCurrentRevision','input')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 IF coalesce(action,'') NOT IN ('CREATE','REVISE') OR coalesce(input->>'requestId','') !~ '^[a-f0-9-]{36}$' OR
  jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR coalesce(input->>'reason','') !~ '^[A-Z_]{1,64}$' THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
 IF jsonb_typeof(metadata) IS DISTINCT FROM 'object' OR (
  (metadata->>'kind'='METADATA_ONLY' AND jsonb_typeof(metadata->'declaredSha256')='string' AND metadata->>'declaredSha256' ~ '^[a-f0-9]{64}$' AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(metadata) k WHERE k NOT IN ('kind','declaredSha256')))
  OR (metadata->>'kind'='FILE' AND metadata->>'format' IN ('CSV','JSON','XLSX') AND metadata->>'parserPolicy'='STRICT_V1' AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(metadata) k WHERE k NOT IN ('kind','format','parserPolicy')))
 ) IS NOT TRUE THEN RAISE EXCEPTION 'CLOSED_METADATA_REQUIRED'; END IF;
 req:=(input->>'requestId')::uuid;
 request_digest:=encode(sha256(convert_to(jsonb_build_object('operation','IMPORT_JOB', 'input',input)::text,'UTF8')),'hex');
 IF action='CREATE' THEN
  IF input ? 'jobId' OR input ? 'expectedCurrentRevision' OR coalesce(input->>'profile','') NOT IN ('CORE','FULL') OR
   coalesce(input->>'contractId','') !~ '^[a-f0-9-]{36}$' OR coalesce(input->>'contractVersionId','') !~ '^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'INVALID_CREATE'; END IF;
  -- Exact HISTORY is an owner call: current permissions apply even on replay.
  SELECT value INTO snapshot FROM jsonb_array_elements(governance_catalog.contract_read(actor,jsonb_build_object('scope',sc,'mode','HISTORY','target',input->>'contractId','versionId',input->>'contractVersionId'))) WHERE value->>'status'='PUBLISHED' ORDER BY (value->>'head')::bigint DESC LIMIT 1;
  IF snapshot IS NULL OR snapshot->>'profile'<>input->>'profile' THEN RAISE EXCEPTION 'EXACT_CONTRACT_UNAVAILABLE'; END IF;
  PERFORM governance_catalog.contract_require_access(actor,sc,(snapshot->>'versionId')::uuid,'WRITE');
 ELSE
  IF input ? 'contractId' OR input ? 'contractVersionId' OR input ? 'profile' OR coalesce(input->>'jobId','') !~ '^[a-f0-9-]{36}$' OR coalesce(input->>'expectedCurrentRevision','') !~ '^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'INVALID_REVISION'; END IF;
  SELECT * INTO job FROM governance_catalog.import_job WHERE id=(input->>'jobId')::uuid AND scope=sc FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF identity<>job.submitter_identity THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  PERFORM governance_catalog.contract_require_access(actor,sc,job.contract_version_id,'READ');
  PERFORM governance_catalog.contract_require_access(actor,sc,job.contract_version_id,'WRITE');
  snapshot:=job.contract_snapshot;
 END IF;
 SELECT o.* INTO existing FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=req;
 IF FOUND THEN
  IF existing.input_digest<>request_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
  RETURN existing.result;
 END IF;
 -- Current accepted version at the server's R and B. No fallback to an obsolete version.
 effective:=governance_catalog.contract_read(actor,jsonb_build_object('scope',sc,'mode','EFFECTIVE','target',snapshot->>'id','businessAt',to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US')))->0;
 IF effective IS NULL OR effective->>'versionId'<>snapshot->>'versionId' THEN RAISE EXCEPTION 'EXACT_CONTRACT_UNAVAILABLE'; END IF;
 IF action='CREATE' THEN
  INSERT INTO governance_catalog.import_job(scope,submitter_identity,contract_id,contract_version_id,profile,contract_snapshot,current_revision_id)
  VALUES(sc,identity,(snapshot->>'id')::uuid,(snapshot->>'versionId')::uuid,input->>'profile',snapshot,new_revision) RETURNING * INTO job;
 ELSE
  IF job.current_revision_id<>(input->>'expectedCurrentRevision')::uuid THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
  SELECT * INTO prior FROM governance_catalog.import_input_revision WHERE id=job.current_revision_id;
  IF prior.number>=1000 THEN RAISE EXCEPTION 'REVISION_LIMIT'; END IF;
  UPDATE governance_catalog.import_job SET current_revision_id=new_revision WHERE id=job.id;
 END IF;
 INSERT INTO governance_catalog.import_input_revision(id,job_id,number,previous_revision_id,metadata,metadata_digest,request_identity,request_id,digest_status)
 VALUES(new_revision,job.id,coalesce(prior.number,0)+1,prior.id,metadata,encode(sha256(convert_to(metadata::text,'UTF8')),'hex'),identity,req,CASE WHEN metadata->>'kind'='FILE' THEN 'PROTECTED_REFERENCE' ELSE 'DECLARED' END);
 result:=jsonb_build_object('id',job.id,'revisionId',new_revision,'revision', (coalesce(prior.number,0)+1)::text,'status','WAITING_INPUT','adapterReadiness','NOT_READY','digestStatus',CASE WHEN metadata->>'kind'='FILE' THEN 'PROTECTED_REFERENCE' ELSE 'DECLARED' END);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(actor,req,request_digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,actor);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,job.id,'IMPORT_JOB_'||action,input->>'reason',request_digest);
 RETURN result;
END $$;

-- Even a replayed CREATE may not attach a second original to a FILE revision.
CREATE FUNCTION governance_catalog.guard_file_original() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF NEW.kind='RAW_FILE' AND EXISTS(SELECT 1 FROM governance_catalog.import_input_revision WHERE id=NEW.revision_id AND metadata->>'kind'='FILE')
 AND EXISTS(SELECT 1 FROM governance_catalog.protected_artifact WHERE revision_id=NEW.revision_id AND kind='RAW_FILE')
 THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER file_original_guard BEFORE INSERT ON governance_catalog.protected_artifact FOR EACH ROW EXECUTE FUNCTION governance_catalog.guard_file_original();
REVOKE ALL ON FUNCTION governance_catalog.guard_file_original() FROM PUBLIC,hdi_prototype;

-- Called only after the failed receive root has rolled back. Records an attempt,
-- not object existence, authorization, or a caller-supplied error explanation.
CREATE FUNCTION governance_catalog.file_receive_denial(p_actor text,p_input jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC'
 OR coalesce(p_input->>'campus','') NOT IN ('NORTH','SOUTH')
 OR coalesce(p_input->>'purpose','') NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED')
 OR coalesce(p_input->>'requestId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 OR coalesce(p_input->>'targetId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 OR EXISTS(SELECT 1 FROM jsonb_each(p_input) kv WHERE jsonb_typeof(kv.value) IS DISTINCT FROM 'string')
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','requestId','targetId'))
 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(901002);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest)
 VALUES(CASE WHEN EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=p_actor) THEN p_actor ELSE 'UNKNOWN_ACTOR' END,
 (p_input->>'targetId')::uuid,'FILE_RECEIVE_DENIED_'||(p_input->>'purpose')||'_'||(p_input->>'campus'),'REQUEST_REJECTED',encode(sha256(convert_to(p_input::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION governance_catalog.file_receive_denial(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.file_receive_denial(text,jsonb) TO hdi_prototype;
REVOKE ALL ON FUNCTION governance_catalog.import_job_command(text,jsonb),governance_catalog.import_job_read(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.import_job_command(text,jsonb),governance_catalog.import_job_read(text,jsonb) TO hdi_prototype;

CREATE OR REPLACE FUNCTION governance_catalog.guard_protected_revision_digest() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF NEW.metadata->>'kind' <> 'FILE' AND EXISTS(SELECT 1 FROM governance_catalog.protected_artifact a WHERE a.job_id=NEW.job_id)
    AND NOT EXISTS(SELECT 1 FROM governance_catalog.import_input_revision r WHERE r.job_id=NEW.job_id AND r.metadata->>'declaredSha256'=NEW.metadata->>'declaredSha256')
 THEN RAISE EXCEPTION 'PUBLIC_DIGEST_AFTER_PROTECTION_FORBIDDEN'; END IF;
 RETURN NEW;
END $$;
