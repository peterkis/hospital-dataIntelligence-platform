SELECT pg_advisory_xact_lock(901002);
-- Completing an independently accepted END at the same exact cutover creates
-- successors; it never reopens the source. Every other accepted END remains an
-- upper bound, and the existing current-head/confirmation/gap guards remain.
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_nursing_mutate_0199(text,text)'::regprocedure);
 needle:=$old$e.action='END' AND e.number<=(handover->'source'->>'expectedHead')::bigint AND e.recorded_at<=record_at$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_EXACT_CUTOVER_TERMINAL_BASELINE';END IF;
 EXECUTE replace(body,needle,$new$e.action='END' AND e.valid_from<>from_at AND e.number<=(handover->'source'->>'expectedHead')::bigint AND e.recorded_at<=record_at$new$);
END $$;
