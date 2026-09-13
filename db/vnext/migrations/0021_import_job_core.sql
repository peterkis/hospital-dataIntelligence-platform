-- Metadata belongs to the existing governance-catalog owner; no business apply.
SELECT pg_advisory_xact_lock(901002);
CREATE TABLE governance_catalog.import_job (
 id uuid PRIMARY KEY DEFAULT uuidv7(), scope text NOT NULL CHECK(scope IN ('BASELINE','SYNTHETIC')),
 submitter_identity text NOT NULL, contract_id uuid NOT NULL REFERENCES governance_catalog.import_contract(id),
 contract_version_id uuid NOT NULL REFERENCES governance_catalog.import_contract_version(id),
 profile text NOT NULL CHECK(profile IN ('CORE','FULL')), contract_snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'WAITING_INPUT' CHECK(status='WAITING_INPUT'),
 current_revision_id uuid NOT NULL
);
CREATE TABLE governance_catalog.import_input_revision (
 id uuid PRIMARY KEY DEFAULT uuidv7(), job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),
 number bigint NOT NULL CHECK(number BETWEEN 1 AND 1000), previous_revision_id uuid,
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 metadata jsonb NOT NULL, metadata_digest text NOT NULL CHECK(metadata_digest ~ '^[a-f0-9]{64}$'),
 digest_status text NOT NULL DEFAULT 'DECLARED' CHECK(digest_status='DECLARED'),
 request_identity text NOT NULL, request_id uuid NOT NULL,
 UNIQUE(job_id,number), UNIQUE(job_id,id),
 FOREIGN KEY(job_id,previous_revision_id) REFERENCES governance_catalog.import_input_revision(job_id,id),
 CHECK((number=1)=(previous_revision_id IS NULL))
);
ALTER TABLE governance_catalog.import_job ADD CONSTRAINT import_current_revision
 FOREIGN KEY(id,current_revision_id) REFERENCES governance_catalog.import_input_revision(job_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER import_revision_immutable BEFORE UPDATE OR DELETE ON governance_catalog.import_input_revision FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
ALTER TABLE governance_catalog.import_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_catalog.import_input_revision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON governance_catalog.import_job,governance_catalog.import_input_revision FROM PUBLIC,hdi_prototype;
GRANT SELECT ON governance_catalog.import_job,governance_catalog.import_input_revision TO hdi_prototype;

CREATE FUNCTION governance_catalog.import_job_read(actor text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE job governance_catalog.import_job; revisions jsonb; identity text;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 identity:=vnext_control.authorize(actor,input->>'scope','READ');
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('scope','jobId')) OR coalesce(input->>'jobId','') !~ '^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 SELECT * INTO job FROM governance_catalog.import_job WHERE id=(input->>'jobId')::uuid AND scope=input->>'scope';
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF identity<>job.submitter_identity THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 PERFORM governance_catalog.contract_require_access(actor,job.scope,job.contract_version_id,'READ');
 SELECT jsonb_agg(jsonb_build_object('id',id,'number',number::text,'previousRevisionId',previous_revision_id,
  'recordedAt',to_char(recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'input',metadata,'metadataDigest',metadata_digest,
  'digestStatus',digest_status,'requestIdentity',request_identity,'requestId',request_id) ORDER BY number)
 INTO revisions FROM governance_catalog.import_input_revision WHERE job_id=job.id;
 RETURN jsonb_build_object('id',job.id,'scope',job.scope,'submitterIdentity',job.submitter_identity,
  'contract',job.contract_snapshot,'profile',job.profile,'status',job.status,'adapterReadiness','NOT_READY',
  'currentRevisionId',job.current_revision_id,'revisions',revisions);
END $$;

CREATE FUNCTION governance_catalog.import_job_command(actor text,input jsonb) RETURNS jsonb
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
 IF jsonb_typeof(metadata) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(metadata) k WHERE k NOT IN ('kind','declaredSha256')) OR
  metadata->>'kind' IS DISTINCT FROM 'METADATA_ONLY' OR jsonb_typeof(metadata->'declaredSha256') IS DISTINCT FROM 'string' OR coalesce(metadata->>'declaredSha256','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CLOSED_METADATA_REQUIRED'; END IF;
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
 INSERT INTO governance_catalog.import_input_revision(id,job_id,number,previous_revision_id,metadata,metadata_digest,request_identity,request_id)
 VALUES(new_revision,job.id,coalesce(prior.number,0)+1,prior.id,metadata,encode(sha256(convert_to(metadata::text,'UTF8')),'hex'),identity,req);
 result:=jsonb_build_object('id',job.id,'revisionId',new_revision,'revision', (coalesce(prior.number,0)+1)::text,'status','WAITING_INPUT','adapterReadiness','NOT_READY','digestStatus','DECLARED');
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(actor,req,request_digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,actor);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,job.id,'IMPORT_JOB_'||action,input->>'reason',request_digest);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.import_job_command(text,jsonb),governance_catalog.import_job_read(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.import_job_command(text,jsonb),governance_catalog.import_job_read(text,jsonb) TO hdi_prototype;
