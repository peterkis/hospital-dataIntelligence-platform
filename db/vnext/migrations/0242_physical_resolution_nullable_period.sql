SELECT pg_advisory_xact_lock(901002);
-- The existing local-time parser deliberately rejects null; unbounded ends stay null.
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('location_master.lifecycle_location_input_guard(text,jsonb,timestamp)'::regprocedure);
 needle:=$old$location_master.local_time(p->>'producerValidTo')$old$;IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_LOCATION_PRODUCER_END_BASELINE';END IF;
 body:=replace(body,needle,$new$(CASE WHEN p->>'producerValidTo' IS NULL THEN NULL ELSE location_master.local_time(p->>'producerValidTo') END)$new$);
 needle:=$old$location_master.local_time(p_basis->>'validTo')$old$;IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_LOCATION_REQUEST_END_BASELINE';END IF;
 body:=replace(body,needle,$new$(CASE WHEN p_basis->>'validTo' IS NULL THEN NULL ELSE location_master.local_time(p_basis->>'validTo') END)$new$);EXECUTE body;
 body:=pg_get_functiondef('location_master.use_mutate(text,text)'::regprocedure);
 needle:=$old$location_master.local_time(w->'facts'->'dependencies'->'location'->>'validTo') IS DISTINCT FROM location_master.local_time(w->>'validTo')$old$;IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_LOCATION_WRITE_END_BASELINE';END IF;
 body:=replace(body,needle,$new$(CASE WHEN w->'facts'->'dependencies'->'location'->>'validTo' IS NULL THEN NULL ELSE location_master.local_time(w->'facts'->'dependencies'->'location'->>'validTo') END) IS DISTINCT FROM (CASE WHEN w->>'validTo' IS NULL THEN NULL ELSE location_master.local_time(w->>'validTo') END)$new$);EXECUTE body;
END $$;
