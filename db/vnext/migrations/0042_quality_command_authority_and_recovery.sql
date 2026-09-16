SELECT pg_advisory_xact_lock(901002);

CREATE FUNCTION governance_catalog.quality_resolution_prior(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; existing vnext_control.outcome; i governance_catalog.quality_issue; j governance_catalog.import_job; binding text; requested text;
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','requestId','reason','issueId','expectedHead','newRunId','newRevisionId','candidate')) OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE'); PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 PERFORM pg_advisory_xact_lock(901002);
 SELECT o.* INTO existing FROM vnext_control.request_identity ri JOIN vnext_control.outcome o ON o.actor_code=ri.original_actor_code AND o.request_id=ri.request_id WHERE ri.identity_code=identity AND ri.request_id=(p_input->>'requestId')::uuid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF existing.result->>'kind' IS DISTINCT FROM 'RESOLVED' OR existing.result->>'issueId' IS DISTINCT FROM p_input->>'issueId' THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
 SELECT * INTO i FROM governance_catalog.quality_issue WHERE id=(p_input->>'issueId')::uuid;
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=i.job_id;
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));
 PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',j.contract_version_id,'WRITE');
 IF i.campus IS DISTINCT FROM p_input->>'campus' OR i.purpose IS DISTINCT FROM p_input->>'purpose' OR NOT EXISTS(
  SELECT 1 FROM vnext_control.protected_grant g JOIN governance_catalog.version v ON v.object_id=g.dataset_id JOIN governance_catalog.import_contract_version c ON c.dataset_version_id=v.id WHERE c.id=j.contract_version_id AND g.actor_code=p_actor AND g.campus=i.campus AND g.purpose=i.purpose AND g.permission='READ'
 ) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT d.payload->>'requestDigest' INTO binding FROM governance_catalog.issue_disposition d WHERE d.id=(existing.result->>'eventId')::uuid AND d.issue_id=i.id AND d.job_id=j.id AND d.kind='RESOLVED' AND d.actor_identity=identity AND d.request_id=(p_input->>'requestId')::uuid;
 -- Legacy events lack the independent public-request binding: preserve the old
 -- verified-evidence replay path instead of inventing a historical request.
 IF binding IS NULL THEN RETURN to_jsonb('LEGACY_EVIDENCE_REQUIRED'::text); END IF;
 requested:=encode(sha256(convert_to(jsonb_build_object('operation','QUALITY_RESOLVE_REQUEST_V1','input',p_input)::text,'UTF8')),'hex');
 IF requested<>binding THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
 RETURN existing.result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.quality_resolution_prior(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.quality_resolution_prior(text,jsonb) TO hdi_prototype;

DO $commands$
DECLARE body text; needle text; access_check text; f text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.quality_issue_record_correction(text,jsonb,uuid,uuid)'::regprocedure);
 body:=replace(body,' req:=(p_input->>''requestId'')::uuid;',E' PERFORM governance_catalog.quality_correction_prior(p_actor,p_input);\n req:=(p_input->>''requestId'')::uuid;');
 needle:=' IF NOT FOUND THEN RAISE EXCEPTION ''PROTECTED_ARTIFACT_REQUIRED''; END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_CORRECTION_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,needle||E'\n IF a.request_id::text IS DISTINCT FROM p_input->>''receiveRequestId'' OR rev.metadata->>''format'' IS DISTINCT FROM p_input->>''format'' OR rev.metadata->>''parserPolicy'' IS DISTINCT FROM p_input->>''parserPolicy'' THEN RAISE EXCEPTION ''CORRECTION_RECEIPT_MISMATCH''; END IF;');
 EXECUTE body;

 body:=pg_get_functiondef('governance_catalog.quality_correction_prior(text,jsonb)'::regprocedure);
 needle:=' req:=(p_input->>''requestId'')::uuid;';
 access_check:=$access$
 PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',(SELECT contract_version_id FROM governance_catalog.import_job WHERE id=(p_input->>'jobId')::uuid),'WRITE');
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.import_job j JOIN governance_catalog.import_contract_version c ON c.id=j.contract_version_id JOIN governance_catalog.version v ON v.id=c.dataset_version_id JOIN vnext_control.protected_grant g ON g.dataset_id=v.object_id WHERE j.id=(p_input->>'jobId')::uuid AND g.actor_code=p_actor AND g.campus=p_input->>'campus' AND g.purpose=p_input->>'purpose' AND g.permission='STORE') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
$access$;
 body:=replace(body,needle,access_check||needle); EXECUTE body;

 -- All quality-expansion commands recheck the exact object's WRITE permission.
 FOREACH f IN ARRAY ARRAY['quality_issue_ingest(text,jsonb,jsonb)','quality_issue_open_prior(text,jsonb)','quality_issue_assign(text,jsonb)'] LOOP
  body:=pg_get_functiondef(('governance_catalog.'||f)::regprocedure);
  needle:=' PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object(''scope'',''SYNTHETIC'',''jobId'',j.id));';
  IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_ACCESS_BASELINE_MISMATCH'; END IF;
  body:=replace(body,needle,needle||E'\n PERFORM governance_catalog.contract_require_access(p_actor,''SYNTHETIC'',j.contract_version_id,''WRITE'');');
  IF f='quality_issue_assign(text,jsonb)' THEN
   body:=replace(body,' IF FOUND THEN IF existing.input_digest<>requested_digest THEN RAISE EXCEPTION ''REQUEST_CONFLICT''; END IF; RETURN existing.result; END IF;','');
   needle:=' IF j.quality_disposition_sequence::text<>p_input->>''expectedHead'' THEN';
   body:=replace(body,needle,E' PERFORM vnext_control.require_object(p_actor,''SYNTHETIC'',(p_input->>''responsibilityId'')::uuid,''READ'',''METADATA'');\n IF existing.request_id IS NOT NULL THEN IF existing.input_digest<>requested_digest THEN RAISE EXCEPTION ''REQUEST_CONFLICT''; END IF; RETURN existing.result; END IF;\n'||needle);
  END IF;
  EXECUTE body;
 END LOOP;

 body:=pg_get_functiondef('governance_catalog.quality_issue_resolve(text,jsonb)'::regprocedure);
 needle:='jsonb_build_object(''matchStatus'',''MATCHED'',''targetField'',target_field,''newRunId'',r.id,''newRevisionId'',rev.id)';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_RESOLVE_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,needle||$binding$||jsonb_build_object('requestDigest',encode(sha256(convert_to(jsonb_build_object('operation','QUALITY_RESOLVE_REQUEST_V1','input',p_input-ARRAY['targetRow','targetField','matchStatus','oldProof','newProof'])::text,'UTF8')),'hex'))$binding$);
 EXECUTE body;

 body:=pg_get_functiondef('governance_catalog.quality_batch_reject(text,jsonb)'::regprocedure);
 body:=replace(body,' IF FOUND THEN IF existing.input_digest<>requested_digest THEN RAISE EXCEPTION ''REQUEST_CONFLICT''; END IF; RETURN existing.result; END IF;','');
 needle:=' PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object(''scope'',''SYNTHETIC'',''jobId'',j.id));';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_STOP_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,$stop$
 IF j.submitter_identity IS DISTINCT FROM identity THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 PERFORM vnext_control.require_object(p_actor,'SYNTHETIC',v.object_id,'WRITE','METADATA',v.payload) FROM governance_catalog.import_contract_version c JOIN governance_catalog.version v ON v.id=c.dataset_version_id WHERE c.id=j.contract_version_id;
 IF existing.request_id IS NOT NULL THEN IF existing.input_digest<>requested_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF; RETURN existing.result; END IF;
$stop$); EXECUTE body;
END $commands$;

-- The receive-and-associate seam is available only to the trusted Owner service.
REVOKE ALL ON FUNCTION governance_catalog.quality_issue_record_correction(text,jsonb,uuid,uuid) FROM PUBLIC,hdi_prototype;
-- Existing NOINHERIT Owners are identified by the authoritative acceptance ACL,
-- not by a test role name. This is part of the upgrade, not a runner-only repair.
DO $owner_grants$
DECLARE trusted record;
BEGIN
 FOR trusted IN SELECT DISTINCT r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='governance_catalog' AND p.proname='accept_validation' AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner AND r.rolname<>'hdi_prototype' LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION governance_catalog.quality_issue_open_prior(text,jsonb),governance_catalog.quality_resolution_prior(text,jsonb),governance_catalog.quality_issue_record_correction(text,jsonb,uuid,uuid) TO %I',trusted.rolname);
 END LOOP;
END $owner_grants$;
