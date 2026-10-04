SELECT pg_advisory_xact_lock(901002);

-- Current authority and immutable result coordinates, without latest-result business admission.
CREATE FUNCTION department_master.impact_result_access(p_actor text,p_ref jsonb,p_campus text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE snapshot jsonb;v jsonb;outcome jsonb;expected_owner text;actual_scope text:=p_campus;h department_master.hierarchy_view_version;c jsonb;n record;relation_version department_master.campus_relation_version;complete boolean;resolved_id uuid;
BEGIN
 IF p_ref->>'owner' IS NULL THEN RETURN;END IF;
 -- Known partial coordinates resolve their actual original Owner objects.
 IF p_ref->>'id' IS NULL AND p_ref->>'versionId' IS NOT NULL THEN
  CASE p_ref->>'owner'
   WHEN 'SOURCE_MAPPING' THEN SELECT mapping_id INTO resolved_id FROM department_master.organization_mapping_version WHERE id=(p_ref->>'versionId')::uuid;
   WHEN 'IDENTIFIER' THEN SELECT identifier_id INTO resolved_id FROM department_master.organization_identifier_version WHERE id=(p_ref->>'versionId')::uuid;
   WHEN 'HIERARCHY' THEN SELECT view_id INTO resolved_id FROM department_master.hierarchy_view_version WHERE id=(p_ref->>'versionId')::uuid;
   WHEN 'CAMPUS_RELATION' THEN SELECT relation_id INTO resolved_id FROM department_master.campus_relation_version WHERE id=(p_ref->>'versionId')::uuid;
   ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';
  END CASE;
  IF resolved_id IS NULL THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  p_ref:=p_ref||jsonb_build_object('id',resolved_id);
 ELSIF p_ref->>'id' IS NULL AND p_ref->>'owner'='HIERARCHY' AND p_ref->>'candidateId' IS NOT NULL THEN
  c:=department_master.hierarchy_read(p_actor,'CANDIDATE',jsonb_build_object('id',p_ref->>'candidateId'));
  IF c IS NULL THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  p_ref:=p_ref||jsonb_build_object('id',c->>'viewId');
 END IF;
 -- Other candidate-only references are authorized by the original transaction-scoped
 -- Owner coordinator, including its frozen input/target/source checks, before return.
 IF p_ref->>'id' IS NULL THEN RETURN;END IF;
 complete:=p_ref ?& ARRAY['id','owner','versionId','candidateId','requestId'];
 PERFORM department_master.evolution_authorize(p_actor,p_campus,'READ');
 CASE p_ref->>'owner'
 WHEN 'SOURCE_MAPPING' THEN
  snapshot:=department_master.mapping_snapshot(p_actor,(p_ref->>'id')::uuid);
  actual_scope:=snapshot->>'campus';PERFORM department_master.evolution_authorize(p_actor,actual_scope,'READ');
  IF p_ref->>'versionId' IS NULL THEN v:=snapshot->'versions'->-1;
  ELSE SELECT value INTO v FROM jsonb_array_elements(snapshot->'versions') WHERE value->>'id'=p_ref->>'versionId';END IF;
  IF v IS NULL THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  PERFORM department_master.mapping_target_authorize(p_actor,v->>'target_type',(v->>'target_id')::uuid,actual_scope);
  PERFORM department_master.evolution_source_authorize(p_actor,(snapshot->>'from_system_id')::uuid);
  expected_owner:='department-master/organization-mapping';
 WHEN 'IDENTIFIER' THEN
  snapshot:=department_master.identifier_snapshot(p_actor,(p_ref->>'id')::uuid,p_campus);
  -- An unresolved stable UUID alone retains the original partial Owner semantics.
  IF snapshot IS NULL AND NOT complete AND p_ref->>'versionId' IS NULL AND p_ref->>'candidateId' IS NULL THEN RETURN;END IF;
  IF p_ref->>'versionId' IS NULL THEN v:=snapshot->'versions'->-1;
  ELSE SELECT value INTO v FROM jsonb_array_elements(snapshot->'versions') WHERE value->>'id'=p_ref->>'versionId';END IF;
  IF v IS NULL THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  PERFORM department_master.mapping_target_authorize(p_actor,snapshot->>'target_type',(snapshot->>'target_id')::uuid,p_campus);
  expected_owner:='department-master/organization-identifier';
 WHEN 'HIERARCHY' THEN
  PERFORM department_master.hierarchy_authorize(p_actor,(p_ref->>'id')::uuid,'READ');
  IF p_ref->>'versionId' IS NULL THEN SELECT * INTO h FROM department_master.hierarchy_view_version WHERE view_id=(p_ref->>'id')::uuid ORDER BY version_no DESC LIMIT 1;
  ELSE SELECT * INTO h FROM department_master.hierarchy_view_version WHERE view_id=(p_ref->>'id')::uuid AND id=(p_ref->>'versionId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;END IF;
  IF h.id IS NOT NULL THEN
   PERFORM department_master.evolution_source_authorize(p_actor,h.source_system_id);
   IF h.owner_department_id IS NOT NULL THEN PERFORM department_master.snapshot(p_actor,h.owner_department_id);END IF;
   FOR n IN SELECT * FROM department_master.hierarchy_node WHERE view_version_id=h.id LOOP
    PERFORM department_master.evolution_source_authorize(p_actor,(n.source_evidence->>'sourceSystemId')::uuid);
    IF n.department_id IS NOT NULL THEN PERFORM department_master.snapshot(p_actor,n.department_id);END IF;
   END LOOP;
  END IF;
  IF p_ref->>'candidateId' IS NOT NULL THEN
   c:=department_master.hierarchy_read(p_actor,'CANDIDATE',jsonb_build_object('id',p_ref->>'candidateId'));
   IF c IS NULL OR c->>'viewId' IS DISTINCT FROM p_ref->>'id' OR (p_ref->>'requestId' IS NOT NULL AND c->>'requestId' IS DISTINCT FROM p_ref->>'requestId') THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  END IF;
  IF complete THEN
   IF c->>'status' IS DISTINCT FROM 'APPLIED' OR h.id IS NULL THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
   IF c->'payload'->>'action' IN ('CLOSE','REVOKE') THEN
    IF NOT EXISTS(SELECT 1 FROM department_master.hierarchy_closure WHERE view_id=h.view_id AND version_no=h.version_no AND candidate_id=(c->>'id')::uuid) THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
   ELSIF h.content_digest IS DISTINCT FROM c->'payload'->>'validationDigest' THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  END IF;
  RETURN;
 WHEN 'CAMPUS_RELATION' THEN
  SELECT governance_scope INTO actual_scope FROM department_master.campus_relation WHERE id=(p_ref->>'id')::uuid;
  PERFORM department_master.lifecycle_relation_snapshot(p_actor,(p_ref->>'id')::uuid,actual_scope,'READ');
  IF p_ref->>'versionId' IS NOT NULL THEN
   SELECT * INTO relation_version FROM department_master.campus_relation_version WHERE relation_id=(p_ref->>'id')::uuid AND id=(p_ref->>'versionId')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  END IF;
 ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';
 END CASE;
 IF v IS NOT NULL THEN PERFORM department_master.evolution_source_authorize(p_actor,(v->'facts'->>'sourceSystemId')::uuid);END IF;
 IF p_ref->>'candidateId' IS NOT NULL THEN PERFORM governance_catalog.apply_record(p_actor,'READ_CANDIDATE',jsonb_build_object('candidateId',p_ref->>'candidateId'));END IF;
 IF complete THEN
  outcome:=governance_catalog.department_impact_committed_result(p_actor,(p_ref->>'candidateId')::uuid,(p_ref->>'requestId')::uuid);
  IF outcome->>'status' IS DISTINCT FROM 'COMMITTED' OR NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(outcome->'facts') fact WHERE
    CASE WHEN p_ref->>'owner'='CAMPUS_RELATION' THEN
     fact->>'id'=relation_version.operation_id::text AND (fact->>'owner'='department-master/lifecycle' OR (fact->>'owner'='department-master/organization-evolution' AND EXISTS(SELECT 1 FROM department_master.evolution_event WHERE id=relation_version.operation_id)))
    ELSE fact->>'owner'=expected_owner AND fact->>'id'=p_ref->>'id' AND fact->>'version'=v->>'number' END
  ) THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 END IF;
END $$;
REVOKE ALL ON FUNCTION department_master.impact_result_access(text,jsonb,text) FROM PUBLIC,hdi_prototype;

DO $forward$
DECLARE body text;needle text;replacement text;
BEGIN
 body:=pg_get_functiondef('department_master.workspace_authorize(text,jsonb,text)'::regprocedure);
 -- Legacy stable-ID metadata remains a preliminary guard. Authenticated content
 -- supplies the complete current projection before any plaintext is returned.
 needle:=' RETURN identity;';
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'WORKSPACE_RESULT_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,$new$ FOR ref IN SELECT value FROM jsonb_array_elements(coalesce(m->'impactResults','[]'::jsonb)) LOOP PERFORM department_master.impact_result_access(p_actor,ref,m->>'campus');END LOOP;
 RETURN identity;$new$);

 body:=pg_get_functiondef('department_master.workspace_hierarchy_group_access(text,jsonb)'::regprocedure);
 needle:=' IF NOT known THEN RETURN;END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WORKSPACE_GROUP_PREDECESSOR_MISMATCH';END IF;
 replacement:=$new$ IF NOT known THEN
  IF p_ref->>'groupId' IS NOT NULL AND p_ref->>'groupVersionId' IS NOT NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  RETURN;
 END IF;$new$;
 body:=replace(body,needle,replacement);
 needle:=' AND EXISTS(SELECT 1 FROM department_master.hierarchy_node WHERE group_version_id=(p_ref->>''groupVersionId'')::uuid) AND NOT EXISTS';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WORKSPACE_GROUP_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,' AND NOT EXISTS');
END $forward$;
