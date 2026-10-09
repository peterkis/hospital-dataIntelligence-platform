SELECT pg_advisory_xact_lock(901002);
-- Align the final whole-scope check with Nursing confirmation and native writes:
-- an immutable prior END at this exact cutover closes the source half, while all
-- other previously accepted ENDs and the declaration still bound its successors.
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.lifecycle_record(text,text)'::regprocedure);
 needle:=$old$prior_end.action='END' AND prior_end.number<ending.number AND prior_end.recorded_at<=ending.recorded_at$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_SCOPE_EXACT_CUTOVER_TERMINAL_BASELINE';END IF;
 EXECUTE replace(body,needle,$new$prior_end.action='END' AND prior_end.valid_from<>ending.valid_from AND prior_end.number<ending.number AND prior_end.recorded_at<=ending.recorded_at$new$);
END $$;
