SELECT pg_advisory_xact_lock(901002);
-- Forward authorization of impact-result and companion/dependency contract references.
CREATE FUNCTION department_master.workspace_impact_result_access(p_actor text,p_owner text,p_id uuid,p_campus text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actual_scope text;BEGIN
 PERFORM department_master.evolution_authorize(p_actor,p_campus,'READ');
 CASE p_owner
 WHEN 'SOURCE_MAPPING' THEN
  SELECT campus INTO actual_scope FROM department_master.organization_mapping WHERE id=p_id;
  PERFORM department_master.evolution_authorize(p_actor,actual_scope,'READ');
  PERFORM department_master.mapping_snapshot(p_actor,p_id);
 WHEN 'IDENTIFIER' THEN PERFORM department_master.identifier_snapshot(p_actor,p_id,p_campus);
 WHEN 'HIERARCHY' THEN PERFORM department_master.hierarchy_authorize(p_actor,p_id,'READ');
 WHEN 'CAMPUS_RELATION' THEN
  SELECT governance_scope INTO actual_scope FROM department_master.campus_relation WHERE id=p_id;
  PERFORM department_master.lifecycle_relation_snapshot(p_actor,p_id,actual_scope,'READ');
 ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';
 END CASE;
END $$;
REVOKE ALL ON FUNCTION department_master.workspace_impact_result_access(text,text,uuid,text) FROM PUBLIC,hdi_prototype;

-- Resolve current Owner access without reevaluating publication or disposition proofs.
CREATE FUNCTION department_master.workspace_hierarchy_group_access(p_actor text,p_ref jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE view_id uuid;known boolean;known_version boolean;BEGIN
 IF p_ref->>'groupId' IS NULL AND p_ref->>'groupVersionId' IS NULL THEN RETURN;END IF;
 SELECT EXISTS(SELECT 1 FROM department_master.hierarchy_node n WHERE n.node_kind='GROUP' AND (n.group_id=(p_ref->>'groupId')::uuid OR n.group_version_id=(p_ref->>'groupVersionId')::uuid)) INTO known;
 -- Preserve the original Owner's support for caller-supplied new group identities.
 IF NOT known THEN RETURN;END IF;
 SELECT EXISTS(SELECT 1 FROM department_master.hierarchy_node WHERE group_version_id=(p_ref->>'groupVersionId')::uuid) INTO known_version;
 FOR view_id IN SELECT DISTINCT v.view_id FROM department_master.hierarchy_node n JOIN department_master.hierarchy_view_version v ON v.id=n.view_version_id WHERE n.node_kind='GROUP' AND CASE WHEN known_version THEN n.group_version_id=(p_ref->>'groupVersionId')::uuid ELSE n.group_id=(p_ref->>'groupId')::uuid END LOOP
  PERFORM department_master.hierarchy_authorize(p_actor,view_id,'READ');
 END LOOP;
 IF p_ref->>'groupId' IS NOT NULL AND p_ref->>'groupVersionId' IS NOT NULL AND EXISTS(SELECT 1 FROM department_master.hierarchy_node WHERE group_version_id=(p_ref->>'groupVersionId')::uuid) AND NOT EXISTS(SELECT 1 FROM department_master.hierarchy_node WHERE group_id=(p_ref->>'groupId')::uuid AND group_version_id=(p_ref->>'groupVersionId')::uuid) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
END $$;
CREATE FUNCTION department_master.workspace_department_version_access(p_actor text,p_ref jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE department_id uuid;BEGIN
 SELECT v.department_id INTO department_id FROM department_master.version v WHERE v.id=(p_ref->>'versionId')::uuid;
 IF department_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM department_master.snapshot(p_actor,department_id);
 IF p_ref->>'departmentId' IS NOT NULL AND department_id IS DISTINCT FROM (p_ref->>'departmentId')::uuid THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
END $$;
REVOKE ALL ON FUNCTION department_master.workspace_hierarchy_group_access(text,jsonb),department_master.workspace_department_version_access(text,jsonb) FROM PUBLIC,hdi_prototype;
CREATE OR REPLACE FUNCTION department_master.workspace_authorize(p_actor text,m jsonb,p_permission text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;ref jsonb;BEGIN
 IF m->>'kind' NOT IN ('DEPARTMENT','HIERARCHY','MAPPING','IDENTIFIER','EVOLUTION','LIFECYCLE','IMPACT') OR m->>'campus' NOT IN ('NORTH','SOUTH') OR jsonb_typeof(m->'references') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 identity:=department_master.authorize(p_actor,m->>'campus',p_permission);
 PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');
 IF m->>'kind'='HIERARCHY' THEN PERFORM department_master.authorize(p_actor,'HOSPITAL',CASE WHEN p_permission='READ_RESTRICTED' THEN 'READ' ELSE p_permission END);END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(m->'references') LOOP
  CASE ref->>'owner'
  WHEN 'SOURCE_MAPPING','IDENTIFIER','HIERARCHY','CAMPUS_RELATION' THEN PERFORM department_master.workspace_impact_result_access(p_actor,ref->>'owner',(ref->>'id')::uuid,m->>'campus');
  WHEN 'department-master' THEN PERFORM department_master.snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'department-master/hierarchy-view' THEN PERFORM department_master.hierarchy_authorize(p_actor,(ref->>'id')::uuid,'READ');
  WHEN 'department-master/impact-case' THEN PERFORM governance_catalog.department_workspace_impact_access(p_actor,(ref->>'id')::uuid,m->>'campus',p_permission);
  WHEN 'department-master/organization-evolution' THEN PERFORM department_master.evolution_snapshot(p_actor,(ref->>'id')::uuid,m->>'campus');
  WHEN 'department-master/campus-relation' THEN PERFORM department_master.lifecycle_relation_snapshot(p_actor,(ref->>'id')::uuid,m->>'campus','READ');
  WHEN 'organization-master' THEN PERFORM organization_master.read(p_actor,jsonb_build_object('id',ref->>'id'));
  WHEN 'organization-master/campus' THEN PERFORM organization_master.campus_snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'department-master/organization-mapping' THEN PERFORM department_master.mapping_snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'department-master/organization-identifier' THEN PERFORM department_master.identifier_snapshot(p_actor,(ref->>'id')::uuid,m->>'campus');
  WHEN 'governance-catalog/registration-evidence' THEN PERFORM governance_catalog.registration_evidence_access(p_actor,(ref->>'id')::uuid,NULL,m->>'campus');
  WHEN 'governance-catalog/source' THEN PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',(ref->>'id')::uuid);
  ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';
  END CASE;
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(m->'namespaces') LOOP PERFORM department_master.mapping_authorize(p_actor,(ref->>'source')::uuid,ref->>'entity',ref->>'context',m->>'campus',p_permission);END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(m->'schemes') LOOP PERFORM department_master.identifier_authorize(p_actor,ref#>>'{}',m->>'campus',p_permission);END LOOP;
 IF m ? 'transport' THEN
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(governance_catalog.contract_read(p_actor,jsonb_build_object('scope','SYNTHETIC','mode','HISTORY','target',m->'transport'->>'contractId','versionId',m->'transport'->>'contractVersionId'))) c WHERE c->>'id'=m->'transport'->>'contractId' AND c->>'versionId'=m->'transport'->>'contractVersionId') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(coalesce(m->'contractRefs','[]'::jsonb)) LOOP
  IF ref->>'contractId' IS NULL THEN
   PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',(ref->>'contractVersionId')::uuid,'READ');
  ELSIF ref->>'contractVersionId' IS NULL THEN
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(governance_catalog.contract_read(p_actor,jsonb_build_object('scope','SYNTHETIC','mode','CURRENT','target',ref->>'contractId'))) c WHERE c->>'id'=ref->>'contractId') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(governance_catalog.contract_read(p_actor,jsonb_build_object('scope','SYNTHETIC','mode','HISTORY','target',ref->>'contractId','versionId',ref->>'contractVersionId'))) c WHERE c->>'id'=ref->>'contractId' AND c->>'versionId'=ref->>'contractVersionId') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  END IF;
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(coalesce(m->'groupRefs','[]'::jsonb)) LOOP PERFORM department_master.workspace_hierarchy_group_access(p_actor,ref);END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(coalesce(m->'departmentVersions','[]'::jsonb)) LOOP PERFORM department_master.workspace_department_version_access(p_actor,ref);END LOOP;
 RETURN identity;
END $$;
REVOKE ALL ON FUNCTION department_master.workspace_authorize(text,jsonb,text) FROM PUBLIC,hdi_prototype;
