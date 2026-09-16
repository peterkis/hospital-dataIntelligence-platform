SELECT pg_advisory_xact_lock(901002);
-- Existing validation runs remain immutable. New runs bind a non-public resolution proof.
ALTER TABLE governance_catalog.validation_run ADD COLUMN quality_resolution_digest text CHECK(quality_resolution_digest ~ '^[a-f0-9]{64}$');
DO $binding$
DECLARE body text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.read_validation(text,uuid)'::regprocedure);
 body:=replace(body,'''qualityEligibilityDigest'',r.quality_eligibility_digest);','''qualityEligibilityDigest'',r.quality_eligibility_digest) || CASE WHEN r.quality_resolution_digest IS NULL THEN ''{}''::jsonb ELSE jsonb_build_object(''qualityResolutionDigest'',r.quality_resolution_digest) END;');
 EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text)'::regprocedure);
 body:=replace(body,'p_quality_eligibility_digest text)','p_quality_eligibility_digest text, p_resolution_digest text)');
 body:=replace(body,'quality_eligibility_digest,recorded_at,signature)','quality_eligibility_digest,quality_resolution_digest,recorded_at,signature)');
 body:=replace(body,'p_quality_eligibility_digest,governance_catalog.contract_time','p_quality_eligibility_digest,p_resolution_digest,governance_catalog.contract_time');
 EXECUTE body;
END $binding$;
REVOKE ALL ON FUNCTION governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text) FROM PUBLIC,hdi_prototype;
DROP FUNCTION governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text);
REVOKE ALL ON FUNCTION governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text) TO hdi_prototype;

