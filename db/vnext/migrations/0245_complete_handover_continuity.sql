SELECT pg_advisory_xact_lock(901002);
-- Every confirmed whole or partial handover preserves the source's full remaining
-- period and primary responsibility. Standalone safe END remains a separate close.
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_nursing_mutate_0199(text,text)'::regprocedure);
 needle:=$old$SELECT facts INTO oldfacts FROM care_organization.ward_nursing_version WHERE ward_nursing_id=source_coverage.id AND action IN ('CREATE','REVISE') ORDER BY number DESC LIMIT 1;$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WHOLE_HANDOVER_CONTINUITY_BASELINE';END IF;
 EXECUTE replace(body,needle,needle||$new$
    IF w->'facts'->'isPrimary' IS DISTINCT FROM oldfacts->'isPrimary' THEN RAISE EXCEPTION 'HANDOVER_PRIMARY_DISCONTINUITY';END IF;
    IF to_at IS DISTINCT FROM (SELECT valid_to FROM care_organization.ward_nursing_version WHERE ward_nursing_id=source_coverage.id AND action IN ('CREATE','REVISE') ORDER BY number DESC LIMIT 1) THEN RAISE EXCEPTION 'HANDOVER_NOT_CONFIRMED';END IF;
 $new$);
END $$;
