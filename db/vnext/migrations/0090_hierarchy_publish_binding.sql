-- Bind publication to the exact sealed candidate payload and require the
-- source owner reference before a hierarchy snapshot becomes formal.
SELECT pg_advisory_xact_lock(901002);

CREATE OR REPLACE FUNCTION department_master.hierarchy_publish(p_actor text, p_candidate_id uuid, p_digest text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,department_master,vnext_control AS $$
<<publish>>
DECLARE c hierarchy_candidate; identity text; view_id uuid; version_no bigint; version_id uuid; item jsonb; node_id uuid; group_id uuid; group_version_id uuid;
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
    SELECT v.view_id,v.version_no INTO view_id,version_no FROM department_master.hierarchy_view_version v WHERE v.content_digest=p_payload->>'validationDigest' ORDER BY v.version_no DESC LIMIT 1;
    IF view_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    RETURN jsonb_build_object('viewId',view_id,'version',version_no::text);
  END IF;
  IF c.status<>'APPROVED' OR c.approved_by IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED'; END IF;
  IF department_master.authorize(c.approved_by,'HOSPITAL','REVIEW') IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF c.maker_identity=c.approved_identity THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED'; END IF;
  SELECT id INTO view_id FROM department_master.hierarchy_view WHERE source_client_key=p_payload->>'sourceClientKey' FOR UPDATE;
  IF NOT FOUND OR (p_payload->>'viewId' IS NOT NULL AND p_payload->>'viewId'<>'' AND view_id::text IS DISTINCT FROM p_payload->>'viewId') THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
  IF nullif(p_payload->>'ownerDepartmentId','') IS NULL THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'nodes') LOOP
    IF item->>'nodeKind'='DEPARTMENT' AND NOT EXISTS (SELECT 1 FROM department_master.version v WHERE v.id=(item->>'departmentVersionId')::uuid AND v.department_id=(item->>'departmentId')::uuid AND v.valid_from<=(p_payload->>'validFrom')::timestamp AND (v.valid_to IS NULL OR v.valid_to>(p_payload->>'validFrom')::timestamp) AND (p_payload->>'validTo' IS NULL OR v.valid_to IS NULL OR v.valid_to>=(p_payload->>'validTo')::timestamp)) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
  END LOOP;
  SELECT coalesce(max(v.version_no),0)+1 INTO version_no FROM department_master.hierarchy_view_version v WHERE v.view_id=publish.view_id;
  INSERT INTO department_master.hierarchy_view_version(view_id,version_no,view_name,view_code,view_type,parent_cardinality,purpose,aggregation_rule,owner_department_id,source_system_id,source_record_id,source_version,valid_from,valid_to,recorded_at,approval_ref,maker,maker_identity,approved_by,approved_identity,content_digest,status)
  VALUES(publish.view_id,version_no,p_payload->>'viewName',(SELECT view_code FROM department_master.hierarchy_view WHERE id=publish.view_id),p_payload->>'viewType','STRICT_TREE',p_payload->>'purpose',p_payload->>'aggregationRule',NULLIF(p_payload->>'ownerDepartmentId','')::uuid,(p_payload->>'sourceSystemId')::uuid,p_payload->>'sourceRecordId',p_payload->>'sourceVersion',(p_payload->>'validFrom')::timestamp,(p_payload->>'validTo')::timestamp,(p_payload->>'recordedAt')::timestamp,p_payload->>'approvalRef',c.maker,c.maker_identity,c.approved_by,c.approved_identity,p_payload->>'validationDigest','PUBLISHED') RETURNING id INTO version_id;
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'nodes') LOOP
    node_id:=uuidv7(); group_id:=NULL; group_version_id:=NULL;
    IF item->>'nodeKind'='GROUP' THEN group_id:=coalesce(NULLIF(item->>'groupId','')::uuid,uuidv7()); group_version_id:=coalesce(NULLIF(item->>'groupVersionId','')::uuid,uuidv7()); END IF;
    INSERT INTO department_master.hierarchy_node(node_id,view_version_id,node_key,parent_node_key,node_kind,department_id,department_version_id,group_id,group_version_id,display_name,relation_name,sort_order,is_primary_path,depth)
    VALUES(node_id,version_id,item->>'nodeKey',NULLIF(item->>'parentNodeKey',''),item->>'nodeKind',NULLIF(item->>'departmentId','')::uuid,NULLIF(item->>'departmentVersionId','')::uuid,group_id,group_version_id,item->>'displayName',item->>'relationName',(item->>'sortOrder')::integer,(item->>'isPrimaryPath')::boolean,(item->>'depth')::integer);
  END LOOP;
  UPDATE department_master.hierarchy_candidate SET status='APPLIED',applied_at=timezone('Asia/Shanghai',clock_timestamp()) WHERE id=p_candidate_id;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,version_id,'HIERARCHY_PUBLISHED','ORG05_ORG06',p_payload->>'validationDigest');
  RETURN jsonb_build_object('viewId',view_id,'version',version_no::text);
END $$;
