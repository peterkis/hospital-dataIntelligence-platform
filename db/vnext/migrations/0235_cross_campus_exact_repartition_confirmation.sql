SELECT pg_advisory_xact_lock(901002);
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.nursing_handover_context(text,jsonb)'::regprocedure);
 needle:='source_version uuid;';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_HANDOVER_TARGET_DECLARATION_BASELINE';END IF;
 body:=replace(body,needle,'source_version uuid;target_campus uuid;scope_input care_organization.ward_nursing_input;scope_proposal care_organization.ward_nursing_scope_proposal;');
 needle:=$old$IF h->'partitionPlan' ? 'repartition' THEN PERFORM care_organization.nursing_repartition_reference(p_actor,h);END IF;$old$;IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_HANDOVER_EXACT_SCOPE_BASELINE';END IF;
 body:=replace(body,needle,$new$target_campus:=source.campus_id;
 IF h->'partitionPlan' ? 'repartition' THEN
  PERFORM care_organization.nursing_repartition_reference(p_actor,h);
  SELECT * INTO scope_input FROM care_organization.ward_nursing_input WHERE id=(h->'partitionPlan'->'repartition'->>'inputId')::uuid;
  SELECT * INTO scope_proposal FROM care_organization.ward_nursing_scope_proposal WHERE input_id=scope_input.id;
  IF cardinality(scope_input.campus_ids)<>1 OR NOT EXISTS(SELECT 1 FROM care_organization.ward_nursing_scope_set WHERE id=scope_proposal.scope_set_id AND ward_id=source.ward_id) THEN RAISE EXCEPTION 'HANDOVER_NOT_CONFIRMED';END IF;
  target_campus:=scope_input.campus_ids[1];
 END IF;
 PERFORM care_organization.nursing_authorize(p_actor,target_campus,'READ');$new$);
 needle:='IF NOT EXISTS(SELECT 1 FROM care_organization.nursing_unit_binding WHERE unit_id=successor AND campus_id=source.campus_id) THEN';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_HANDOVER_TARGET_ANCHOR_BASELINE';END IF;
 body:=replace(body,needle,$new$IF NOT EXISTS(SELECT 1 FROM care_organization.nursing_unit_binding WHERE unit_id=successor AND campus_id=target_campus) AND NOT (h->'partitionPlan' ? 'repartition' AND successor=source.nursing_unit_id) THEN$new$);
 needle:=$old$'campusId',source.campus_id,$old$;IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_HANDOVER_TARGET_CONTEXT_BASELINE';END IF;
 body:=replace(body,needle,$new$'campusId',source.campus_id,'targetCampusId',target_campus,$new$);EXECUTE body;
 body:=pg_get_functiondef('care_organization.nursing_handover_confirm(text,text)'::regprocedure);
 needle:=$old$identity:=care_organization.nursing_authorize(t->>'actor',(context->>'campusId')::uuid,'REVIEW');$old$;IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_HANDOVER_TARGET_CONFIRM_BASELINE';END IF;
 body:=replace(body,needle,needle||$new$IF identity IS DISTINCT FROM care_organization.nursing_authorize(t->>'actor',(context->>'targetCampusId')::uuid,'REVIEW') THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;$new$);EXECUTE body;
 body:=pg_get_functiondef('care_organization.nursing_handover_confirmation_read(text,uuid,text,jsonb)'::regprocedure);
 needle:='identity:=care_organization.nursing_authorize(confirmation.actor,confirmation.campus_id,''REVIEW'');';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_HANDOVER_TARGET_RECHECK_BASELINE';END IF;
 body:=replace(body,needle,needle||$new$IF identity IS DISTINCT FROM care_organization.nursing_authorize(confirmation.actor,(context->>'targetCampusId')::uuid,'REVIEW') THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;$new$);EXECUTE body;
 body:=pg_get_functiondef('care_organization.ward_nursing_mutate_0199(text,text)'::regprocedure);
 needle:='source_coverage.campus_id IS DISTINCT FROM u.campus_id';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_HANDOVER_ACCEPTED_TARGET_BASELINE';END IF;
 body:=replace(body,needle,$new$(source_coverage.campus_id IS DISTINCT FROM u.campus_id AND NOT EXISTS(
  SELECT 1 FROM care_organization.ward_nursing_scope_version sv JOIN care_organization.ward_nursing_scope_set ss ON ss.id=sv.scope_set_id JOIN care_organization.ward_nursing_change sc ON sc.id=sv.change_id
  WHERE sv.input_id=(handover->'partitionPlan'->'repartition'->>'inputId')::uuid AND sv.scope_set_id=(w->'facts'->'coverageScope'->>'scopeSetId')::uuid AND sv.number=(w->'facts'->'coverageScope'->>'version')::bigint
   AND ss.ward_id=u.ward_id AND sv.definition->'definition'->'applicability'->'campus'->>'id'=u.campus_id::text AND sc.candidate_id=c.id AND sv.recorded_at=record_at
 ))$new$);EXECUTE body;
END $$;
