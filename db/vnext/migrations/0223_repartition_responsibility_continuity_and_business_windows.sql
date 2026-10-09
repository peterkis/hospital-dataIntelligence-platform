SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION care_organization.ward_nursing_scope_versions_for_ward(p_actor text,p_ward uuid,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d jsonb;head bigint;number bigint;result jsonb:='[]';BEGIN
 d:=care_organization.ward_nursing_scope_for_ward(p_actor,p_ward,p_r);IF d IS NULL THEN RETURN result;END IF;head:=(d->>'version')::bigint;
 FOR number IN 1..head LOOP result:=result||jsonb_build_array(care_organization.ward_nursing_scope_version_read(p_actor,(d->>'id')::uuid,number,p_r));END LOOP;RETURN result;
END $$;
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.nursing_partial_plan(jsonb,jsonb)'::regprocedure);
 needle:='jsonb_array_length(plan->''successors'') NOT BETWEEN 2 AND 100';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_SINGLE_SUCCESSOR_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'(jsonb_array_length(plan->''successors'') NOT BETWEEN 1 AND 100 OR (NOT plan ? ''repartition'' AND jsonb_array_length(plan->''successors'')<2))');EXECUTE body;
 body:=pg_get_functiondef('care_organization.ward_nursing_mutate_0199(text,text)'::regprocedure);
 needle:='next->>''action''=''CREATE'' AND next->''facts''->''source''->>''sourceAlias''=successor->>''sourceAlias''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_PRIMARY_SUCCESSOR_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'next->>''action''=''CREATE'' AND next->''facts''->''isPrimary'' IS NOT DISTINCT FROM oldfacts->''isPrimary'' AND next->''facts''->''source''->>''sourceAlias''=successor->>''sourceAlias''');EXECUTE body;
 body:=pg_get_functiondef('care_organization.lifecycle_record(text,text)'::regprocedure);
 needle:='IF op=''COMMIT_CHECK'' THEN';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_RESPONSIBILITY_COMMIT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$IF op='COMMIT_CHECK' THEN
  IF EXISTS(
   SELECT 1 FROM care_organization.ward_nursing_scope_version sv JOIN care_organization.ward_nursing_change scope_change ON scope_change.id=sv.change_id JOIN care_organization.ward_nursing_scope_set ss ON ss.id=sv.scope_set_id JOIN care_organization.ward_nursing rel ON rel.ward_id=ss.ward_id JOIN care_organization.ward_nursing_version ending ON ending.ward_nursing_id=rel.id AND ending.action='END' JOIN care_organization.ward_nursing_change end_change ON end_change.id=ending.change_id
   CROSS JOIN LATERAL (SELECT facts,valid_to FROM care_organization.ward_nursing_version WHERE ward_nursing_id=rel.id AND action IN ('CREATE','REVISE') ORDER BY number DESC LIMIT 1) original
   WHERE scope_change.candidate_id=(c->>'id')::uuid AND end_change.candidate_id=scope_change.candidate_id AND (original.facts->'coverageScope'->>'kind'='WHOLE_WARD' OR (original.facts->'coverageScope'->>'scopeSetId'=ss.id::text AND (original.facts->'coverageScope'->>'version')::bigint<sv.number))
   AND NOT EXISTS(SELECT 1 FROM care_organization.ward_nursing_version successor JOIN care_organization.ward_nursing_change successor_change ON successor_change.id=successor.change_id WHERE successor_change.candidate_id=scope_change.candidate_id AND successor.action='CREATE' AND successor.facts->'handover'->>'kind'='CONFIRMED_HANDOVER' AND successor.facts->'handover'->'source'->>'id'=rel.id::text AND successor.facts->'isPrimary' IS NOT DISTINCT FROM original.facts->'isPrimary' AND successor.valid_from=ending.valid_from AND successor.valid_to IS NOT DISTINCT FROM original.valid_to)
  ) THEN RAISE EXCEPTION 'HANDOVER_NOT_CONFIRMED';END IF;
$new$);EXECUTE body;
END $$;
REVOKE ALL ON FUNCTION care_organization.ward_nursing_scope_versions_for_ward(text,uuid,timestamp) FROM PUBLIC,hdi_prototype;
