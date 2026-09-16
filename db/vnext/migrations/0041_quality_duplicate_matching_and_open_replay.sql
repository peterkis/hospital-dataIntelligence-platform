SELECT pg_advisory_xact_lock(901002);

-- Replay uses immutable technical ledger data, never expired raw payloads.
CREATE FUNCTION governance_catalog.quality_issue_open_prior(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; existing vnext_control.outcome; r governance_catalog.validation_run; j governance_catalog.import_job; candidates jsonb; digest text;
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','requestId','reason','runId')) OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR p_input->>'campus' NOT IN ('NORTH','SOUTH') OR p_input->>'purpose' NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED') OR p_input->>'requestId' !~ '^[a-f0-9-]{36}$' OR p_input->>'runId' !~ '^[a-f0-9-]{36}$' OR p_input->>'reason' !~ '^[A-Z0-9_]{1,64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE'); PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 PERFORM pg_advisory_xact_lock(901002);
 SELECT o.* INTO existing FROM vnext_control.request_identity ri JOIN vnext_control.outcome o ON o.actor_code=ri.original_actor_code AND o.request_id=ri.request_id WHERE ri.identity_code=identity AND ri.request_id=(p_input->>'requestId')::uuid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF existing.result->>'runId' IS DISTINCT FROM p_input->>'runId' THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
 SELECT * INTO r FROM governance_catalog.validation_run WHERE id=(p_input->>'runId')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=r.job_id;
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.protected_artifact WHERE id=r.result_artifact_id AND campus=p_input->>'campus' AND purpose=p_input->>'purpose') OR NOT EXISTS(
  SELECT 1 FROM vnext_control.protected_grant g JOIN governance_catalog.version v ON v.object_id=g.dataset_id JOIN governance_catalog.import_contract_version c ON c.dataset_version_id=v.id WHERE c.id=j.contract_version_id AND g.actor_code=p_actor AND g.campus=p_input->>'campus' AND g.purpose=p_input->>'purpose' AND g.permission='READ'
 ) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('sourceKind',i.source_kind,'sourceStatus',i.source_status,'classification',i.classification,'layer',i.layer,'rule',i.rule_code,'requirementId',i.requirement_id,'row',i.row_number,'field',i.field_code,'ownerRef',i.owner_ref,'relatedRefs',i.related_refs,'boundedCode',i.bounded_code) ORDER BY i.issue_sequence),'[]'::jsonb) INTO candidates FROM governance_catalog.quality_issue i WHERE i.run_id=r.id;
 digest:=encode(sha256(convert_to(jsonb_build_object('operation','QUALITY_ISSUE_OPEN','input',p_input,'candidates',candidates)::text,'UTF8')),'hex');
 IF existing.input_digest<>digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
 RETURN existing.result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.quality_issue_open_prior(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.quality_issue_open_prior(text,jsonb) TO hdi_prototype;

DO $fixes$
DECLARE body text; needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.quality_issue_ingest(text,jsonb,jsonb)'::regprocedure);
 needle:='IF FOUND THEN IF existing.input_digest<>requested_digest THEN RAISE EXCEPTION ''REQUEST_CONFLICT''; END IF; RETURN existing.result; END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_OPEN_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,'IF FOUND THEN IF existing.input_digest<>requested_digest THEN RAISE EXCEPTION ''REQUEST_CONFLICT''; END IF; RETURN governance_catalog.quality_issue_open_prior(p_actor,p_input); END IF;');
 EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.quality_issue_resolve(text,jsonb)'::regprocedure);
 needle:=$old$ IF matched_key IS NULL OR (SELECT count(*) FROM jsonb_array_elements_text(old_proof->'keys') x WHERE x=matched_key)<>1 OR
 (SELECT count(*) FROM jsonb_array_elements_text(new_proof->'keys') x WHERE x=matched_key)<>1 OR
 new_proof->'keys'->>((p_input->>'targetRow')::integer-1) IS DISTINCT FROM matched_key THEN RAISE EXCEPTION 'UNMATCHED'; END IF;$old$;
 body:=replace(body,chr(13),''); needle:=replace(needle,chr(13),'');
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_MATCH_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,$new$
 -- BUSINESS_KEY PASS is emitted only for the first unique row or an exact-content
 -- duplicate. A conflicting same-key row has no such PASS and keeps the group blocked.
 IF matched_key IS NULL OR
 i.row_number IS DISTINCT FROM (SELECT min(n)::integer FROM jsonb_array_elements_text(old_proof->'keys') WITH ORDINALITY x(k,n) WHERE k=matched_key) OR
 (p_input->>'targetRow')::integer IS DISTINCT FROM (SELECT min(n)::integer FROM jsonb_array_elements_text(new_proof->'keys') WITH ORDINALITY x(k,n) WHERE k=matched_key) OR
 EXISTS(SELECT 1 FROM jsonb_array_elements_text(old_proof->'keys') WITH ORDINALITY x(k,n) WHERE k=matched_key AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old_proof->'pass') c WHERE c->>0='BUSINESS_KEY' AND c->2 @> jsonb_build_array(n))) OR
 EXISTS(SELECT 1 FROM jsonb_array_elements_text(new_proof->'keys') WITH ORDINALITY x(k,n) WHERE k=matched_key AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(new_proof->'pass') c WHERE c->>0='BUSINESS_KEY' AND c->2 @> jsonb_build_array(n)))
 THEN RAISE EXCEPTION 'UNMATCHED'; END IF;
$new$);
 EXECUTE body;
END $fixes$;
