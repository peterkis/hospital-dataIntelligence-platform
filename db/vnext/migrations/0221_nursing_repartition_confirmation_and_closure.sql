SELECT pg_advisory_xact_lock(901002);
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.nursing_partial_plan(jsonb,jsonb)'::regprocedure);
 body:=replace(body,'ARRAY[''sourceCoverage'',''successors'']','ARRAY[''sourceCoverage'',''successors'',''repartition'']');
 body:=replace(body,'p_original->>''kind'' IS DISTINCT FROM ''PARTITIONS'' OR', '(p_original->>''kind'' IS DISTINCT FROM ''PARTITIONS'' AND NOT plan ? ''repartition'') OR');
 body:=replace(body,'NOT care_organization.ward_nursing_scope_contains(p_original,coverage)','(NOT plan ? ''repartition'' AND NOT care_organization.ward_nursing_scope_contains(p_original,coverage))');
 body:=replace(body,'cardinality(ids)<>jsonb_array_length(p_original->''partitionIds'') OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_original->''partitionIds'') source(id) WHERE NOT source.id=ANY(ids))','(NOT plan ? ''repartition'' AND (cardinality(ids)<>jsonb_array_length(p_original->''partitionIds'') OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_original->''partitionIds'') source(id) WHERE NOT source.id=ANY(ids))))');
 body:=replace(body,'IF plan IS NULL THEN RETURN false;END IF;', 'IF plan IS NULL THEN RETURN false;END IF;IF plan ? ''repartition'' THEN PERFORM care_organization.nursing_closed(plan->''repartition'',ARRAY[''inputId'',''revisionId'',''digest'',''contractVersionId'']);END IF;');EXECUTE body;
 body:=pg_get_functiondef('care_organization.nursing_handover_context(text,jsonb)'::regprocedure);
 needle:='NOT care_organization.ward_nursing_scope_contains(declaration.facts->''coverageScope'',h->''coverage'')';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_SCOPE_CONFIRM_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'(NOT care_organization.nursing_partial_plan(h,declaration.facts->''coverageScope'') AND '||needle||')');
 needle:='PERFORM care_organization.nursing_snapshot(p_actor,source.nursing_unit_id);';
 body:=replace(body,needle,'IF h->''partitionPlan'' ? ''repartition'' THEN PERFORM care_organization.nursing_repartition_reference(p_actor,h);END IF;'||needle);EXECUTE body;
 body:=pg_get_functiondef('care_organization.ward_nursing_mutate_0199(text,text)'::regprocedure);
 needle:='NOT care_organization.ward_nursing_scope_contains(oldfacts->''coverageScope'',w->''facts''->''coverageScope'')';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_SCOPE_COVERAGE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'(NOT care_organization.nursing_partial_plan(handover,oldfacts->''coverageScope'') AND '||needle||')');
 needle:='AND care_organization.ward_nursing_scope_intersects(ov.facts->''coverageScope'',w->''facts''->''coverageScope'')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_SCOPE_PRIOR_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$AND CASE WHEN ov.facts->'coverageScope'->>'kind'='PARTITIONS' AND w->'facts'->'coverageScope'->>'kind'='PARTITIONS' AND ov.facts->'coverageScope'->>'version' IS DISTINCT FROM w->'facts'->'coverageScope'->>'version' THEN false ELSE care_organization.ward_nursing_scope_intersects(ov.facts->'coverageScope',w->'facts'->'coverageScope') END$new$);
 needle:='IF care_organization.nursing_partial_plan(handover,oldfacts->''coverageScope'') THEN';
 body:=replace(body,needle,'IF handover->''partitionPlan'' ? ''repartition'' THEN PERFORM care_organization.nursing_repartition_reference(actor,handover);PERFORM care_organization.nursing_repartition_mapping(actor,handover,oldfacts->''coverageScope'',record_at);END IF;'||needle);EXECUTE body;
