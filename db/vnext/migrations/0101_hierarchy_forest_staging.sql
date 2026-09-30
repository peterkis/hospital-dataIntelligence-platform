SELECT pg_advisory_xact_lock(901002);

-- Pure forest validation is required before staging as well as before publication.
CREATE FUNCTION department_master.hierarchy_assert_forest(p_payload jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF p_payload->>'validTo' IS NOT NULL AND (p_payload->>'validTo')::timestamp<=(p_payload->>'validFrom')::timestamp THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n WHERE
   (n->'sourceEvidence'->>'validFrom')::timestamp IS DISTINCT FROM (p_payload->>'validFrom')::timestamp OR
   (n->'sourceEvidence'->>'validTo')::timestamp IS DISTINCT FROM (p_payload->>'validTo')::timestamp) THEN RAISE EXCEPTION 'MIXED_EDGE_PERIOD'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n GROUP BY n->>'nodeKey' HAVING count(*)>1) THEN RAISE EXCEPTION 'DUPLICATE_NODE_KEY'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n GROUP BY n->'sourceEvidence'->>'sourceSystemId',n->'sourceEvidence'->>'sourceClientKey' HAVING count(*)>1) THEN RAISE EXCEPTION 'DUPLICATE_EDGE_SOURCE'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n WHERE n->>'nodeKind'='DEPARTMENT' GROUP BY n->>'departmentId' HAVING count(*)>1) THEN RAISE EXCEPTION 'DEPARTMENT_DUPLICATE'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n WHERE n->>'nodeKind'='GROUP' AND (n->>'groupId' IS NULL)<>(n->>'groupVersionId' IS NULL)) THEN RAISE EXCEPTION 'GROUP_REFERENCE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n WHERE n->>'parentNodeKey'=n->>'nodeKey') THEN RAISE EXCEPTION 'SELF_PARENT'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n WHERE n->>'parentNodeKey' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') p WHERE p->>'nodeKey'=n->>'parentNodeKey')) THEN RAISE EXCEPTION 'PARENT_NOT_FOUND'; END IF;
 -- With unique node keys and at most one parent, a component unreachable from
 -- every root must contain a cycle. Root traversal itself cannot enter a cycle.
 IF (WITH RECURSIVE walk(node_key) AS (
   SELECT n->>'nodeKey' FROM jsonb_array_elements(p_payload->'nodes') n WHERE n->>'parentNodeKey' IS NULL
   UNION ALL
   SELECT n->>'nodeKey' FROM walk JOIN jsonb_array_elements(p_payload->'nodes') n ON n->>'parentNodeKey'=walk.node_key
 ) SELECT count(*) FROM walk)<>jsonb_array_length(p_payload->'nodes') THEN RAISE EXCEPTION 'HIERARCHY_CYCLE'; END IF;
 IF EXISTS(WITH RECURSIVE walk(node_key,depth) AS (
   SELECT n->>'nodeKey',0 FROM jsonb_array_elements(p_payload->'nodes') n WHERE n->>'parentNodeKey' IS NULL
   UNION ALL
   SELECT n->>'nodeKey',walk.depth+1 FROM walk JOIN jsonb_array_elements(p_payload->'nodes') n ON n->>'parentNodeKey'=walk.node_key
 ) SELECT 1 FROM walk JOIN jsonb_array_elements(p_payload->'nodes') n ON n->>'nodeKey'=walk.node_key WHERE (n->>'depth')::integer<>walk.depth) THEN RAISE EXCEPTION 'DEPTH_MISMATCH'; END IF;
END $$;
REVOKE ALL ON FUNCTION department_master.hierarchy_assert_forest(jsonb) FROM PUBLIC,hdi_prototype;

DO $patch$ DECLARE body text; needle text; signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY['department_master.hierarchy_store_candidate(text,jsonb)','department_master.hierarchy_publish(text,uuid,text,jsonb)'] LOOP
  body:=pg_get_functiondef(signature::regprocedure);
  needle:='  IF p_payload->>''parentCardinality''';
  IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_FOREST_BASELINE_MISMATCH'; END IF;
  -- Both entry points perform the closed candidate shape check before this line.
  EXECUTE replace(body,needle,'  PERFORM department_master.hierarchy_assert_forest(p_payload);'||chr(10)||needle);
 END LOOP;
END $patch$;
