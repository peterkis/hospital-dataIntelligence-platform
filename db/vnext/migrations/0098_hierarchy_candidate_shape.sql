SELECT pg_advisory_xact_lock(901002);

-- Validate JSON types before ->> or relational casts can coerce approved input.
-- These three sections are the closed hierarchy publication contract, including
-- the derived node depth and validation digest added by the Owner.
CREATE FUNCTION department_master.hierarchy_assert_candidate_shape(p_payload jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE section record; doc jsonb; fields text[]; ids text[]; times text[];
 limits jsonb; field text; limit_entry record; amount numeric;
BEGIN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 IF jsonb_typeof(p_payload->'nodes') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 IF jsonb_array_length(p_payload->'nodes') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 FOR section IN
  SELECT p_payload AS value,'HEADER' AS kind
  UNION ALL SELECT value,'NODE' FROM jsonb_array_elements(p_payload->'nodes')
  UNION ALL SELECT value->'sourceEvidence','EVIDENCE' FROM jsonb_array_elements(p_payload->'nodes')
 LOOP
  doc:=section.value; ids:=ARRAY[]::text[]; times:=ARRAY[]::text[];
  IF jsonb_typeof(doc) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  IF section.kind='HEADER' THEN
   fields:=ARRAY['requestId','viewId','sourceClientKey','viewCode','viewName','viewType','parentCardinality','purpose','aggregationRule','ownerDepartmentId','sourceSystemId','sourceRecordId','sourceVersion','validFrom','validTo','recordedAt','recordStatus','approvalRef','nodes','validationDigest'];
   limits:='{"sourceClientKey":128,"viewCode":64,"viewName":256,"viewType":64,"parentCardinality":64,"purpose":2000,"aggregationRule":2000,"sourceRecordId":256,"sourceVersion":64,"recordStatus":64,"approvalRef":256}';
   ids:=ARRAY['requestId','viewId','ownerDepartmentId','sourceSystemId'];
   times:=ARRAY['validFrom','validTo','recordedAt'];
   IF doc->>'viewType' NOT IN ('ADMINISTRATIVE','OPERATIONAL','MEDICAL_RECORD','FINANCE','STATISTICAL')
      OR doc->>'parentCardinality' IS DISTINCT FROM 'STRICT_TREE'
      OR doc->>'recordStatus' IS DISTINCT FROM 'ACTIVE'
      OR jsonb_typeof(doc->'validationDigest') IS DISTINCT FROM 'string'
      OR coalesce(doc->>'validationDigest','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  ELSIF section.kind='NODE' THEN
   fields:=ARRAY['sourceEvidence','nodeKey','parentNodeKey','nodeKind','displayName','relationName','sortOrder','isPrimaryPath','depth'];
   limits:='{"nodeKey":128,"parentNodeKey":128,"nodeKind":32,"displayName":256,"relationName":128}';
   IF doc->>'nodeKind'='DEPARTMENT' THEN
    fields:=fields||ARRAY['departmentId','departmentVersionId']; ids:=ARRAY['departmentId','departmentVersionId'];
   ELSIF doc->>'nodeKind'='GROUP' THEN
    fields:=fields||ARRAY['groupCode','groupId','groupVersionId']; ids:=ARRAY['groupId','groupVersionId']; limits:=limits||'{"groupCode":128}'::jsonb;
   ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
   IF jsonb_typeof(doc->'isPrimaryPath') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
   FOREACH field IN ARRAY ARRAY['sortOrder','depth'] LOOP
    IF jsonb_typeof(doc->field) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
    amount:=(doc->>field)::numeric;
    IF amount<>trunc(amount) OR amount<0 OR amount>(CASE field WHEN 'depth' THEN 99 ELSE 2147483647 END) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
   END LOOP;
  ELSE
   fields:=ARRAY['sourceClientKey','sourceVersion','sourceSystemId','sourceRecordId','validFrom','validTo','recordedAt','recordStatus','approvalRef'];
   limits:='{"sourceClientKey":128,"sourceVersion":64,"sourceRecordId":256,"recordStatus":64,"approvalRef":256}';
   ids:=ARRAY['sourceSystemId']; times:=ARRAY['validFrom','validTo','recordedAt'];
   IF doc->>'recordStatus' IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  END IF;
  IF NOT (doc ?& fields) OR doc-fields<>'{}'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  FOR limit_entry IN SELECT key,value FROM jsonb_each_text(limits) LOOP
   field:=limit_entry.key;
   IF field='parentNodeKey' AND doc->field='null'::jsonb THEN CONTINUE; END IF;
   IF jsonb_typeof(doc->field) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
   IF length(doc->>field)>limit_entry.value::integer OR (field<>'parentNodeKey' AND coalesce(doc->>field,'') !~ '\S') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  END LOOP;
  FOREACH field IN ARRAY ids LOOP
   IF field IN ('viewId','ownerDepartmentId','groupId','groupVersionId') AND doc->field='null'::jsonb THEN CONTINUE; END IF;
   IF jsonb_typeof(doc->field) IS DISTINCT FROM 'string' OR coalesce(doc->>field,'') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  END LOOP;
  FOREACH field IN ARRAY times LOOP
   IF field='validTo' AND doc->field='null'::jsonb THEN CONTINUE; END IF;
   IF jsonb_typeof(doc->field) IS DISTINCT FROM 'string' OR coalesce(doc->>field,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
   PERFORM (doc->>field)::timestamp;
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION department_master.hierarchy_assert_candidate_shape(jsonb) FROM PUBLIC,hdi_prototype;

DO $patch$ DECLARE body text; needle text; BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_store_candidate(text,jsonb)'::regprocedure);
 needle:='  IF p_payload->>''parentCardinality''';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_SHAPE_STORE_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,'  PERFORM department_master.hierarchy_assert_candidate_shape(p_payload-ARRAY[''makerIdentity'',''envelope'',''digest'',''payloadDigest'']);'||chr(10)||needle);
 body:=pg_get_functiondef('department_master.hierarchy_publish(text,uuid,text,jsonb)'::regprocedure);
 needle:='  IF p_payload->>''parentCardinality''';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_SHAPE_PUBLISH_BASELINE_MISMATCH'; END IF;
 -- Applied historical retries retain their original schema; new publication is
 -- always checked, including candidates staged before this forward migration.
 EXECUTE replace(body,needle,'  PERFORM department_master.hierarchy_assert_candidate_shape(p_payload);'||chr(10)||needle);
END $patch$;
