SELECT pg_advisory_xact_lock(901002);

-- Historical overlap remains visible after a finite assessment window ends.
-- Outstanding obligations are restricted to its remaining future interval.
DO $repair$
DECLARE body text;obligation text;observation text;
BEGIN
 body:=pg_get_functiondef('care_organization.nursing_campus_dependencies(text,uuid,timestamp,timestamp,timestamp)'::regprocedure);
 obligation:='outstanding:=active AND (ending IS NULL OR ending>greatest(p_from,observed));';
 observation:='care_organization.nursing_snapshot_at(p_actor,b.unit_id,coalesce(p_asof,timezone(''Asia/Shanghai'',clock_timestamp())))';
 IF position(obligation IN body)=0 OR position(observation IN body)=0 THEN RAISE EXCEPTION 'NURSING_FINITE_IMPACT_PREDECESSOR_MISMATCH';END IF;
 body:=replace(body,obligation,'outstanding:=active AND (p_to IS NULL OR p_to>observed) AND (ending IS NULL OR ending>greatest(p_from,observed));');
 body:=replace(body,observation,'care_organization.nursing_snapshot_at(p_actor,b.unit_id,observed)');
 EXECUTE body;
END $repair$;
