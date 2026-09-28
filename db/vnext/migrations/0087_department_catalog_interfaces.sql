SELECT pg_advisory_xact_lock(901002);

-- Repair the already-installed Department functions without reading Catalog tables
-- from the Department module. Catalog ownership stays behind its public routines.
CREATE FUNCTION governance_catalog.import_job_context(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE job governance_catalog.import_job;revisions jsonb;identity text;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 identity:=vnext_control.authorize(p_actor,p_input->>'scope','READ');
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','jobId')) OR coalesce(p_input->>'jobId','') !~ '^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 SELECT * INTO job FROM governance_catalog.import_job WHERE id=(p_input->>'jobId')::uuid AND scope=p_input->>'scope';
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF identity IS DISTINCT FROM job.submitter_identity THEN PERFORM vnext_control.authorize(p_actor,job.scope,'REVIEW');END IF;
 PERFORM governance_catalog.contract_require_access(p_actor,job.scope,job.contract_version_id,'READ');
 SELECT jsonb_agg(jsonb_build_object('id',id,'number',number::text,'previousRevisionId',previous_revision_id,
  'recordedAt',to_char(recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'input',metadata,'metadataDigest',metadata_digest,
  'digestStatus',digest_status,'requestIdentity',request_identity,'requestId',request_id) ORDER BY number) INTO revisions
 FROM governance_catalog.import_input_revision WHERE job_id=job.id;
 RETURN jsonb_build_object('id',job.id,'scope',job.scope,'submitterIdentity',job.submitter_identity,
  'contract',job.contract_snapshot,'profile',job.profile,'status',job.status,'adapterReadiness','NOT_READY',
  'currentRevisionId',job.current_revision_id,'revisions',revisions);
END $$;
GRANT EXECUTE ON FUNCTION governance_catalog.import_job_context(text,jsonb) TO hdi_prototype;

CREATE OR REPLACE FUNCTION department_master.job_read(p_actor text,p_input uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;j jsonb;BEGIN
 r:=department_master.input_read(p_actor,p_input,'READ_RESTRICTED');
 j:=governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r->>'job_id'));
 RETURN jsonb_build_object('id',j->>'id','contract',j->'contract','profile',j->>'profile','status',j->>'status','currentRevisionId',j->>'currentRevisionId');
END $$;

CREATE OR REPLACE FUNCTION department_master.mutate(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;
 actor text:=t->>'actor';op text:=t->>'operation';identity text;r department_master.input;v department_master.verification;j jsonb;
 candidate jsonb;approved_by text;command jsonb:=t->'command';target uuid;n bigint;vid uuid;prior text;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.department_write_authority WHERE singleton;
 IF secret IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF op='STAGE' THEN
  identity:=department_master.authorize(actor,t->>'campus','WRITE');PERFORM department_master.authorize(actor,t->>'campus','READ_RESTRICTED');
  SELECT * INTO r FROM department_master.input WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF r.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);END IF;
  j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',t->>'jobId'));
  IF j->>'submitterIdentity' IS DISTINCT FROM identity OR j->>'currentRevisionId' IS DISTINCT FROM t->>'revisionId' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
  IF EXISTS(SELECT 1 FROM department_master.input WHERE job_id=(j->>'id')::uuid AND job_revision=(j->>'currentRevisionId')::uuid) THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
  INSERT INTO department_master.input(job_id,job_revision,maker,identity_code,request_id,digest,campus,envelope) VALUES((j->>'id')::uuid,(j->>'currentRevisionId')::uuid,actor,identity,(t->>'requestId')::uuid,t->>'digest',t->>'campus',t->'envelope') RETURNING * INTO r;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'DEPARTMENT_INPUT','ORG04_CORE',r.digest);
  RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);
 END IF;
 SELECT * INTO r FROM department_master.input WHERE id=(t->>'inputId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));
 IF r.job_revision IS DISTINCT FROM (j->>'currentRevisionId')::uuid THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 IF op='VERIFY' THEN
  identity:=department_master.authorize(actor,'HOSPITAL','VERIFY');PERFORM department_master.authorize(actor,r.campus,'READ_RESTRICTED');
  IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
  IF r.digest IS DISTINCT FROM t->>'inputDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  SELECT * INTO v FROM department_master.verification WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF v.digest IS DISTINCT FROM t->>'digest' OR v.input_id<>r.id THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('verificationId',v.id);END IF;
  IF EXISTS(SELECT 1 FROM department_master.version WHERE input_id=r.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
  INSERT INTO department_master.verification(input_id,number,actor,identity_code,request_id,digest,envelope) VALUES(r.id,(SELECT coalesce(max(number),0)+1 FROM department_master.verification WHERE input_id=r.id),actor,identity,(t->>'requestId')::uuid,t->>'digest',t->'envelope') RETURNING * INTO v;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'DEPARTMENT_VERIFY','ORG04_SEMANTIC_REVIEW',v.digest);
  RETURN jsonb_build_object('verificationId',v.id);
 END IF;
 IF op<>'APPLY' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 candidate:=governance_catalog.apply_record(actor,'READ_CANDIDATE',jsonb_build_object('candidateId',(t->>'candidateId')::uuid));
 IF candidate->>'digest' IS DISTINCT FROM t->>'digest' OR candidate->'input'->>'jobId' IS DISTINCT FROM r.id::text OR candidate->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR coalesce(candidate->>'approvedBy','')='' THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 approved_by:=candidate->>'approvedBy';
 PERFORM governance_catalog.apply_record(approved_by,'CHECK_APPROVAL',jsonb_build_object('candidateId',(t->>'candidateId')::uuid));
 PERFORM department_master.authorize(approved_by,'HOSPITAL','REVIEW');PERFORM department_master.authorize(actor,r.campus,'WRITE');
 IF command->'row'->>'record_status' IS DISTINCT FROM 'ACTIVE' OR nullif(btrim(command->'row'->>'approval_ref'),'') IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 IF nullif(command->'row'->>'abolished_on','') IS NOT NULL THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 target:=(command->'target'->>'id')::uuid;
 IF command->>'intent'='CREATE' THEN
  IF target IS NOT NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF EXISTS(SELECT 1 FROM department_master.department WHERE code=command->'row'->>'org_code') THEN RAISE EXCEPTION 'IDENTIFIER_CONFLICT';END IF;
  INSERT INTO department_master.department(code) VALUES(command->'row'->>'org_code') RETURNING id INTO target;n:=1;
 ELSIF command->>'intent'='REVISE' THEN
  SELECT code INTO prior FROM department_master.department WHERE id=target;
  IF prior IS DISTINCT FROM command->'row'->>'org_code' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
  SELECT max(number)+1 INTO n FROM department_master.version WHERE department_id=target;
  IF n IS NULL OR (n-1)::text IS DISTINCT FROM command->'target'->>'expectedVersion' OR command->'target'->>'owner' IS DISTINCT FROM 'department-master' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 INSERT INTO department_master.version(department_id,number,valid_from,valid_to,input_id,source_row,facts,content_digest) VALUES(target,n,(command->>'validFrom')::timestamp,(command->>'validTo')::timestamp,r.id,(coalesce(t->>'sourceRow',t->>'row'))::integer,t->'facts',t->>'contentDigest') RETURNING id INTO vid;
 RETURN jsonb_build_object('owner','department-master','id',target,'version',n::text,'source',jsonb_build_object('dataset','ORG04','row',(coalesce(t->>'sourceRow',t->>'row'))::integer,'step','DEPARTMENT'));
END $$;

CREATE FUNCTION department_master.committed_row(p_actor text,p_job_id uuid,p_source_row integer,p_intent text,p_target_id uuid,p_expected_version bigint,p_org_code text,p_valid_from timestamp,p_valid_to timestamp,p_facts jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');
 IF p_source_row NOT BETWEEN 1 AND 1048576 OR p_intent NOT IN ('CREATE','REVISE') OR p_intent='CREATE' AND p_target_id IS NOT NULL OR p_intent='REVISE' AND p_target_id IS NULL OR jsonb_typeof(p_facts) IS DISTINCT FROM 'object' OR p_facts->>'commandDigest' !~ '^[a-f0-9]{64}$' OR nullif(btrim(p_org_code),'') IS NULL OR p_valid_from IS NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 RETURN EXISTS(
  SELECT 1
  FROM department_master.version v
  JOIN department_master.input i ON i.id=v.input_id
  JOIN department_master.department d ON d.id=v.department_id
  WHERE i.job_id=p_job_id AND v.source_row=p_source_row AND d.code=p_org_code AND v.valid_from=p_valid_from AND v.valid_to IS NOT DISTINCT FROM p_valid_to
    AND v.facts->>'commandDigest'=p_facts->>'commandDigest'
    AND (v.facts-'verificationId'-'commandDigest')=(p_facts-'verificationId'-'commandDigest')
    AND ((p_intent='CREATE' AND p_expected_version IS NULL AND v.number=1)
      OR (p_intent='REVISE' AND p_expected_version IS NOT NULL AND v.department_id=p_target_id AND v.number=p_expected_version+1))
 );
END $$;
REVOKE ALL ON FUNCTION department_master.committed_row(text,uuid,integer,text,uuid,bigint,text,timestamp,timestamp,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION department_master.committed_row(text,uuid,integer,text,uuid,bigint,text,timestamp,timestamp,jsonb) TO hdi_prototype;
