-- Bind approved stable metadata at the SECURITY DEFINER publication boundary.
-- Application validation remains useful for diagnostics, but a caller that can
-- execute the owner function must not be able to publish a partial or malformed
-- tree by bypassing the TypeBox owner.
SELECT pg_advisory_xact_lock(901002);

ALTER TABLE department_master.hierarchy_node ADD COLUMN group_code text;
-- Recover only from the approved candidate matching this exact snapshot digest.
UPDATE department_master.hierarchy_node n SET group_code=(
  SELECT item->>'groupCode'
  FROM department_master.hierarchy_view_version v
  JOIN department_master.hierarchy_candidate c ON c.payload->>'validationDigest'=v.content_digest AND c.view_id=v.view_id
  CROSS JOIN LATERAL jsonb_array_elements(c.payload->'nodes') item
  WHERE v.id=n.view_version_id AND item->>'nodeKey'=n.node_key
) WHERE n.node_kind='GROUP';
ALTER TABLE department_master.hierarchy_node ADD CONSTRAINT hierarchy_group_code_shape
 CHECK ((node_kind='GROUP' AND group_code IS NOT NULL AND group_code ~ '\S') OR (node_kind='DEPARTMENT' AND group_code IS NULL));

CREATE TRIGGER hierarchy_version_immutable
  BEFORE UPDATE OR DELETE ON department_master.hierarchy_view_version
  FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE TRIGGER hierarchy_node_immutable
  BEFORE UPDATE OR DELETE ON department_master.hierarchy_node
  FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();

