-- PR7: preserve installed migration bytes and reject consumed output identities
-- before evaluation. The existing authorization lock serializes this with STORE.
SELECT pg_advisory_xact_lock(901002);
DO $guard$
DECLARE body text; needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.validation_prior(text,jsonb)'::regprocedure);
 needle:=' IF NOT FOUND THEN RETURN NULL; END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'VALIDATION_PRIOR_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,$replacement$
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM vnext_control.request_identity i WHERE i.identity_code=identity AND i.request_id=(p_input->>'outputRequestId')::uuid) THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
  RETURN NULL;
 END IF;$replacement$);
 EXECUTE body;
END $guard$;