END $$;
CREATE FUNCTION care_organization.nursing_repartition_reference(p_actor text,p_h jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ref jsonb:=p_h->'partitionPlan'->'repartition';r care_organization.ward_nursing_input;j jsonb;p care_organization.ward_nursing_scope_proposal;part text;s jsonb;BEGIN
 PERFORM care_organization.nursing_closed(ref,ARRAY['inputId','revisionId','digest','contractVersionId']);
 r:=jsonb_populate_record(NULL::care_organization.ward_nursing_input,care_organization.ward_nursing_input_read(p_actor,(ref->>'inputId')::uuid,'READ_RESTRICTED'));j:=care_organization.ward_nursing_job_read(p_actor,r.id);
 IF r.revision::text IS DISTINCT FROM ref->>'revisionId' OR r.digest IS DISTINCT FROM ref->>'digest' OR j->'contract'->>'versionId' IS DISTINCT FROM ref->>'contractVersionId' OR r.job_revision::text IS DISTINCT FROM j->>'currentRevisionId' OR EXISTS(SELECT 1 FROM care_organization.ward_nursing_withdrawal WHERE input_id=r.id) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 SELECT * INTO p FROM care_organization.ward_nursing_scope_proposal WHERE input_id=r.id;IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_COVERAGE_SCOPE';END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_h->'partitionPlan'->'successors') LOOP
  IF s->'coverage'->>'kind' IS DISTINCT FROM 'PARTITIONS' OR s->'coverage'->>'scopeSetId' IS DISTINCT FROM p.scope_set_id::text OR s->'coverage'->>'version' IS DISTINCT FROM (p.expected_head+1)::text THEN RAISE EXCEPTION 'SCOPE_BASIS_MISMATCH';END IF;
  FOR part IN SELECT value FROM jsonb_array_elements_text(s->'coverage'->'partitionIds') LOOP IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.partitions) q WHERE q->>'id'=part) THEN RAISE EXCEPTION 'UNKNOWN_COVERAGE_SCOPE';END IF;END LOOP;
 END LOOP;
END $$;
CREATE FUNCTION care_organization.nursing_repartition_mapping(p_actor text,p_h jsonb,p_original jsonb,p_r timestamp) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v care_organization.ward_nursing_scope_version;old jsonb;ids jsonb;expected jsonb;actual jsonb;BEGIN
 SELECT * INTO v FROM care_organization.ward_nursing_scope_version WHERE input_id=(p_h->'partitionPlan'->'repartition'->>'inputId')::uuid AND recorded_at<=p_r;IF NOT FOUND THEN RAISE EXCEPTION 'SCOPE_REPARTITION_REQUIRES_LIFECYCLE';END IF;
 old:=care_organization.ward_nursing_scope_version_read(p_actor,v.scope_set_id,v.number-1,p_r);
 IF p_original->>'kind'='PARTITIONS' THEN IF p_original->>'scopeSetId' IS DISTINCT FROM v.scope_set_id::text OR p_original->>'version' IS DISTINCT FROM (v.number-1)::text THEN RAISE EXCEPTION 'SCOPE_BASIS_MISMATCH';END IF;ids:=p_original->'partitionIds';ELSE SELECT jsonb_agg(q->>'id') INTO ids FROM jsonb_array_elements(old->'partitions') q;END IF;
 SELECT coalesce(jsonb_agg(DISTINCT part->>'id' ORDER BY part->>'id'),'[]') INTO expected FROM jsonb_array_elements(v.definition->'mapping') m CROSS JOIN LATERAL jsonb_array_elements(v.partitions) part WHERE ids ? (m->>'partitionId') AND m->'toAliases' ? (part->>'sourceAlias');
 SELECT jsonb_agg(part ORDER BY part) INTO actual FROM jsonb_array_elements(p_h->'partitionPlan'->'successors') s CROSS JOIN LATERAL jsonb_array_elements_text(s->'coverage'->'partitionIds') part;
 IF expected IS DISTINCT FROM actual THEN RAISE EXCEPTION 'SCOPE_MAPPING_INCOMPLETE';END IF;
END $$;
-- The new definition alone cannot release occupancy from any old coverage, including future declarations.
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.lifecycle_record(text,text)'::regprocedure);
 needle:='IF op=''COMMIT_CHECK'' THEN';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_SCOPE_COMMIT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$IF op='COMMIT_CHECK' THEN
  IF EXISTS(SELECT 1 FROM care_organization.ward_nursing_scope_version sv JOIN care_organization.ward_nursing_scope_set ss ON ss.id=sv.scope_set_id JOIN care_organization.ward_nursing_change ch ON ch.id=sv.change_id JOIN care_organization.ward_nursing rel ON rel.ward_id=ss.ward_id CROSS JOIN LATERAL (SELECT facts FROM care_organization.ward_nursing_version WHERE ward_nursing_id=rel.id AND action IN ('CREATE','REVISE') ORDER BY number DESC LIMIT 1) d WHERE ch.candidate_id=(c->>'id')::uuid AND (d.facts->'coverageScope'->>'kind'='WHOLE_WARD' OR (d.facts->'coverageScope'->>'scopeSetId'=ss.id::text AND (d.facts->'coverageScope'->>'version')::bigint<sv.number)) AND care_organization.ward_nursing_reserved(rel.id,timezone('Asia/Shanghai',clock_timestamp())) && tsrange(sv.valid_from,NULL,'[)')) THEN RAISE EXCEPTION 'SCOPE_AFFECTED_COVERAGE_OMITTED';END IF;
$new$);EXECUTE body;
END $$;
REVOKE ALL ON FUNCTION care_organization.nursing_repartition_reference(text,jsonb),care_organization.nursing_repartition_mapping(text,jsonb,jsonb,timestamp) FROM PUBLIC,hdi_prototype;