CREATE OR REPLACE FUNCTION department_master.hierarchy_publish(p_actor text, p_candidate_id uuid, p_digest text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,department_master,vnext_control AS $$
DECLARE
 c hierarchy_candidate;
 identity text;
 target_view_id uuid;
 version_no bigint;
 version_id uuid;
 item jsonb;
 node_id uuid;
 group_id uuid;
 group_version_id uuid;
 p_valid_from timestamp;
 p_valid_to timestamp;
 owner_id uuid;
 source_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(901002);
  identity:=department_master.authorize(p_actor,'HOSPITAL','WRITE');
  SELECT * INTO c FROM department_master.hierarchy_candidate WHERE id=p_candidate_id AND digest=p_digest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF c.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
  IF c.payload->>'validationDigest' IS DISTINCT FROM p_payload->>'validationDigest'
     OR c.payload->>'requestId' IS DISTINCT FROM p_payload->>'requestId'
     OR c.payload->>'sourceClientKey' IS DISTINCT FROM p_payload->>'sourceClientKey'
     OR c.payload->'nodes' IS DISTINCT FROM p_payload->'nodes' THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
  IF c.status='APPLIED' THEN
    SELECT v.view_id,v.version_no INTO target_view_id,version_no
      FROM department_master.hierarchy_view_version v
     WHERE v.content_digest=p_payload->>'validationDigest'
     ORDER BY v.version_no DESC LIMIT 1;
    IF target_view_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    RETURN jsonb_build_object('viewId',target_view_id,'version',version_no::text);
  END IF;
  IF c.status<>'APPROVED' OR c.approved_by IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED'; END IF;
  IF department_master.authorize(c.approved_by,'HOSPITAL','REVIEW') IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF c.maker_identity=c.approved_identity THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED'; END IF;

  IF p_payload->>'parentCardinality' IS DISTINCT FROM 'STRICT_TREE'
     OR p_payload->>'recordStatus' IS DISTINCT FROM 'ACTIVE'
     OR p_payload->>'viewType' IN ('FINANCE','STATISTICAL')
     OR p_payload->>'viewType' IS NULL
     OR p_payload->>'viewName' IS NULL
     OR p_payload->>'purpose' IS NULL
     OR p_payload->>'aggregationRule' IS NULL
     OR p_payload->>'sourceRecordId' IS NULL
     OR p_payload->>'sourceVersion' IS NULL
     OR p_payload->>'approvalRef' IS NULL
     OR p_payload->>'validationDigest' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  IF p_payload->>'validFrom' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$'
     OR (p_payload->>'validTo' IS NOT NULL AND p_payload->>'validTo' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$')
     OR p_payload->>'recordedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$' THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED'; END IF;
  p_valid_from:=(p_payload->>'validFrom')::timestamp;
  p_valid_to:=(p_payload->>'validTo')::timestamp;
  IF p_valid_to IS NOT NULL AND p_valid_to<=p_valid_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD'; END IF;

  SELECT id INTO target_view_id FROM department_master.hierarchy_view
   WHERE source_client_key=p_payload->>'sourceClientKey' FOR UPDATE;
  IF NOT FOUND OR (p_payload->>'viewId' IS NOT NULL AND p_payload->>'viewId'<>'' AND target_view_id::text IS DISTINCT FROM p_payload->>'viewId') THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
  IF p_payload->>'viewCode' IS DISTINCT FROM (SELECT h.view_code FROM department_master.hierarchy_view h WHERE h.id=target_view_id) THEN
    RAISE EXCEPTION 'VIEW_CODE_MISMATCH';
  END IF;

  IF coalesce(p_payload->>'ownerDepartmentId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
  owner_id:=(p_payload->>'ownerDepartmentId')::uuid;
  IF NOT EXISTS(
    SELECT 1 FROM department_master.version v
       WHERE v.department_id=owner_id AND v.valid_from<=p_valid_from
       AND (v.valid_to IS NULL OR v.valid_to>p_valid_from)
       AND (v.valid_to IS NULL OR (p_valid_to IS NOT NULL AND v.valid_to>=p_valid_to))
  ) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;

  IF coalesce(p_payload->>'sourceSystemId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
  source_id:=(p_payload->>'sourceSystemId')::uuid;
  IF NOT EXISTS(
    SELECT 1
      FROM governance_catalog.object o
      JOIN LATERAL (SELECT e.version_id,e.status FROM governance_catalog.event e WHERE e.object_id=o.id ORDER BY e.head DESC LIMIT 1) e ON true
      JOIN governance_catalog.version sv ON sv.id=e.version_id
     WHERE o.id=source_id AND o.kind='SOURCE' AND o.scope='SYNTHETIC' AND e.status='PUBLISHED'
       AND sv.valid_from<=p_valid_from AND (sv.valid_to IS NULL OR sv.valid_to>p_valid_from)
       AND (sv.valid_to IS NULL OR (p_valid_to IS NOT NULL AND sv.valid_to>=p_valid_to))
  ) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;

  IF jsonb_typeof(p_payload->'nodes') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'nodes')<1 OR jsonb_array_length(p_payload->'nodes')>100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n
     WHERE coalesce(n->>'nodeKey','')='' OR n->>'nodeKey' ~ '^\s*$'
       OR n->>'nodeKind' NOT IN ('DEPARTMENT','GROUP')
       OR coalesce(n->>'displayName','')='' OR n->>'displayName' ~ '^\s*$'
       OR coalesce(n->>'relationName','')='' OR n->>'relationName' ~ '^\s*$'
       OR coalesce(n->>'sortOrder','') !~ '^[0-9]+$'
       OR coalesce(n->>'depth','') !~ '^[0-9]+$'
       OR jsonb_typeof(n->'isPrimaryPath') IS DISTINCT FROM 'boolean'
  ) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n GROUP BY n->>'nodeKey' HAVING count(*)>1) THEN RAISE EXCEPTION 'DUPLICATE_NODE_KEY'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n WHERE n->>'parentNodeKey' IS NOT NULL AND btrim(n->>'parentNodeKey')='') THEN RAISE EXCEPTION 'PARENT_NOT_FOUND'; END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n
     WHERE n->>'parentNodeKey' IS NOT NULL AND n->>'parentNodeKey'=n->>'nodeKey'
  ) THEN RAISE EXCEPTION 'SELF_PARENT'; END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n
     WHERE n->>'parentNodeKey' IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') p WHERE p->>'nodeKey'=n->>'parentNodeKey')
  ) THEN RAISE EXCEPTION 'PARENT_NOT_FOUND'; END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n
     WHERE n->>'nodeKind'='DEPARTMENT'
       AND (coalesce(n->>'departmentId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR coalesce(n->>'departmentVersionId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR n ? 'groupId' OR n ? 'groupVersionId')
  ) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n
     WHERE n->>'nodeKind'='GROUP'
       AND (n ? 'departmentId' OR n ? 'departmentVersionId'
         OR (n->>'groupId' IS NULL) <> (n->>'groupVersionId' IS NULL)
         OR coalesce(n->>'groupCode','')='' OR n->>'groupCode' ~ '^\s*$')
  ) THEN RAISE EXCEPTION 'GROUP_REFERENCE_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n WHERE n->>'nodeKind'='DEPARTMENT' GROUP BY n->>'departmentId' HAVING count(*)>1) THEN RAISE EXCEPTION 'DEPARTMENT_DUPLICATE'; END IF;

  IF EXISTS(
    WITH RECURSIVE walk(node_key,path,cycle) AS (
      SELECT n->>'nodeKey',ARRAY[n->>'nodeKey'],false
        FROM jsonb_array_elements(p_payload->'nodes') n WHERE n->>'parentNodeKey' IS NULL
      UNION ALL
      SELECT child->>'nodeKey',walk.path||(child->>'nodeKey'),(child->>'nodeKey')=ANY(walk.path)
        FROM walk JOIN jsonb_array_elements(p_payload->'nodes') child ON child->>'parentNodeKey'=walk.node_key
       WHERE NOT walk.cycle
    ) SELECT 1 FROM walk WHERE cycle
  ) THEN RAISE EXCEPTION 'HIERARCHY_CYCLE'; END IF;
  IF EXISTS(
    WITH RECURSIVE walk(node_key,path) AS (
      SELECT n->>'nodeKey',ARRAY[n->>'nodeKey']
        FROM jsonb_array_elements(p_payload->'nodes') n WHERE n->>'parentNodeKey' IS NULL
      UNION ALL
      SELECT child->>'nodeKey',walk.path||(child->>'nodeKey')
        FROM walk JOIN jsonb_array_elements(p_payload->'nodes') child ON child->>'parentNodeKey'=walk.node_key
    )
    SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n
     WHERE (n->>'depth')::integer IS DISTINCT FROM (SELECT max(array_length(w.path,1)-1) FROM walk w WHERE w.node_key=n->>'nodeKey')
  ) THEN RAISE EXCEPTION 'DEPTH_MISMATCH'; END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_payload->'nodes') n
     WHERE n->>'nodeKind'='DEPARTMENT' AND NOT EXISTS(
       SELECT 1 FROM department_master.version v
        WHERE v.id=(n->>'departmentVersionId')::uuid AND v.department_id=(n->>'departmentId')::uuid
          AND v.valid_from<=p_valid_from AND (v.valid_to IS NULL OR v.valid_to>p_valid_from)
          AND (v.valid_to IS NULL OR (p_valid_to IS NOT NULL AND v.valid_to>=p_valid_to))
     )
  ) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;

  SELECT coalesce(max(v.version_no),0)+1 INTO version_no FROM department_master.hierarchy_view_version v WHERE v.view_id=target_view_id;
  INSERT INTO department_master.hierarchy_view_version(view_id,version_no,view_name,view_code,view_type,parent_cardinality,purpose,aggregation_rule,owner_department_id,source_system_id,source_record_id,source_version,valid_from,valid_to,recorded_at,approval_ref,maker,maker_identity,approved_by,approved_identity,content_digest,status)
  VALUES(target_view_id,version_no,p_payload->>'viewName',(SELECT view_code FROM department_master.hierarchy_view WHERE id=target_view_id),p_payload->>'viewType','STRICT_TREE',p_payload->>'purpose',p_payload->>'aggregationRule',owner_id,source_id,p_payload->>'sourceRecordId',p_payload->>'sourceVersion',p_valid_from,p_valid_to,(p_payload->>'recordedAt')::timestamp,p_payload->>'approvalRef',c.maker,c.maker_identity,c.approved_by,c.approved_identity,p_payload->>'validationDigest','PUBLISHED') RETURNING id INTO version_id;
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'nodes') LOOP
    node_id:=uuidv7(); group_id:=NULL; group_version_id:=NULL;
    IF item->>'nodeKind'='GROUP' THEN group_id:=coalesce(NULLIF(item->>'groupId','')::uuid,uuidv7()); group_version_id:=coalesce(NULLIF(item->>'groupVersionId','')::uuid,uuidv7()); END IF;
    INSERT INTO department_master.hierarchy_node(node_id,view_version_id,node_key,parent_node_key,node_kind,department_id,department_version_id,group_id,group_version_id,display_name,relation_name,sort_order,is_primary_path,depth,group_code)
    VALUES(node_id,version_id,item->>'nodeKey',NULLIF(item->>'parentNodeKey',''),item->>'nodeKind',NULLIF(item->>'departmentId','')::uuid,NULLIF(item->>'departmentVersionId','')::uuid,group_id,group_version_id,item->>'displayName',item->>'relationName',(item->>'sortOrder')::integer,(item->>'isPrimaryPath')::boolean,(item->>'depth')::integer,CASE WHEN item->>'nodeKind'='GROUP' THEN item->>'groupCode' END);
  END LOOP;
  UPDATE department_master.hierarchy_candidate SET status='APPLIED',applied_at=timezone('Asia/Shanghai',clock_timestamp()) WHERE id=p_candidate_id;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,version_id,'HIERARCHY_PUBLISHED','ORG05_ORG06',p_payload->>'validationDigest');
  RETURN jsonb_build_object('viewId',target_view_id,'version',version_no::text);
END $$;

REVOKE ALL ON FUNCTION department_master.hierarchy_publish(text,uuid,text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION department_master.hierarchy_publish(text,uuid,text,jsonb) TO hdi_prototype;
