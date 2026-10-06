SELECT pg_advisory_xact_lock(901002);

-- Apply/recovery require current Care protected-evidence authority for both
-- the executor and original approver, independently of the signed application.
DO $repair$
DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.unit_ward_mutate(text,text)'::regprocedure);
 needle:=$old$ SELECT * INTO frozen FROM care_organization.unit_ward_apply_binding WHERE candidate_id=(c->>'id')::uuid;$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_WARD_EVIDENCE_AUTHORITY_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,' PERFORM care_organization.unit_ward_job_read(actor,r.id);PERFORM care_organization.unit_ward_job_read(approved_by,r.id);'||chr(10)||needle);
END $repair$;
