-- Forward correction only: installed 0023 and existing audit history remain immutable.
SELECT pg_advisory_xact_lock(901002);
CREATE OR REPLACE FUNCTION governance_catalog.protected_command(p_actor text,p_action text,p_input jsonb,p_envelope jsonb,p_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE a governance_catalog.protected_artifact; j governance_catalog.import_job; identity text; dataset uuid;
 result jsonb; prior vnext_control.outcome; req uuid; error_code text; audit_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 -- Reject invalid metadata before it can be used as audit content. No free text, filenames, or raw hashes.
 IF p_action IS NULL OR p_action NOT IN ('STORE','MASKED','READ','PURGE') OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR
    p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR coalesce(p_input->>'campus','') NOT IN ('NORTH','SOUTH') OR
    coalesce(p_input->>'purpose','') NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED') OR
    coalesce(p_input->>'requestId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR
    EXISTS(SELECT 1 FROM jsonb_each(p_input) kv WHERE jsonb_typeof(kv.value) IS DISTINCT FROM CASE WHEN kv.key='retentionSeconds' THEN 'number' ELSE 'string' END) OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','requestId','jobId','revisionId','kind','retentionSeconds','artifactId'))
 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 req:=(p_input->>'requestId')::uuid;
 IF p_action='STORE' THEN
  IF p_input ? 'artifactId' OR coalesce(p_input->>'jobId','') !~ '^[a-f0-9-]{36}$' OR coalesce(p_input->>'revisionId','') !~ '^[a-f0-9-]{36}$' OR
     coalesce(p_input->>'kind','') NOT IN ('RAW_FILE','RAW_CELL','ERROR_REPORT') OR coalesce(p_input->>'retentionSeconds','') !~ '^[0-9]{1,7}$' OR
     (p_input->>'retentionSeconds')::integer NOT BETWEEN 1 AND 2592000 OR coalesce(p_digest,'') !~ '^[a-f0-9]{64}$' OR
     jsonb_typeof(p_envelope) IS DISTINCT FROM 'object' OR coalesce(p_envelope->>'keyId','') !~ '^LOCAL_[1-9][0-9]{0,8}$' OR
     coalesce(p_envelope->>'nonce','') !~ '^[a-f0-9]{24}$' OR coalesce(p_envelope->>'tag','') !~ '^[a-f0-9]{32}$' OR
     coalesce(p_envelope->>'ciphertext','') !~ '^[a-f0-9]+$' OR length(p_envelope->>'ciphertext') NOT BETWEEN 2 AND 2097152 OR length(p_envelope->>'ciphertext')%2<>0 OR
     EXISTS(SELECT 1 FROM jsonb_object_keys(p_envelope) k WHERE k NOT IN ('keyId','nonce','tag','ciphertext'))
  THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 ELSE
  IF coalesce(p_input->>'artifactId','') !~ '^[a-f0-9-]{36}$' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','requestId','artifactId'))
  THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 END IF;
 -- Inner block rolls back all partial work on a denied request; outer block retains only safe evidence.
 BEGIN
  identity:=vnext_control.authorize(p_actor,'SYNTHETIC',CASE WHEN p_action IN ('STORE','PURGE') THEN 'WRITE' ELSE 'READ' END);
  IF p_action='STORE' THEN
   SELECT * INTO j FROM governance_catalog.import_job WHERE id=(p_input->>'jobId')::uuid AND scope='SYNTHETIC';
  ELSE
   SELECT * INTO a FROM governance_catalog.protected_artifact WHERE id=(p_input->>'artifactId')::uuid;
   SELECT * INTO j FROM governance_catalog.import_job WHERE id=a.job_id AND scope='SYNTHETIC';
  END IF;
  IF j.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF identity<>j.submitter_identity THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  -- Contract snapshot uses the dataset version; derive its stable ID from the existing owner tables.
  SELECT v.object_id INTO dataset FROM governance_catalog.import_contract_version c JOIN governance_catalog.version v ON v.id=c.dataset_version_id WHERE c.id=j.contract_version_id;
  IF p_action<>'STORE' AND (a.campus<>p_input->>'campus' OR a.purpose<>p_input->>'purpose') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF p_action<>'MASKED' AND NOT EXISTS(SELECT 1 FROM vnext_control.protected_grant g WHERE g.actor_code=p_actor AND g.dataset_id=dataset AND g.campus=p_input->>'campus' AND g.purpose=p_input->>'purpose' AND g.permission=p_action) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  -- Purge is non-expansive: current actor + owned artifact + explicit PURGE grant suffice.
  IF p_action<>'PURGE' THEN
   PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));
  END IF;
  IF p_action='STORE' THEN
   PERFORM governance_catalog.contract_require_access(p_actor,j.scope,j.contract_version_id,'WRITE');
   SELECT o.* INTO prior FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=req;
   IF FOUND THEN
    IF prior.input_digest<>p_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
    RETURN prior.result;
   END IF;
   IF j.current_revision_id<>(p_input->>'revisionId')::uuid THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
   IF (governance_catalog.contract_read(p_actor,jsonb_build_object('scope',j.scope,'mode','EFFECTIVE','target',j.contract_id,'businessAt',to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US')))->0->>'versionId') IS DISTINCT FROM j.contract_version_id::text THEN RAISE EXCEPTION 'EXACT_CONTRACT_UNAVAILABLE'; END IF;
   INSERT INTO governance_catalog.protected_artifact(job_id,revision_id,request_id,campus,purpose,kind,expires_at)
   VALUES(j.id,(p_input->>'revisionId')::uuid,req,p_input->>'campus',p_input->>'purpose',p_input->>'kind',timezone('Asia/Shanghai',clock_timestamp())+make_interval(secs=>(p_input->>'retentionSeconds')::integer)) RETURNING * INTO a;
   INSERT INTO governance_catalog.protected_payload VALUES(a.id,p_envelope->>'keyId',decode(p_envelope->>'nonce','hex'),decode(p_envelope->>'tag','hex'),decode(p_envelope->>'ciphertext','hex'));
  ELSIF p_action='PURGE' THEN
   IF timezone('Asia/Shanghai',clock_timestamp())<a.expires_at THEN RAISE EXCEPTION 'RETENTION_NOT_EXPIRED'; END IF;
   DELETE FROM governance_catalog.protected_payload WHERE artifact_id=a.id;
  ELSIF p_action='READ' THEN
   IF timezone('Asia/Shanghai',clock_timestamp())>=a.expires_at OR NOT EXISTS(SELECT 1 FROM governance_catalog.protected_payload WHERE artifact_id=a.id) THEN RAISE EXCEPTION 'PAYLOAD_UNAVAILABLE'; END IF;
  END IF;
  result:=jsonb_build_object('artifactId',a.id,'status','QUARANTINED','masked','[REDACTED]','purged',NOT EXISTS(SELECT 1 FROM governance_catalog.protected_payload WHERE artifact_id=a.id),'expiresAt',to_char(a.expires_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
  IF p_action='READ' THEN
   result:=result||jsonb_build_object('binding',jsonb_build_array(a.job_id,a.revision_id,a.kind,a.campus,a.purpose,a.request_id)::text);
   SELECT result||jsonb_build_object('envelope',jsonb_build_object('keyId',p.key_id,'nonce',encode(p.nonce,'hex'),'tag',encode(p.tag,'hex'),'ciphertext',encode(p.ciphertext,'hex'))) INTO result FROM governance_catalog.protected_payload p WHERE p.artifact_id=a.id;
  END IF;
  IF p_action='STORE' THEN
   INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(p_actor,req,p_digest,result);
   INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,p_actor);
  END IF;
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM IN ('ACCESS_DENIED','NOT_FOUND','REQUEST_CONFLICT','EXACT_CONTRACT_UNAVAILABLE','STALE_REVISION','RETENTION_NOT_EXPIRED','PAYLOAD_UNAVAILABLE') THEN error_code:=SQLERRM; result:=jsonb_build_object('error',error_code); ELSE RAISE; END IF;
 END;
 audit_id:=CASE WHEN p_action='STORE' THEN coalesce(a.id,(p_input->>'jobId')::uuid) ELSE (p_input->>'artifactId')::uuid END;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest)
 VALUES(CASE WHEN EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=p_actor) THEN p_actor ELSE 'UNKNOWN_ACTOR' END,audit_id,'PROTECTED_'||p_action||'_'||(p_input->>'purpose')||'_'||(p_input->>'campus'),coalesce(error_code,'REQUEST_AUTHORIZED'),encode(sha256(convert_to(p_input::text,'UTF8')),'hex'));
 RETURN result;
END $$;
