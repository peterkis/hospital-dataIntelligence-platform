SELECT pg_advisory_xact_lock(901002);

DO $patch$ DECLARE body text; needle text; BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_create_view(text,jsonb)'::regprocedure);
 needle:='DECLARE identity text; view_id uuid; digest text;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_REGISTRATION_SHAPE_DECLARE_MISMATCH'; END IF;
 body:=replace(body,needle,needle||' shape_field text; shape_entry record;');
 needle:='  IF EXISTS (SELECT 1 FROM department_master.hierarchy_view WHERE source_client_key=';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_REGISTRATION_SHAPE_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,$guard$
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  IF NOT (p_payload ?& ARRAY['requestId','sourceClientKey','viewCode','viewName','viewType','purpose','aggregationRule','ownerDepartmentId','sourceSystemId','sourceRecordId','sourceVersion','validFrom','validTo','recordedAt','approvalRef','viewDigest'])
     OR p_payload-ARRAY['requestId','sourceClientKey','viewCode','viewName','viewType','purpose','aggregationRule','ownerDepartmentId','sourceSystemId','sourceRecordId','sourceVersion','validFrom','validTo','recordedAt','approvalRef','viewDigest','profile','dependencies']<>'{}'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  FOR shape_entry IN SELECT key,value FROM jsonb_each_text('{"sourceClientKey":128,"viewCode":64,"viewName":256,"viewType":32,"purpose":2000,"aggregationRule":2000,"sourceRecordId":256,"sourceVersion":64,"approvalRef":256,"viewDigest":64}'::jsonb) LOOP
   shape_field:=shape_entry.key;
   IF jsonb_typeof(p_payload->shape_field) IS DISTINCT FROM 'string'
      OR length(p_payload->>shape_field)>shape_entry.value::integer
      OR coalesce(p_payload->>shape_field,'') !~ '\S' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  END LOOP;
  FOREACH shape_field IN ARRAY ARRAY['requestId','ownerDepartmentId','sourceSystemId'] LOOP
   IF shape_field='ownerDepartmentId' AND p_payload->shape_field='null'::jsonb THEN CONTINUE; END IF;
   IF jsonb_typeof(p_payload->shape_field) IS DISTINCT FROM 'string'
      OR coalesce(p_payload->>shape_field,'') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  END LOOP;
  IF p_payload->>'viewType' NOT IN ('ADMINISTRATIVE','OPERATIONAL','MEDICAL_RECORD','FINANCE','STATISTICAL') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
$guard$||needle);
END $patch$;
