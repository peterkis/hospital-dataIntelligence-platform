SELECT pg_advisory_xact_lock(901002);
-- The source's remaining upper bound includes every previously accepted END.
-- Ignore the END being applied now, using the exact source expected head.
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_nursing_mutate_0199(text,text)'::regprocedure);
 needle:=$old$(SELECT valid_to FROM care_organization.ward_nursing_version WHERE ward_nursing_id=source_coverage.id AND action IN ('CREATE','REVISE') ORDER BY number DESC LIMIT 1)$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_HANDOVER_PREVIOUS_TERMINAL_BASELINE';END IF;
 EXECUTE replace(body,needle,$new$(SELECT least(d.valid_to,(SELECT min(e.valid_from) FROM care_organization.ward_nursing_version e WHERE e.ward_nursing_id=source_coverage.id AND e.action='END' AND e.number<=(handover->'source'->>'expectedHead')::bigint AND e.recorded_at<=record_at)) FROM care_organization.ward_nursing_version d WHERE d.ward_nursing_id=source_coverage.id AND d.action IN ('CREATE','REVISE') AND d.number<=(handover->'source'->>'expectedHead')::bigint ORDER BY d.number DESC LIMIT 1)$new$);
END $$;