CREATE OR REPLACE FUNCTION governance_catalog.quality_issue_resolve(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; req uuid; requested_digest text; existing vnext_control.outcome; j governance_catalog.import_job; i governance_catalog.quality_issue; r governance_catalog.validation_run; rev governance_catalog.import_input_revision;
 next_no bigint; event_id uuid; result jsonb; target_row integer; target_field text; old_run governance_catalog.validation_run; old_proof jsonb; new_proof jsonb; matched_key text;
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','requestId','reason','issueId','expectedHead','newRunId','newRevisionId','targetRow','targetField','matchStatus','candidate','oldProof','newProof')) OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR p_input->>'campus' NOT IN ('NORTH','SOUTH') OR p_input->>'purpose' NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED') OR p_input->>'requestId' !~ '^[a-f0-9-]{36}$' OR p_input->>'issueId' !~ '^[a-f0-9-]{36}$' OR p_input->>'newRunId' !~ '^[a-f0-9-]{36}$' OR p_input->>'newRevisionId' !~ '^[a-f0-9-]{36}$' OR p_input->>'expectedHead' !~ '^(0|[1-9][0-9]*)$' OR p_input->>'targetRow' !~ '^[1-9][0-9]{0,3}$' OR p_input->>'targetField' !~ '^[A-Za-z0-9_.-]{1,128}$' OR p_input->>'matchStatus' IS DISTINCT FROM 'MATCHED' OR p_input->>'reason' !~ '^[A-Z0-9_]{1,64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE'); PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 PERFORM pg_advisory_xact_lock(901002);
 req:=(p_input->>'requestId')::uuid; requested_digest:=encode(sha256(convert_to(jsonb_build_object('operation','QUALITY_RESOLVE','input',p_input)::text,'UTF8')),'hex');
 SELECT o.* INTO existing FROM vnext_control.request_identity ri JOIN vnext_control.outcome o ON o.actor_code=ri.original_actor_code AND o.request_id=ri.request_id WHERE ri.identity_code=identity AND ri.request_id=req;

 SELECT * INTO i FROM governance_catalog.quality_issue WHERE id=(p_input->>'issueId')::uuid FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF i.campus<>p_input->>'campus' OR i.purpose<>p_input->>'purpose' THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=i.job_id AND scope='SYNTHETIC' FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));
 PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',j.contract_version_id,'WRITE');
 IF NOT EXISTS(SELECT 1 FROM vnext_control.protected_grant g JOIN governance_catalog.version v ON v.object_id=g.dataset_id JOIN governance_catalog.import_contract_version c ON c.dataset_version_id=v.id WHERE c.id=j.contract_version_id AND g.actor_code=p_actor AND g.campus=i.campus AND g.purpose=i.purpose AND g.permission='READ') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF existing.request_id IS NOT NULL THEN IF existing.input_digest<>requested_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF; RETURN existing.result; END IF;
 IF j.quality_disposition_sequence::text<>p_input->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD'; END IF;
 IF j.current_revision_id<>(p_input->>'newRevisionId')::uuid OR EXISTS(SELECT 1 FROM governance_catalog.issue_disposition d WHERE d.issue_id=i.id AND d.kind='RESOLVED') THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
 SELECT * INTO r FROM governance_catalog.validation_run WHERE id=(p_input->>'newRunId')::uuid AND job_id=j.id AND revision_id=(p_input->>'newRevisionId')::uuid; IF NOT FOUND THEN RAISE EXCEPTION 'RUN_REFERENCE_INVALID'; END IF;
 IF r.quality_candidate_digest IS NULL OR NOT EXISTS(SELECT 1 FROM governance_catalog.validation_run prior_run WHERE prior_run.id=i.run_id AND prior_run.job_id=j.id AND prior_run.quality_candidate_digest IS NOT NULL) THEN RAISE EXCEPTION 'VALIDATION_PROVENANCE_REQUIRED'; END IF;
 SELECT * INTO old_run FROM governance_catalog.validation_run WHERE id=i.run_id AND job_id=j.id;
 IF r.revision_id=old_run.revision_id OR NOT EXISTS(
  WITH RECURSIVE ancestors AS (
   SELECT id,previous_revision_id FROM governance_catalog.import_input_revision WHERE id=r.revision_id AND job_id=j.id
   UNION ALL SELECT v.id,v.previous_revision_id FROM governance_catalog.import_input_revision v JOIN ancestors a ON v.id=a.previous_revision_id WHERE v.job_id=j.id
  ) SELECT 1 FROM ancestors WHERE id=old_run.revision_id
 ) THEN RAISE EXCEPTION 'REVISION_LINEAGE_INVALID'; END IF;
 IF r.contract_version_id<>old_run.contract_version_id OR r.rule_version<>old_run.rule_version OR r.interpretation_policy<>old_run.interpretation_policy OR
 (SELECT policy FROM governance_catalog.parse_provenance WHERE artifact_id=r.parse_artifact_id) IS DISTINCT FROM (SELECT policy FROM governance_catalog.parse_provenance WHERE artifact_id=old_run.parse_artifact_id) THEN RAISE EXCEPTION 'POLICY_INCOMPATIBLE'; END IF;
 IF old_run.quality_resolution_digest IS NULL OR r.quality_resolution_digest IS NULL OR
 encode(sha256(convert_to(p_input->>'oldProof','UTF8')),'hex') IS DISTINCT FROM old_run.quality_resolution_digest OR
 encode(sha256(convert_to(p_input->>'newProof','UTF8')),'hex') IS DISTINCT FROM r.quality_resolution_digest THEN RAISE EXCEPTION 'VALIDATION_PROVENANCE_REQUIRED'; END IF;
 old_proof:=(p_input->>'oldProof')::jsonb; new_proof:=(p_input->>'newProof')::jsonb;
 IF old_proof->>'version' IS DISTINCT FROM 'QUALITY_RESOLUTION_V1' OR new_proof->>'version' IS DISTINCT FROM 'QUALITY_RESOLUTION_V1' OR
 old_proof->>'campus' IS DISTINCT FROM i.campus OR new_proof->>'campus' IS DISTINCT FROM i.campus OR
 old_proof->>'purpose' IS DISTINCT FROM i.purpose OR new_proof->>'purpose' IS DISTINCT FROM i.purpose THEN RAISE EXCEPTION 'VALIDATION_PROVENANCE_REQUIRED'; END IF;
 IF i.source_kind<>'RULE' OR i.classification='BLOCKED_DEPENDENCY' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
 matched_key:=old_proof->'keys'->>(i.row_number-1);
 IF matched_key IS NULL OR (SELECT count(*) FROM jsonb_array_elements_text(old_proof->'keys') x WHERE x=matched_key)<>1 OR
 (SELECT count(*) FROM jsonb_array_elements_text(new_proof->'keys') x WHERE x=matched_key)<>1 OR
 new_proof->'keys'->>((p_input->>'targetRow')::integer-1) IS DISTINCT FROM matched_key THEN RAISE EXCEPTION 'UNMATCHED'; END IF;
 IF p_input->>'targetField' IS DISTINCT FROM i.field_code OR NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(new_proof->'pass') c WHERE c->>0=i.rule_code AND c->>1=i.field_code AND c->2 @> jsonb_build_array((p_input->>'targetRow')::integer)
 ) THEN RAISE EXCEPTION 'VALIDATION_NOT_PASSED'; END IF;
 IF EXISTS(SELECT 1 FROM governance_catalog.protected_artifact a WHERE a.id IN (r.result_artifact_id,r.parse_artifact_id,old_run.result_artifact_id,old_run.parse_artifact_id) AND
 (a.campus<>i.campus OR a.purpose<>i.purpose OR a.expires_at<=timezone('Asia/Shanghai',clock_timestamp()) OR NOT EXISTS(SELECT 1 FROM governance_catalog.protected_payload WHERE artifact_id=a.id))) THEN RAISE EXCEPTION 'PAYLOAD_UNAVAILABLE'; END IF;
 SELECT * INTO rev FROM governance_catalog.import_input_revision WHERE id=r.revision_id AND job_id=j.id; IF NOT FOUND OR rev.metadata->>'kind' IS DISTINCT FROM 'FILE' THEN RAISE EXCEPTION 'REVISION_REFERENCE_INVALID'; END IF;
 target_row:=(p_input->>'targetRow')::integer; target_field:=p_input->>'targetField';
 UPDATE governance_catalog.import_job SET quality_disposition_sequence=quality_disposition_sequence+1 WHERE id=j.id RETURNING quality_disposition_sequence INTO next_no;
 INSERT INTO governance_catalog.issue_disposition(job_id,issue_id,disposition_no,kind,actor_identity,request_id,reason,target_run_id,target_revision_id,target_row,payload) VALUES(j.id,i.id,next_no,'RESOLVED',identity,req,p_input->>'reason',r.id,rev.id,target_row,jsonb_build_object('matchStatus','MATCHED','targetField',target_field,'newRunId',r.id,'newRevisionId',rev.id)) RETURNING id INTO event_id;
 result:=jsonb_build_object('jobId',j.id,'issueId',i.id,'head',next_no::text,'eventId',event_id,'kind','RESOLVED','newRunId',r.id,'newRevisionId',rev.id,'targetRow',target_row,'targetField',target_field);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,i.id,'QUALITY_ISSUE_RESOLVED',p_input->>'reason',requested_digest);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(p_actor,req,requested_digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,p_actor);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.quality_issue_resolve(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.quality_issue_resolve(text,jsonb) TO hdi_prototype;


-- Stop unseen work after, not before, the established permission-checked replay.
DO $replays$
DECLARE body text; needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.import_job_command(text,jsonb)'::regprocedure);
 needle:=E'\n  IF job.status=''REJECTED'' THEN RAISE EXCEPTION ''BATCH_REJECTED''; END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_IMPORT_GUARD_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,'');
 body:=replace(body,' -- Current accepted version',E' IF action=''REVISE'' AND job.status=''REJECTED'' THEN RAISE EXCEPTION ''BATCH_REJECTED''; END IF;\n -- Current accepted version');
 EXECUTE body;
 -- Protected STORE already checks permissions and exact request/content before this point.
 body:=pg_get_functiondef('governance_catalog.protected_command(text,text,jsonb,jsonb,text)'::regprocedure);
 needle:='   IF j.current_revision_id<>(p_input->>''revisionId'')::uuid THEN';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_STORE_GUARD_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,E'   IF j.status=''REJECTED'' THEN RAISE EXCEPTION ''BATCH_REJECTED''; END IF;\n'||needle);
 EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.register_parse(text,uuid,uuid,text,text)'::regprocedure);
 needle:=' INSERT INTO governance_catalog.parse_provenance';
 body:=replace(body,needle,E' IF j->>''status''=''REJECTED'' THEN RAISE EXCEPTION ''BATCH_REJECTED''; END IF;\n'||needle);
 EXECUTE body;
END $replays$;
