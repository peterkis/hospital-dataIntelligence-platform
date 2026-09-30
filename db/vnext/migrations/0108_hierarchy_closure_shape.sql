SELECT pg_advisory_xact_lock(901002);

CREATE FUNCTION department_master.hierarchy_assert_closure_shape(p_payload jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE field text;
BEGIN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 IF NOT (p_payload ?& ARRAY['requestId','viewId','expectedVersion','action','reason'])
    OR p_payload-ARRAY['requestId','viewId','expectedVersion','action','reason']<>'{}'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 FOREACH field IN ARRAY ARRAY['requestId','viewId'] LOOP
  IF jsonb_typeof(p_payload->field) IS DISTINCT FROM 'string'
     OR coalesce(p_payload->>field,'') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 END LOOP;
 IF jsonb_typeof(p_payload->'expectedVersion') IS DISTINCT FROM 'string'
    OR coalesce(p_payload->>'expectedVersion','') !~ '^[1-9][0-9]*$'
    OR jsonb_typeof(p_payload->'action') IS DISTINCT FROM 'string'
    OR coalesce(p_payload->>'action','') NOT IN ('CLOSE','REVOKE')
    OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
    OR length(p_payload->>'reason')>2000
    OR coalesce(p_payload->>'reason','') !~ '\S' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
END $$;
REVOKE ALL ON FUNCTION department_master.hierarchy_assert_closure_shape(jsonb) FROM PUBLIC,hdi_prototype;

DO $patch$ DECLARE body text; needle text; BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_lifecycle(text,text,jsonb)'::regprocedure);
 needle:='  body:=p_input->''payload'';';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_CLOSURE_SHAPE_PREPARE_MISMATCH'; END IF;
 body:=replace(body,needle,needle||chr(10)||'  PERFORM department_master.hierarchy_assert_closure_shape(body);');
 needle:='   IF c.status<>''APPROVED''';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_CLOSURE_SHAPE_APPLY_MISMATCH'; END IF;
 -- Recheck previously staged candidates before the first terminal write;
 -- already-applied historical requests still replay their immutable event.
 body:=replace(body,needle,'   PERFORM department_master.hierarchy_assert_closure_shape(c.payload);'||chr(10)||needle);
 needle:='  IF p_input - ARRAY[''candidateId'',''requestId'',''digest'']';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_CLOSURE_APPLY_INPUT_MISMATCH'; END IF;
 EXECUTE replace(body,needle,$guard$
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  IF NOT (p_input ?& ARRAY['candidateId','requestId','digest'])
     OR jsonb_typeof(p_input->'candidateId') IS DISTINCT FROM 'string'
     OR coalesce(p_input->>'candidateId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
     OR jsonb_typeof(p_input->'requestId') IS DISTINCT FROM 'string'
     OR coalesce(p_input->>'requestId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
     OR jsonb_typeof(p_input->'digest') IS DISTINCT FROM 'string'
     OR coalesce(p_input->>'digest','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
$guard$||needle);
END $patch$;
