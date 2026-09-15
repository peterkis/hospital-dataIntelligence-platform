-- Preserve legacy source snapshots and request replays; all newly authored
-- versions and new approval/publication actions must have a declared key.
SELECT pg_advisory_xact_lock(901002);
DO $required_key$
DECLARE body text; needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.contract_command(text,jsonb)'::regprocedure);
 needle:='  PERFORM governance_catalog.contract_definition(input->''definition'',dataset.id,coalesce(contract.profile,input->>''profile''));';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'AUTHORED_KEY_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,needle||E'\n'||'  IF NOT (input->''definition'' ? ''businessKey'') THEN RAISE EXCEPTION ''BUSINESS_KEY_REQUIRED''; END IF;');
 needle:='  IF action<>''RETIRE'' THEN';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'PUBLICATION_KEY_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,needle||E'\n'||'   IF NOT (ver.definition ? ''businessKey'') THEN blockers:=blockers||jsonb_build_array(''BUSINESS_KEY_REQUIRED''); END IF;');
 EXECUTE body;
END $required_key$;
