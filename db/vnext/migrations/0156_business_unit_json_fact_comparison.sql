SELECT pg_advisory_xact_lock(901002);
-- JSON extraction must be parenthesized before subtracting metadata keys.
DO $comparison$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.mutate(text,text)'::regprocedure);needle:='w->''facts''-ARRAY';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_FACT_COMPARISON_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'(w->''facts'')-ARRAY');
END $comparison$;
