SELECT pg_advisory_xact_lock(901002);

-- Legacy committed bindings keep their original evidence. Unsubmitted bindings
-- without these pins require a new independently verified and approved candidate.
ALTER TABLE care_organization.unit_ward_apply_binding
 ADD COLUMN verification_id uuid REFERENCES care_organization.unit_ward_verification(id),
 ADD COLUMN verification_number bigint CHECK(verification_number>0),
 ADD COLUMN verification_digest text CHECK(verification_digest ~ '^[a-f0-9]{64}$'),
 ADD CONSTRAINT unit_ward_verification_pin_complete CHECK(
  (verification_id IS NULL AND verification_number IS NULL AND verification_digest IS NULL) OR
  (verification_id IS NOT NULL AND verification_number IS NOT NULL AND verification_digest IS NOT NULL));

DO $repair$
DECLARE body text;freeze_needle text;apply_needle text;current_verification text;BEGIN
 body:=pg_get_functiondef('care_organization.unit_ward_mutate(text,text)'::regprocedure);
 current_verification:=$check$
 SELECT * INTO verify FROM care_organization.unit_ward_verification WHERE input_id=r.id ORDER BY number DESC LIMIT 1;
 IF verify.id IS NULL THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 PERFORM care_organization.unit_ward_job_read(verify.actor,r.id);
 FOREACH campus IN ARRAY r.campus_ids LOOP
  identity:=care_organization.unit_ward_authorize(verify.actor,campus,'VERIFY');
  IF identity IS DISTINCT FROM verify.identity_code OR identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(t->'writes') value WHERE
  value->'facts'->'verificationBasis'->>'id' IS DISTINCT FROM verify.id::text OR
  value->'facts'->'verificationBasis'->>'version' IS DISTINCT FROM verify.number::text OR
  value->'facts'->'verificationBasis'->>'digest' IS DISTINCT FROM r.digest) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
$check$;
 freeze_needle:=$old$INSERT INTO care_organization.unit_ward_apply_binding VALUES((c->>'id')::uuid,r.id,c->>'digest',t->>'writesDigest',encode(sha256(convert_to((t->'writes')::text,'UTF8')),'hex'));RETURN '{}';$old$;
 apply_needle:=$old$ j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));IF r.job_revision IS DISTINCT FROM (j->>'currentRevisionId')::uuid THEN RAISE EXCEPTION 'STALE_REVISION';END IF;$old$;
 IF position(freeze_needle IN body)=0 OR position(apply_needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_WARD_VERIFICATION_PINS_BASELINE_MISMATCH';END IF;
 body:=replace(body,freeze_needle,current_verification||$new$INSERT INTO care_organization.unit_ward_apply_binding(candidate_id,input_id,candidate_digest,writes_digest,writes_hash,verification_id,verification_number,verification_digest) VALUES((c->>'id')::uuid,r.id,c->>'digest',t->>'writesDigest',encode(sha256(convert_to((t->'writes')::text,'UTF8')),'hex'),verify.id,verify.number,verify.digest);RETURN '{}';$new$);
 -- This location is after exact committed recovery, before any new fact write.
 body:=replace(body,apply_needle,current_verification||$new$IF frozen.verification_id IS DISTINCT FROM verify.id OR frozen.verification_number IS DISTINCT FROM verify.number OR frozen.verification_digest IS DISTINCT FROM verify.digest THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
$new$||apply_needle);
 EXECUTE body;
END $repair$;
