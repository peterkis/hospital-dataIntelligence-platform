SELECT pg_advisory_xact_lock(901002);
-- The final whole-bundle scope check uses the source period immediately before
-- this exact END, including its previously accepted terminal versions.
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.lifecycle_record(text,text)'::regprocedure);
 needle:=$old$CROSS JOIN LATERAL (SELECT facts,valid_to FROM care_organization.ward_nursing_version WHERE ward_nursing_id=rel.id AND action IN ('CREATE','REVISE') ORDER BY number DESC LIMIT 1) original$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_REPARTITION_PREVIOUS_TERMINAL_BASELINE';END IF;
 EXECUTE replace(body,needle,$new$CROSS JOIN LATERAL (SELECT d.facts,least(d.valid_to,(SELECT min(prior_end.valid_from) FROM care_organization.ward_nursing_version prior_end WHERE prior_end.ward_nursing_id=rel.id AND prior_end.action='END' AND prior_end.number<ending.number AND prior_end.recorded_at<=ending.recorded_at)) valid_to FROM care_organization.ward_nursing_version d WHERE d.ward_nursing_id=rel.id AND d.action IN ('CREATE','REVISE') AND d.number<ending.number ORDER BY d.number DESC LIMIT 1) original$new$);
END $$;
