SELECT pg_advisory_xact_lock(901002);

-- A scheduled opening is a pre-exit plan only when its own opening instant
-- remains strictly before the effective retirement boundary. The command
-- period may end at that boundary, so the period-overlap check alone is not
-- sufficient.
DO $opening_boundary$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('organization_master.campus_write_approved(text,text)'::regprocedure);
 needle:=$old$ AND (p_command->>'action'='RETIRE' OR ce.valid_from<=timezone('Asia/Shanghai',clock_timestamp()) OR tsrange(ce.valid_from,ce.valid_to,'[)') && tsrange((p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,'[)')))$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAMPUS_OPENING_RETIREMENT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$ AND (p_command->>'action'='RETIRE' OR (p_command->>'action'='SCHEDULE_OPENING' AND (p_command->>'plannedOpeningAt')::timestamp>=ce.valid_from) OR ce.valid_from<=timezone('Asia/Shanghai',clock_timestamp()) OR tsrange(ce.valid_from,ce.valid_to,'[)') && tsrange((p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,'[)')))$new$);
 EXECUTE body;
END $opening_boundary$;
