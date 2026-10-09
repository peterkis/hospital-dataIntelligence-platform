SELECT pg_advisory_xact_lock(901002);
DO $$DECLARE body text;needle text;principal text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_mutate(text,text)'::regprocedure);
 FOREACH principal IN ARRAY ARRAY['actor','approved_by','verify.actor'] LOOP
  needle:='care_organization.unit_ward_operating_guard('||principal||$old$,resolution->'basis'->'current',care_organization.local_time(bc->>'validFrom'),CASE WHEN bc->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(bc->>'validTo') END,record_at)$old$;
  IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_OPERATING_GUARD_CONTRACT_BASELINE';END IF;
  body:=replace(body,needle,'care_organization.unit_ward_operating_guard('||principal||$new$,jsonb_build_object('unit',resolution->'basis'),record_at)$new$);
 END LOOP;EXECUTE body;
END $$;
