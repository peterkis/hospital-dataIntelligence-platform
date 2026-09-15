-- A replay is still a validation command: current protected STORE is required.
-- Historical explanation reads retain their independent READ-only path.
SELECT pg_advisory_xact_lock(901002);
DO $store_access$
DECLARE body text; needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.validation_prior(text,jsonb)'::regprocedure);
 needle:=' PERFORM governance_catalog.contract_require_access(p_actor,''SYNTHETIC'',(j->''contract''->>''versionId'')::uuid,''WRITE'');';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'VALIDATION_STORE_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,needle||$guard$
 IF NOT EXISTS(
  SELECT 1 FROM vnext_control.protected_grant g
  JOIN governance_catalog.version v ON v.object_id=g.dataset_id
  JOIN governance_catalog.import_contract_version c ON c.dataset_version_id=v.id
  WHERE c.id=(j->'contract'->>'versionId')::uuid AND g.actor_code=p_actor
   AND g.campus=p_input->>'campus' AND g.purpose=p_input->>'purpose' AND g.permission='STORE'
 ) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
$guard$);
 EXECUTE body;
END $store_access$;
