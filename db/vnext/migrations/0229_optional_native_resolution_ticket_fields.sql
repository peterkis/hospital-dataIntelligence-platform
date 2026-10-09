SELECT pg_advisory_xact_lock(901002);
DO $$DECLARE body text;routine text;needle text;BEGIN
 FOREACH routine IN ARRAY ARRAY['care_organization.ward_mutate(text,text)','location_master.use_mutate(text,text)'] LOOP
  body:=pg_get_functiondef(routine::regprocedure);needle:=$old$'digest','recordAt','recordAtProof','resolutions']);$old$;
  IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_OPTIONAL_RESOLUTION_TICKET_BASELINE';END IF;
  EXECUTE replace(body,needle,$new$'digest','recordAt','recordAtProof']||(CASE WHEN t ? 'resolutions' THEN ARRAY['resolutions'] ELSE ARRAY[]::text[] END));$new$);
 END LOOP;
END $$;
