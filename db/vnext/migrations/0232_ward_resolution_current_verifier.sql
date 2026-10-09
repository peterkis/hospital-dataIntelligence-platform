SELECT pg_advisory_xact_lock(901002);
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_mutate(text,text)'::regprocedure);
 needle:=$old$PERFORM care_organization.lifecycle_care_input_guard(bc->'dependencies',record_at);$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_RESOLUTION_VERIFIER_BASELINE';END IF;
 EXECUTE replace(body,needle,needle||$new$
   SELECT * INTO verify FROM care_organization.ward_verification WHERE input_id=r.id ORDER BY number DESC LIMIT 1;
   IF NOT FOUND OR verify.id::text IS DISTINCT FROM w->'facts'->'managementBasis'->>'verificationId' OR verify.number::text IS DISTINCT FROM w->'facts'->'managementBasis'->>'verificationVersion' OR r.digest IS DISTINCT FROM w->'facts'->'managementBasis'->>'inputDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
   FOREACH campus IN ARRAY r.campus_ids LOOP identity:=care_organization.ward_authorize(verify.actor,campus,'VERIFY');IF identity IS DISTINCT FROM verify.identity_code OR identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;END LOOP;
$new$);
END $$;
