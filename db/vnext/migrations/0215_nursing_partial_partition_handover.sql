SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION care_organization.nursing_partial_plan(p_handover jsonb,p_original jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE plan jsonb:=p_handover->'partitionPlan';s jsonb;coverage jsonb;ids text[]:='{}';aliases text[]:='{}';identifier text;matched boolean:=false;BEGIN
 IF plan IS NULL THEN RETURN false;END IF;
 PERFORM care_organization.nursing_closed(plan,ARRAY['sourceCoverage','successors']);
 IF p_original->>'kind' IS DISTINCT FROM 'PARTITIONS' OR NOT care_organization.ward_nursing_scope_contains(plan->'sourceCoverage',p_original) OR NOT care_organization.ward_nursing_scope_contains(p_original,plan->'sourceCoverage') OR jsonb_typeof(plan->'successors') IS DISTINCT FROM 'array' OR jsonb_array_length(plan->'successors') NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'HANDOVER_NOT_CONFIRMED';END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(plan->'successors') LOOP
  PERFORM care_organization.nursing_closed(s,ARRAY['sourceAlias','nursing','coverage']);PERFORM care_organization.nursing_closed(s->'nursing',ARRAY['owner','id']);
  IF s->'nursing'->>'owner' IS DISTINCT FROM 'care-organization/nursing' OR coalesce(s->'nursing'->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR length(btrim(coalesce(s->>'sourceAlias',''))) NOT BETWEEN 1 AND 64 OR s->>'sourceAlias'=ANY(aliases) THEN RAISE EXCEPTION 'HANDOVER_NOT_CONFIRMED';END IF;
  aliases:=array_append(aliases,s->>'sourceAlias');coverage:=s->'coverage';PERFORM care_organization.nursing_closed(coverage,ARRAY['kind','scopeSetId','version','partitionIds']);
  IF coverage->>'kind' IS DISTINCT FROM 'PARTITIONS' OR NOT care_organization.ward_nursing_scope_contains(p_original,coverage) OR jsonb_typeof(coverage->'partitionIds') IS DISTINCT FROM 'array' OR jsonb_array_length(coverage->'partitionIds') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'HANDOVER_NOT_CONFIRMED';END IF;
  FOR identifier IN SELECT value FROM jsonb_array_elements_text(coverage->'partitionIds') LOOP IF identifier=ANY(ids) THEN RAISE EXCEPTION 'HANDOVER_NOT_CONFIRMED';END IF;ids:=array_append(ids,identifier);END LOOP;
  IF s->>'sourceAlias'=p_handover->>'successorSourceAlias' AND s->'nursing'=p_handover->'successorNursing' AND care_organization.ward_nursing_scope_contains(coverage,p_handover->'coverage') AND care_organization.ward_nursing_scope_contains(p_handover->'coverage',coverage) THEN matched:=true;END IF;
 END LOOP;
 IF NOT matched OR cardinality(ids)<>jsonb_array_length(p_original->'partitionIds') OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_original->'partitionIds') source(id) WHERE NOT source.id=ANY(ids)) THEN RAISE EXCEPTION 'HANDOVER_NOT_CONFIRMED';END IF;RETURN true;
END $$;
REVOKE ALL ON FUNCTION care_organization.nursing_partial_plan(jsonb,jsonb) FROM PUBLIC,hdi_prototype;
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.nursing_handover_binding(jsonb)'::regprocedure);
 needle:='PERFORM care_organization.nursing_closed(h,ARRAY[''kind'',''source'',''successorSourceAlias'',''successorNursing'',''coverage'',''cutover'',''ruleReference'',''ruleVersion'',''evidenceId'',''confirmed'']);';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_PARTIAL_BINDING_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'PERFORM care_organization.nursing_closed(h-''partitionPlan'',ARRAY[''kind'',''source'',''successorSourceAlias'',''successorNursing'',''coverage'',''cutover'',''ruleReference'',''ruleVersion'',''evidenceId'',''confirmed'']);IF h ? ''partitionPlan'' THEN PERFORM care_organization.nursing_partial_plan(h,h->''partitionPlan''->''sourceCoverage'');END IF;');EXECUTE body;
 body:=pg_get_functiondef('care_organization.nursing_handover_context(text,jsonb)'::regprocedure);
 needle:='source.nursing_unit_id=successor';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_PARTIAL_CONTEXT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'(source.nursing_unit_id=successor AND NOT care_organization.nursing_partial_plan(h,declaration.facts->''coverageScope''))');
 needle:='NOT care_organization.ward_nursing_scope_contains(h->''coverage'',declaration.facts->''coverageScope'')';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_PARTIAL_SCOPE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'(NOT care_organization.nursing_partial_plan(h,declaration.facts->''coverageScope'') AND '||needle||')');EXECUTE body;
 body:=pg_get_functiondef('care_organization.ward_nursing_mutate_0199(text,text)'::regprocedure);
 needle:='source_coverage.nursing_unit_id=u.nursing_unit_id';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_PARTIAL_SQL_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'(source_coverage.nursing_unit_id=u.nursing_unit_id AND NOT care_organization.nursing_partial_plan(handover,oldfacts->''coverageScope''))');
 needle:='NOT care_organization.ward_nursing_scope_contains(w->''facts''->''coverageScope'',oldfacts->''coverageScope'')';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_PARTIAL_SQL_SCOPE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'(NOT care_organization.nursing_partial_plan(handover,oldfacts->''coverageScope'') AND '||needle||')');
 needle:='END IF;
  ELSIF w->>''action''=''CREATE'' AND (handover->>''kind'' IS DISTINCT FROM ''NO_HANDOVER_REQUIRED''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_PARTIAL_SUCCESSOR_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$END IF;
   IF care_organization.nursing_partial_plan(handover,oldfacts->'coverageScope') THEN
    IF to_at IS DISTINCT FROM (SELECT valid_to FROM care_organization.ward_nursing_version WHERE ward_nursing_id=source_coverage.id AND action IN ('CREATE','REVISE') ORDER BY number DESC LIMIT 1) OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(handover->'partitionPlan'->'successors') successor WHERE (SELECT count(*) FROM jsonb_array_elements(t->'writes') next WHERE next->>'action'='CREATE' AND next->'facts'->'source'->>'sourceAlias'=successor->>'sourceAlias' AND next->'applicability'->'nursing'=successor->'nursing' AND care_organization.ward_nursing_scope_contains(next->'facts'->'coverageScope',successor->'coverage') AND care_organization.ward_nursing_scope_contains(successor->'coverage',next->'facts'->'coverageScope') AND (next->>'validFrom')::timestamp=from_at AND (next->>'validTo')::timestamp IS NOT DISTINCT FROM to_at AND next->'facts'->'handover'->'source'=handover->'source' AND next->'facts'->'handover'->'partitionPlan'=handover->'partitionPlan')<>1
    ) THEN RAISE EXCEPTION 'HANDOVER_NOT_CONFIRMED';END IF;
   END IF;
  ELSIF w->>'action'='CREATE' AND (handover->>'kind' IS DISTINCT FROM 'NO_HANDOVER_REQUIRED'$new$);EXECUTE body;
END $$;
