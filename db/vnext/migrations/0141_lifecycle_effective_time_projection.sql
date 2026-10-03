SELECT pg_advisory_xact_lock(901002);
DO $projection$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('department_master.lifecycle_state_periods(uuid,timestamp)'::regprocedure);
 needle:='WHERE department_id=p_id AND recorded_at<=p_asof ORDER BY number LOOP';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'LIFECYCLE_TIME_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,'WHERE department_id=p_id AND recorded_at<=p_asof ORDER BY effective_at,number LOOP');
END $projection$;
