SELECT pg_advisory_xact_lock(901002);

DO $patch$ DECLARE body text; needle text; BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_publish(text,uuid,text,jsonb)'::regprocedure);
 needle:='  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->''nodes'') n GROUP BY n->>''nodeKey'' HAVING count(*)>1)';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_NODE_SHAPE_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,$guard$
  IF EXISTS (
   SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n
   WHERE jsonb_typeof(n) IS DISTINCT FROM 'object'
    OR coalesce(n->>'nodeKind','') NOT IN ('DEPARTMENT','GROUP')
    OR NOT (n ?& ARRAY['sourceEvidence','nodeKey','parentNodeKey','nodeKind','displayName','relationName','sortOrder','isPrimaryPath','depth'])
    OR (n->>'nodeKind'='DEPARTMENT' AND (
       NOT (n ?& ARRAY['departmentId','departmentVersionId'])
       OR n - ARRAY['sourceEvidence','nodeKey','parentNodeKey','nodeKind','displayName','relationName','sortOrder','isPrimaryPath','depth','departmentId','departmentVersionId'] <> '{}'::jsonb))
    OR (n->>'nodeKind'='GROUP' AND (
       NOT (n ?& ARRAY['groupCode','groupId','groupVersionId'])
       OR n - ARRAY['sourceEvidence','nodeKey','parentNodeKey','nodeKind','displayName','relationName','sortOrder','isPrimaryPath','depth','groupCode','groupId','groupVersionId'] <> '{}'::jsonb))
  ) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n WHERE n->>'nodeKind'='GROUP' GROUP BY n->>'groupCode' HAVING count(*)>1)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n WHERE n->>'nodeKind'='GROUP' AND n->>'groupId' IS NOT NULL GROUP BY n->>'groupId' HAVING count(*)>1)
  THEN RAISE EXCEPTION 'GROUP_DUPLICATE'; END IF;
$guard$||needle);
END $patch$;
