SELECT pg_advisory_xact_lock(901002);

-- Historical content stays immutable. Both exact versions represented by it
-- must remain readable; never substitute the latest version at read time.
DO $$
DECLARE definition text;
 needle text := $old$ELSE RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;$old$;
 addition text := $new$ELSE RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 IF p_ref->>'owner'='SOURCE_MAPPING' THEN
  SELECT * INTO mv FROM department_master.organization_mapping_version
   WHERE id=(p_ref->>'currentVersionId')::uuid AND mapping_id=m.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM department_master.mapping_target_authorize(p_actor,mv.target_type,mv.target_id,p_campus);
  PERFORM department_master.evolution_source_authorize(p_actor,(mv.facts->>'sourceSystemId')::uuid);
 ELSIF p_ref->>'owner'='IDENTIFIER' THEN
  SELECT * INTO iv FROM department_master.organization_identifier_version
   WHERE id=(p_ref->>'currentVersionId')::uuid AND identifier_id=i.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM department_master.evolution_source_authorize(p_actor,(iv.facts->>'sourceSystemId')::uuid);
 ELSIF p_ref->>'owner'='HIERARCHY' THEN
  FOR h IN SELECT * FROM department_master.hierarchy_view_version
   WHERE id IN ((p_ref->>'versionId')::uuid,(p_ref->>'currentVersionId')::uuid)
    AND view_id=(p_ref->>'id')::uuid LOOP
   PERFORM department_master.evolution_source_authorize(p_actor,h.source_system_id);
   IF h.owner_department_id IS NOT NULL THEN PERFORM department_master.snapshot(p_actor,h.owner_department_id);END IF;
   FOR n IN SELECT * FROM department_master.hierarchy_node WHERE view_version_id=h.id LOOP
    PERFORM department_master.evolution_source_authorize(p_actor,(n.source_evidence->>'sourceSystemId')::uuid);
    IF n.department_id IS NOT NULL THEN PERFORM department_master.snapshot(p_actor,n.department_id);END IF;
   END LOOP;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM department_master.hierarchy_view_version WHERE id=(p_ref->>'currentVersionId')::uuid AND view_id=(p_ref->>'id')::uuid) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 END IF;$new$;
BEGIN
 definition:=pg_get_functiondef('department_master.impact_reference_access(text,jsonb,text)'::regprocedure);
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'IMPACT_CURRENT_AUTHORITY_BASELINE_MISMATCH';END IF;
 EXECUTE replace(definition,needle,addition);
END $$;
