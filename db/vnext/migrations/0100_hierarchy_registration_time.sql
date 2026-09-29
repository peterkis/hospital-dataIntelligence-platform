SELECT pg_advisory_xact_lock(901002);

DO $patch$ DECLARE body text; needle text; BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_create_view(text,jsonb)'::regprocedure);
 needle:='DECLARE identity text; view_id uuid; digest text;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_REGISTRATION_DECLARE_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,needle||' clock_field text;');
 needle:='  digest:=p_payload->>''viewDigest'';';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_REGISTRATION_CLOCK_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,$guard$
  FOREACH clock_field IN ARRAY ARRAY['validFrom','validTo','recordedAt'] LOOP
   IF clock_field='validTo' AND p_payload->clock_field='null'::jsonb THEN CONTINUE; END IF;
   IF jsonb_typeof(p_payload->clock_field) IS DISTINCT FROM 'string'
      OR coalesce(p_payload->>clock_field,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$' THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED'; END IF;
   BEGIN
    IF substring(p_payload->>clock_field FROM 12 FOR 2)::integer>23
       OR substring(p_payload->>clock_field FROM 15 FOR 2)::integer>59
       OR substring(p_payload->>clock_field FROM 18 FOR 2)::integer>59 THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED'; END IF;
    PERFORM make_date(substring(p_payload->>clock_field FROM 1 FOR 4)::integer,substring(p_payload->>clock_field FROM 6 FOR 2)::integer,substring(p_payload->>clock_field FROM 9 FOR 2)::integer);
   EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED';
   END;
  END LOOP;
  IF p_payload->>'validTo' IS NOT NULL AND (p_payload->>'validTo')::timestamp<=(p_payload->>'validFrom')::timestamp THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD'; END IF;
$guard$||needle);
END $patch$;
