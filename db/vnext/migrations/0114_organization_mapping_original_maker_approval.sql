SELECT pg_advisory_xact_lock(901002);
-- Keep historical inputs, candidates and approvals immutable. Enforce the original
-- input maker identity at the final SQL write boundary for future applications.
DO $repair$
DECLARE body text; needle text;
BEGIN
 body:=pg_get_functiondef('department_master.mapping_mutate(text,text)'::regprocedure);
 needle:='PERFORM department_master.mapping_input_read(a.actor_code,r.id,''REVIEW'');';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'MAPPING_APPLY_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,needle||E'\n IF a.identity_code=r.identity_code THEN RAISE EXCEPTION ''MAKER_CHECKER_REQUIRED''; END IF;');
 EXECUTE body;
END $repair$;
