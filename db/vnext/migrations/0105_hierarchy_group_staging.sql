SELECT pg_advisory_xact_lock(901002);

DO $patch$ DECLARE body text; needle text; BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_assert_forest(jsonb)'::regprocedure);
 needle:=' IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->''nodes'') n WHERE n->>''nodeKind''=''GROUP'' AND';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_GROUP_STAGING_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,$guard$
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n WHERE n->>'nodeKind'='GROUP' GROUP BY n->>'groupCode' HAVING count(*)>1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n WHERE n->>'nodeKind'='GROUP' AND n->>'groupId' IS NOT NULL GROUP BY n->>'groupId' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'GROUP_DUPLICATE'; END IF;
$guard$||needle);
END $patch$;
