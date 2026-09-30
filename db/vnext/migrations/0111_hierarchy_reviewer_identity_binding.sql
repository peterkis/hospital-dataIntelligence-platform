SELECT pg_advisory_xact_lock(901002);

-- Retained actor grants do not transfer an existing person's approval to a
-- replacement identity. Both Owner and direct SQL publication use this guard.
-- The earlier APPLIED branch keeps immutable historical replay non-expanding.
DO $patch$ DECLARE body text; needle text; BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_publish(text,uuid,text,jsonb)'::regprocedure);
 needle:='  IF department_master.hierarchy_authorize(c.approved_by,c.view_id,''REVIEW'') IS NULL THEN RAISE EXCEPTION ''ACCESS_DENIED''; END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_REVIEWER_IDENTITY_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,'  IF department_master.hierarchy_authorize(c.approved_by,c.view_id,''REVIEW'') IS DISTINCT FROM c.approved_identity THEN RAISE EXCEPTION ''MAKER_CHECKER_REQUIRED''; END IF;');
END $patch$;
