SELECT pg_advisory_xact_lock(901002);

DO $patch$ DECLARE body text; needle text; BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_store_candidate(text,jsonb)'::regprocedure);
 needle:='  IF p_payload->>''parentCardinality''';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_REGISTERED_TYPE_STORE_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,$guard$
  IF p_payload->>'viewType' IS DISTINCT FROM (
    SELECT v.view_type FROM department_master.hierarchy_view_version v
    WHERE v.view_id=(SELECT h.id FROM department_master.hierarchy_view h WHERE h.source_client_key=p_payload->>'sourceClientKey') AND v.version_no=1
  ) THEN RAISE EXCEPTION 'VIEW_TYPE_MISMATCH'; END IF;
$guard$||needle);

 body:=pg_get_functiondef('department_master.hierarchy_publish(text,uuid,text,jsonb)'::regprocedure);
 needle:='  IF p_payload->>''viewCode'' IS DISTINCT FROM';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_REGISTERED_TYPE_PUBLISH_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,$guard$
  IF p_payload->>'viewType' IS DISTINCT FROM (
    SELECT v.view_type FROM department_master.hierarchy_view_version v WHERE v.view_id=target_view_id AND v.version_no=1
  ) THEN RAISE EXCEPTION 'VIEW_TYPE_MISMATCH'; END IF;
$guard$||needle);
END $patch$;

DO $patch$ DECLARE body text; needle text; BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_assert_candidate_shape(jsonb)'::regprocedure);
 needle:='   PERFORM (doc->>field)::timestamp;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_CLOCK_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,$clock$
   BEGIN
    IF substring(doc->>field FROM 12 FOR 2)::integer>23
       OR substring(doc->>field FROM 15 FOR 2)::integer>59
       OR substring(doc->>field FROM 18 FOR 2)::integer>59 THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED'; END IF;
    PERFORM make_date(substring(doc->>field FROM 1 FOR 4)::integer,substring(doc->>field FROM 6 FOR 2)::integer,substring(doc->>field FROM 9 FOR 2)::integer);
    PERFORM (doc->>field)::timestamp;
   EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED';
   END;
$clock$);
END $patch$;
