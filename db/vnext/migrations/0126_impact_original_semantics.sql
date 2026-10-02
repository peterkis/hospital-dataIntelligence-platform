SELECT pg_advisory_xact_lock(901002);

-- Target reads clip accepted-version spans to the requested period. Compare
-- exact version identities and containment, not JSON equality of those spans.
CREATE FUNCTION department_master.impact_same_target(p_current jsonb,p_original jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(p_current->>'owner'=p_original->>'owner'
  AND p_current->>'id'=p_original->>'id'
  AND jsonb_array_length(p_current->'parts')>0
  AND NOT EXISTS (
   SELECT 1 FROM jsonb_array_elements(p_current->'parts') current_part
   WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_original->'parts') original_part
    WHERE current_part->>'versionId'=original_part->>'versionId'
     AND current_part->>'version'=original_part->>'version'
     AND tsrange((current_part->>'from')::timestamp,(current_part->>'to')::timestamp,'[)')
      <@ tsrange((original_part->>'from')::timestamp,(original_part->>'to')::timestamp,'[)')
   )
  ),false);
$$;
REVOKE ALL ON FUNCTION department_master.impact_same_target(jsonb,jsonb) FROM PUBLIC,hdi_prototype;

-- The trusted Owner passes the case identity, never a caller-supplied baseline.
-- Keep the installed function signature and its existing exact result checks.
DO $$
DECLARE definition text; patch record;
BEGIN
 definition:=pg_get_functiondef('department_master.impact_result(text,jsonb,text)'::regprocedure);
 FOR patch IN SELECT * FROM (VALUES
 ($old$DECLARE snapshot jsonb;$old$,
  $new$DECLARE original_ref jsonb; impact_case governance_catalog.department_impact_case; snapshot jsonb;$new$,1),
 ($old$PERFORM department_master.evolution_authorize(p_actor,p_campus,'READ');$old$,
  $new$PERFORM department_master.evolution_authorize(p_actor,p_campus,'READ');
 SELECT * INTO impact_case FROM governance_catalog.department_impact_case WHERE id=(p_ref->>'caseId')::uuid AND campus=p_campus;
 IF NOT FOUND THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 PERFORM department_master.impact_case_authorize(p_actor,impact_case.obligation,p_campus,'READ');
 IF impact_case.obligation->>'kind'='REFERENCE'
  AND impact_case.obligation->'reference'->>'owner'=p_ref->>'owner'
  AND impact_case.obligation->'reference'->>'id'=p_ref->>'id' THEN
  original_ref:=impact_case.obligation->'reference';
 END IF;$new$,1),
 ($old$prior:=snapshot->'versions'->-2;$old$,
  $new$SELECT value INTO prior FROM jsonb_array_elements(snapshot->'versions') WHERE value->>'id'=original_ref->>'versionId';$new$,2),
 ($old$AND v->'facts'->'sourceName' IS NOT DISTINCT FROM prior->'facts'->'sourceName'$old$,
  $new$AND v->'facts'->'contractVersionId' IS NOT DISTINCT FROM prior->'facts'->'contractVersionId'
   AND v->'facts'->'sourcePins' IS NOT DISTINCT FROM prior->'facts'->'sourcePins'
   AND department_master.impact_same_target(v->'facts'->'target',prior->'facts'->'target')
   AND v->'facts'->'sourceName' IS NOT DISTINCT FROM prior->'facts'->'sourceName'$new$,1),
 ($old$AND v->>'value'=prior->>'value' AND v->>'language'=prior->>'language' AND v->'preferred'=prior->'preferred'$old$,
  $new$AND v->>'value'=prior->>'value' AND v->>'language'=prior->>'language' AND v->'preferred'=prior->'preferred'
   AND department_master.impact_same_target(v->'facts'->'target',prior->'facts'->'target')
   AND v->'facts'->'issuer' IS NOT DISTINCT FROM prior->'facts'->'issuer'
   AND v->'facts'->'contractVersionId' IS NOT DISTINCT FROM prior->'facts'->'contractVersionId'$new$,1),
 ($old$WHERE view_id=candidate.view_id AND status='PUBLISHED' AND version_no<view_version.version_no ORDER BY version_no DESC LIMIT 1;$old$,
  $new$WHERE view_id=candidate.view_id AND status='PUBLISHED' AND id=(original_ref->>'versionId')::uuid;$new$,1)
 ) AS changes(old_text,new_text,expected_count) LOOP
  IF (length(definition)-length(replace(definition,patch.old_text,'')))/length(patch.old_text)<>patch.expected_count THEN RAISE EXCEPTION 'IMPACT_ORIGINAL_SEMANTICS_BASELINE_MISMATCH';END IF;
  definition:=replace(definition,patch.old_text,patch.new_text);
 END LOOP;
 EXECUTE definition;
END $$;
