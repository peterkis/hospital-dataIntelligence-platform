SELECT pg_advisory_xact_lock(901002);

-- A publication cannot borrow the action of a later independent closure.
DO $$
DECLARE definition text;
 old_guard text := $old$IF candidate.id IS DISTINCT FROM closure.candidate_id AND view_version.content_digest IS DISTINCT FROM candidate.payload->>'validationDigest' THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;$old$;
 new_guard text := $new$IF closure.id IS NOT NULL THEN
   IF candidate.id IS DISTINCT FROM closure.candidate_id THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  ELSIF view_version.content_digest IS DISTINCT FROM candidate.payload->>'validationDigest' THEN
   RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';
  END IF;$new$;
BEGIN
 definition:=pg_get_functiondef('department_master.impact_result(text,jsonb,text)'::regprocedure);
 IF (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1 THEN RAISE EXCEPTION 'IMPACT_CLOSURE_BASELINE_MISMATCH';END IF;
 EXECUTE replace(definition,old_guard,new_guard);
END $$;
