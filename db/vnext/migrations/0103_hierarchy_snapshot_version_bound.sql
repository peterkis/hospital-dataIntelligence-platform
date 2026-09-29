SELECT pg_advisory_xact_lock(901002);

DO $patch$ DECLARE body text; needle text; BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_read(text,text,jsonb)'::regprocedure);
 needle:='  target_view:=(p_input->>''viewId'')::uuid;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_VERSION_BOUND_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,$guard$
  IF p_input ? 'version' AND (
     jsonb_typeof(p_input->'version') IS DISTINCT FROM 'string'
     OR length(p_input->>'version')>19
     OR (length(p_input->>'version')=19 AND (p_input->>'version') COLLATE "C">'9223372036854775807')
  ) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
$guard$||needle);
END $patch$;
