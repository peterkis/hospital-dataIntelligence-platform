SELECT pg_advisory_xact_lock(901002);

CREATE TABLE department_master.hierarchy_view (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  source_client_key text NOT NULL UNIQUE CHECK (length(btrim(source_client_key)) > 0),
  view_code text NOT NULL UNIQUE CHECK (length(btrim(view_code)) > 0),
  created_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai', clock_timestamp())
);

CREATE TABLE department_master.hierarchy_view_version (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  view_id uuid NOT NULL REFERENCES department_master.hierarchy_view(id),
  version_no bigint NOT NULL CHECK (version_no > 0),
  view_name text NOT NULL CHECK (length(btrim(view_name)) > 0),
  view_code text NOT NULL CHECK (length(btrim(view_code)) > 0),
  view_type text NOT NULL CHECK (view_type IN ('ADMINISTRATIVE','OPERATIONAL','MEDICAL_RECORD','FINANCE','STATISTICAL')),
  parent_cardinality text NOT NULL CHECK (parent_cardinality = 'STRICT_TREE'),
  purpose text NOT NULL CHECK (length(btrim(purpose)) > 0),
  aggregation_rule text NOT NULL CHECK (length(btrim(aggregation_rule)) > 0),
  owner_department_id uuid REFERENCES department_master.department(id),
  source_system_id uuid NOT NULL,
  source_record_id text NOT NULL CHECK (length(btrim(source_record_id)) > 0),
  source_version text NOT NULL CHECK (length(btrim(source_version)) > 0),
  valid_from timestamp NOT NULL,
  valid_to timestamp,
  recorded_at timestamp NOT NULL,
  approval_ref text NOT NULL CHECK (length(btrim(approval_ref)) > 0),
  maker text NOT NULL REFERENCES vnext_control.actor(code),
  maker_identity text NOT NULL,
  approved_by text,
  approved_identity text,
  content_digest text NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','CLOSED')),
  created_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai', clock_timestamp()),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  UNIQUE (view_id, version_no)
);

CREATE TABLE department_master.hierarchy_candidate (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  request_id uuid NOT NULL UNIQUE,
  view_id uuid REFERENCES department_master.hierarchy_view(id),
  source_client_key text NOT NULL,
  maker text NOT NULL REFERENCES vnext_control.actor(code),
  maker_identity text NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  envelope jsonb NOT NULL CHECK (jsonb_typeof(envelope) = 'object'),
  status text NOT NULL CHECK (status IN ('VALIDATED','APPROVED','APPLIED','REJECTED')),
  approved_by text REFERENCES vnext_control.actor(code),
  approved_identity text,
  approved_at timestamp,
  applied_at timestamp,
  recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai', clock_timestamp())
);

CREATE TABLE department_master.hierarchy_node (
  node_id uuid PRIMARY KEY DEFAULT uuidv7(),
  view_version_id uuid NOT NULL REFERENCES department_master.hierarchy_view_version(id),
  node_key text NOT NULL CHECK (length(btrim(node_key)) > 0),
  parent_node_key text,
  node_kind text NOT NULL CHECK (node_kind IN ('DEPARTMENT','GROUP')),
  department_id uuid REFERENCES department_master.department(id),
  department_version_id uuid REFERENCES department_master.version(id),
  group_id uuid,
  group_version_id uuid,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  relation_name text NOT NULL CHECK (length(btrim(relation_name)) > 0),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  is_primary_path boolean NOT NULL,
  depth integer NOT NULL CHECK (depth >= 0),
  UNIQUE (view_version_id, node_key),
  CHECK ((node_kind='DEPARTMENT' AND department_id IS NOT NULL AND department_version_id IS NOT NULL AND group_id IS NULL AND group_version_id IS NULL)
      OR (node_kind='GROUP' AND department_id IS NULL AND department_version_id IS NULL AND group_id IS NOT NULL AND group_version_id IS NOT NULL))
);

CREATE UNIQUE INDEX hierarchy_department_once_per_view_idx
  ON department_master.hierarchy_node(view_version_id, department_id)
  WHERE node_kind = 'DEPARTMENT';

CREATE OR REPLACE FUNCTION department_master.hierarchy_create_view(p_actor text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,department_master,vnext_control AS $$
DECLARE identity text; view_id uuid; digest text;
BEGIN
  PERFORM pg_advisory_xact_lock(901002);
  identity:=department_master.authorize(p_actor,'HOSPITAL','WRITE');
  IF EXISTS (SELECT 1 FROM department_master.hierarchy_view WHERE source_client_key=p_payload->>'sourceClientKey' OR view_code=p_payload->>'viewCode') THEN RAISE EXCEPTION 'IDENTIFIER_CONFLICT'; END IF;
  digest:=p_payload->>'viewDigest';
  IF digest IS NULL OR digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  INSERT INTO department_master.hierarchy_view(source_client_key,view_code) VALUES (p_payload->>'sourceClientKey',p_payload->>'viewCode') RETURNING id INTO view_id;
  INSERT INTO department_master.hierarchy_view_version(view_id,version_no,view_name,view_code,view_type,parent_cardinality,purpose,aggregation_rule,owner_department_id,source_system_id,source_record_id,source_version,valid_from,valid_to,recorded_at,approval_ref,maker,maker_identity,content_digest,status)
  VALUES(view_id,1,p_payload->>'viewName',p_payload->>'viewCode',p_payload->>'viewType','STRICT_TREE',p_payload->>'purpose',p_payload->>'aggregationRule',NULLIF(p_payload->>'ownerDepartmentId','')::uuid,(p_payload->>'sourceSystemId')::uuid,p_payload->>'sourceRecordId',p_payload->>'sourceVersion',(p_payload->>'validFrom')::timestamp,(p_payload->>'validTo')::timestamp,(p_payload->>'recordedAt')::timestamp,p_payload->>'approvalRef',p_actor,identity,digest,'DRAFT');
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,view_id,'HIERARCHY_VIEW_CREATED','ORG05',digest);
  RETURN jsonb_build_object('viewId',view_id);
