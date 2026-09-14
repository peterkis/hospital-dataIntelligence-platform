SELECT pg_advisory_xact_lock(901002);
-- No durable production key-provider or trusted retrospective scan exists in P0-11.
-- Fail the upgrade rather than classify prior encrypted artifacts as digest-safe.
-- The current development database has no persistent artifacts; legacy evidence,
-- including purged artifact references, requires separately controlled scan/remediation.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM governance_catalog.protected_artifact) THEN
  RAISE EXCEPTION 'PROTECTED_LEGACY_SCAN_REQUIRED';
 END IF;
END $$;

-- A failure-attempt recorder, never an authorization or outcome-granting command.
-- It deliberately needs no target lookup: an intervening revocation must not erase
-- an already rejected attempt. Only validated non-sensitive reference metadata enters it.
CREATE FUNCTION governance_catalog.protected_digest_denial(p_actor text,p_input jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR
    p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR
    coalesce(p_input->>'campus','') NOT IN ('NORTH','SOUTH') OR
    coalesce(p_input->>'purpose','') NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED') OR
    coalesce(p_input->>'jobId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR
    coalesce(p_input->>'revisionId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR
    coalesce(p_input->>'requestId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR
    EXISTS(SELECT 1 FROM jsonb_each(p_input) kv WHERE jsonb_typeof(kv.value) IS DISTINCT FROM 'string') OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','jobId','revisionId','requestId'))
 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(901002);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest)
 VALUES(CASE WHEN EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=p_actor) THEN p_actor ELSE 'UNKNOWN_ACTOR' END,
   (p_input->>'jobId')::uuid,'PROTECTED_STORE_'||(p_input->>'purpose')||'_'||(p_input->>'campus'),
   'PUBLIC_DIGEST_CONFLICT',encode(sha256(convert_to(p_input::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION governance_catalog.protected_digest_denial(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.protected_digest_denial(text,jsonb) TO hdi_prototype;
