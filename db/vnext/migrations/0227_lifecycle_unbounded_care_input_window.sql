SELECT pg_advisory_xact_lock(901002);
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('location_master.use_mutate(text,text)'::regprocedure);
 needle:=$old$care_organization.local_time(w->'facts'->'dependencies'->'upstream'->>'validTo') IS DISTINCT FROM care_organization.local_time(w->>'validTo')$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_UNBOUNDED_RESOLUTION_BASELINE';END IF;
 EXECUTE replace(body,needle,$new$(CASE WHEN w->'facts'->'dependencies'->'upstream'->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(w->'facts'->'dependencies'->'upstream'->>'validTo') END) IS DISTINCT FROM (CASE WHEN w->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(w->>'validTo') END)$new$);
END $$;