END $$;

CREATE OR REPLACE FUNCTION department_master.hierarchy_store_candidate(p_actor text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,department_master,vnext_control AS $$
DECLARE identity text; candidate_id uuid; view_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(901002);
  identity:=department_master.authorize(p_actor,'HOSPITAL','WRITE');
  SELECT id INTO view_id FROM department_master.hierarchy_view WHERE source_client_key=p_payload->>'sourceClientKey';
  IF NOT FOUND THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
  IF p_payload->>'parentCardinality' IS DISTINCT FROM 'STRICT_TREE' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  IF p_payload->>'viewType' IN ('FINANCE','STATISTICAL') THEN RAISE EXCEPTION 'VIEW_TYPE_NOT_OPERATIONAL'; END IF;
  IF p_payload->>'viewId' IS NOT NULL AND p_payload->>'viewId' <> '' AND view_id::text IS DISTINCT FROM p_payload->>'viewId' THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
  INSERT INTO department_master.hierarchy_candidate(request_id,view_id,source_client_key,maker,maker_identity,digest,payload_digest,payload,envelope,status)
  VALUES((p_payload->>'requestId')::uuid,view_id,p_payload->>'sourceClientKey',p_actor,identity,p_payload->>'digest',p_payload->>'payloadDigest',p_payload - 'makerIdentity' - 'envelope' - 'digest' - 'payloadDigest',p_payload->'envelope','VALIDATED')
  RETURNING id INTO candidate_id;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,candidate_id,'HIERARCHY_CANDIDATE','ORG05_ORG06',p_payload->>'digest');
  RETURN jsonb_build_object('candidateId',candidate_id);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'REQUEST_CONFLICT';
END $$;

CREATE OR REPLACE FUNCTION department_master.hierarchy_approve(p_actor text, p_candidate_id uuid, p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,department_master,vnext_control AS $$
DECLARE identity text; maker_identity text; maker text; current_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(901002);
  identity:=department_master.authorize(p_actor,'HOSPITAL','REVIEW');
  SELECT c.maker,c.maker_identity,c.status INTO maker,maker_identity,current_status FROM department_master.hierarchy_candidate c WHERE c.id=p_candidate_id AND c.digest=p_digest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF identity=maker_identity THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED'; END IF;
  IF current_status='APPLIED' THEN RAISE EXCEPTION 'ALREADY_COMMITTED'; END IF;
  UPDATE department_master.hierarchy_candidate SET approved_by=p_actor,approved_identity=identity,approved_at=timezone('Asia/Shanghai',clock_timestamp()),status='APPROVED' WHERE id=p_candidate_id;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,p_candidate_id,'HIERARCHY_APPROVED','ORG05_ORG06',p_digest);
  RETURN jsonb_build_object('candidateId',p_candidate_id,'approvedBy',p_actor);
END $$;

CREATE OR REPLACE FUNCTION department_master.hierarchy_publish(p_actor text, p_candidate_id uuid, p_digest text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,department_master,vnext_control AS $$
<<publish>>
DECLARE c hierarchy_candidate; identity text; view_id uuid; version_no bigint; version_id uuid; item jsonb; node_id uuid; group_id uuid; group_version_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(901002);
  identity:=department_master.authorize(p_actor,'HOSPITAL','WRITE');
  SELECT * INTO c FROM department_master.hierarchy_candidate WHERE id=p_candidate_id AND digest=p_digest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
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

REVOKE ALL ON ALL TABLES IN SCHEMA department_master FROM PUBLIC,hdi_prototype;
GRANT USAGE ON SCHEMA department_master TO hdi_prototype;
GRANT SELECT ON department_master.hierarchy_view,department_master.hierarchy_view_version,department_master.hierarchy_candidate,department_master.hierarchy_node TO hdi_prototype;
REVOKE ALL ON FUNCTION department_master.hierarchy_create_view(text,jsonb),department_master.hierarchy_store_candidate(text,jsonb),department_master.hierarchy_approve(text,uuid,text),department_master.hierarchy_publish(text,uuid,text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION department_master.hierarchy_create_view(text,jsonb),department_master.hierarchy_store_candidate(text,jsonb),department_master.hierarchy_approve(text,uuid,text),department_master.hierarchy_publish(text,uuid,text,jsonb) TO hdi_prototype;

