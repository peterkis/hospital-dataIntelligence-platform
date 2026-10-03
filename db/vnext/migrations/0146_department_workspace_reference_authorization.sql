SELECT pg_advisory_xact_lock(901002);
-- Forward repair: preserve all existing private revisions and installed bytes.
CREATE OR REPLACE FUNCTION department_master.workspace_authorize(p_actor text,m jsonb,p_permission text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;ref jsonb;BEGIN
 IF m->>'kind' NOT IN ('DEPARTMENT','HIERARCHY','MAPPING','IDENTIFIER','EVOLUTION','LIFECYCLE','IMPACT') OR m->>'campus' NOT IN ('NORTH','SOUTH') OR jsonb_typeof(m->'references') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 identity:=department_master.authorize(p_actor,m->>'campus',p_permission);
 PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');
 IF m->>'kind'='HIERARCHY' THEN PERFORM department_master.authorize(p_actor,'HOSPITAL',CASE WHEN p_permission='READ_RESTRICTED' THEN 'READ' ELSE p_permission END);END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(m->'references') LOOP
  CASE ref->>'owner'
  WHEN 'department-master' THEN PERFORM department_master.snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'department-master/hierarchy-view' THEN PERFORM department_master.hierarchy_authorize(p_actor,(ref->>'id')::uuid,'READ');
  WHEN 'department-master/impact-case' THEN PERFORM governance_catalog.department_workspace_impact_access(p_actor,(ref->>'id')::uuid,m->>'campus',p_permission);
  WHEN 'department-master/organization-evolution' THEN PERFORM department_master.evolution_snapshot(p_actor,(ref->>'id')::uuid,m->>'campus');
  WHEN 'department-master/campus-relation' THEN PERFORM department_master.lifecycle_relation_snapshot(p_actor,(ref->>'id')::uuid,m->>'campus','READ');
  WHEN 'organization-master' THEN PERFORM organization_master.read(p_actor,jsonb_build_object('id',ref->>'id'));
  WHEN 'organization-master/campus' THEN PERFORM organization_master.campus_snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'department-master/organization-mapping' THEN PERFORM department_master.mapping_snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'department-master/organization-identifier' THEN PERFORM department_master.identifier_snapshot(p_actor,(ref->>'id')::uuid,m->>'campus');
  WHEN 'governance-catalog/source' THEN PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',(ref->>'id')::uuid);
  ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';
  END CASE;
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(m->'namespaces') LOOP PERFORM department_master.mapping_authorize(p_actor,(ref->>'source')::uuid,ref->>'entity',ref->>'context',m->>'campus',p_permission);END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(m->'schemes') LOOP PERFORM department_master.identifier_authorize(p_actor,ref#>>'{}',m->>'campus',p_permission);END LOOP;
 IF m ? 'transport' THEN
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(governance_catalog.contract_read(p_actor,jsonb_build_object('scope','SYNTHETIC','mode','HISTORY','target',m->'transport'->>'contractId','versionId',m->'transport'->>'contractVersionId'))) c WHERE c->>'id'=m->'transport'->>'contractId' AND c->>'versionId'=m->'transport'->>'contractVersionId') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 END IF;
 RETURN identity;
END $$;
REVOKE ALL ON FUNCTION department_master.workspace_authorize(text,jsonb,text) FROM PUBLIC,hdi_prototype;
