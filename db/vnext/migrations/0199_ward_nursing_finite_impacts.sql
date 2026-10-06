SELECT pg_advisory_xact_lock(901002);

-- The original accepted pins stay immutable. Only a relation's explicit
-- declaration and END determine its retained obligation; endpoint suspension
-- and closure stop admission without silently disposing another Owner's fact.
CREATE FUNCTION care_organization.ward_nursing_obligation(p_history jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE declaration jsonb;ending timestamp;BEGIN
 SELECT value INTO declaration FROM jsonb_array_elements(p_history->'versions')
  WHERE value->>'action' IN ('CREATE','REVISE') ORDER BY (value->>'number')::bigint DESC LIMIT 1;
 IF declaration IS NULL THEN RETURN NULL;END IF;
 SELECT min((value->>'validFrom')::timestamp) INTO ending FROM jsonb_array_elements(p_history->'versions') WHERE value->>'action'='END';
 ending:=least(ending,(declaration->>'validTo')::timestamp);
 RETURN jsonb_build_object('original',p_history->'versions'->0,'declaration',declaration,'head',p_history->'versions'->-1,
  'from',declaration->>'validFrom','to',to_char(CASE WHEN ending IS NULL THEN NULL ELSE greatest((declaration->>'validFrom')::timestamp,ending) END,'YYYY-MM-DD"T"HH24:MI:SS.US'));
END $$;

CREATE FUNCTION care_organization.ward_nursing_accepted_departments(p_facts jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 WITH endpoints AS (
  SELECT p_facts->'dependencies'->'upstream'->'nursing' endpoint
  UNION ALL SELECT value FROM jsonb_array_elements(coalesce(p_facts->'dependencies'->'upstream'->'participants','[]'))
  UNION ALL SELECT p_facts->'dependencies'->'upstream'->'ward'
 ), accepted AS (
  SELECT part.value->'basis'->'department'->>'id' department_id,dp.value pin
  FROM endpoints e CROSS JOIN LATERAL jsonb_array_elements(coalesce(e.endpoint->'parts','[]')) part
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(part.value->'basis'->'department'->'parts','[]')) dp
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('departmentId',department_id,'acceptedVersions',pins) ORDER BY department_id),'[]')
 FROM (SELECT department_id,jsonb_agg(DISTINCT pin ORDER BY pin) pins FROM accepted WHERE department_id IS NOT NULL GROUP BY department_id) grouped;
$$;

-- Read all participating endpoint bindings at one R, including their exact
-- version coordinates. Qualification failures do not release retained duties.
CREATE FUNCTION care_organization.ward_nursing_current_departments(p_actor text,p_history jsonb,p_r timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE obligation jsonb:=care_organization.ward_nursing_obligation(p_history);h jsonb;b jsonb;v jsonb;u jsonb;nursing_id text;piece tsrange;span tsrange;
 from_at timestamp;to_at timestamp;rows jsonb:='[]';basis jsonb:='[]';result jsonb;BEGIN
 IF obligation IS NULL THEN RETURN jsonb_build_object('departments','[]'::jsonb,'digest',encode(sha256(convert_to('[]','UTF8')),'hex'));END IF;
 from_at:=(obligation->>'from')::timestamp;to_at:=(obligation->>'to')::timestamp;
 FOR nursing_id IN SELECT DISTINCT id FROM (
  SELECT p_history->'applicability'->'nursing'->>'id' id
  UNION ALL SELECT value FROM jsonb_array_elements_text(coalesce(obligation->'declaration'->'facts'->'rule'->'participants','[]'))
 ) q ORDER BY id LOOP
  h:=care_organization.nursing_snapshot_at(p_actor,nursing_id::uuid,p_r);basis:=basis||jsonb_build_array(h);
  FOR b IN SELECT value FROM jsonb_array_elements(h->'bindings') WHERE value->>'campusId'=p_history->'applicability'->'campus'->>'id' LOOP
   v:=b->'versions'->-1;
   IF to_at IS NOT NULL AND to_at<=from_at THEN CONTINUE;END IF;
   piece:=tsrange((v->>'validFrom')::timestamp,(v->>'validTo')::timestamp,'[)')*tsrange(from_at,to_at,'[)');
   IF NOT isempty(piece) THEN rows:=rows||jsonb_build_array(jsonb_build_object('departmentId',v->'binding'->'department'->>'id','from',lower(piece),'to',upper(piece)));END IF;
  END LOOP;
 END LOOP;
 h:=care_organization.ward_snapshot_at(p_actor,(p_history->'applicability'->'ward'->>'id')::uuid,p_r);basis:=basis||jsonb_build_array(h);
 FOR b IN SELECT value FROM jsonb_array_elements(h->'bindings') LOOP
  v:=b->'versions'->-1;
  u:=care_organization.snapshot_at(p_actor,(v->'binding'->'unit'->>'id')::uuid,p_r);basis:=basis||jsonb_build_array(u);
  IF to_at IS NOT NULL AND to_at<=from_at THEN CONTINUE;END IF;
  piece:=tsrange((v->>'validFrom')::timestamp,(v->>'validTo')::timestamp,'[)')*tsrange(from_at,to_at,'[)');
  IF NOT isempty(piece) THEN rows:=rows||jsonb_build_array(jsonb_build_object('departmentId',u->>'departmentId','from',lower(piece),'to',upper(piece)));END IF;
 END LOOP;
 WITH grouped AS (SELECT value->>'departmentId' id,range_agg(tsrange((value->>'from')::timestamp,(value->>'to')::timestamp,'[)')) periods FROM jsonb_array_elements(rows) GROUP BY value->>'departmentId')
 SELECT coalesce(jsonb_agg(jsonb_build_object('departmentId',g.id,'periods',(SELECT jsonb_agg(jsonb_build_object('from',to_char(lower(p),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(upper(p),'YYYY-MM-DD"T"HH24:MI:SS.US')) ORDER BY lower(p)) FROM unnest(g.periods) p)) ORDER BY g.id),'[]') INTO result FROM grouped g;
 RETURN jsonb_build_object('departments',result,'digest',encode(sha256(convert_to(basis::text,'UTF8')),'hex'));
END $$;

CREATE FUNCTION care_organization.ward_nursing_department_references(p_actor text,p_departments jsonb,p_scope text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b record;h jsonb;o jsonb;accepted jsonb;current_basis jsonb;dept text;pins jsonb;periods jsonb;live boolean;result jsonb:='[]';r timestamp:=timezone('Asia/Shanghai',clock_timestamp());BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF p_scope NOT IN ('NORTH','SOUTH') OR jsonb_typeof(p_departments) IS DISTINCT FROM 'array' OR jsonb_array_length(p_departments) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR b IN SELECT c.* FROM care_organization.ward_nursing c WHERE c.scope=p_scope AND (
  EXISTS(SELECT 1 FROM care_organization.nursing_unit_binding nb WHERE p_departments ? nb.managing_department_id::text AND (nb.unit_id=c.nursing_unit_id OR EXISTS(SELECT 1 FROM care_organization.ward_nursing_version cv WHERE cv.ward_nursing_id=c.id AND cv.recorded_at<=r AND cv.facts->'rule'->'participants' ? nb.unit_id::text)))
  OR EXISTS(SELECT 1 FROM care_organization.ward_unit_binding wb JOIN care_organization.unit u ON u.id=wb.managing_unit_id WHERE wb.unit_id=c.ward_id AND p_departments ? u.department_id::text)
 ) ORDER BY c.id LOOP
  h:=care_organization.ward_nursing_snapshot_at(p_actor,b.id,r);o:=care_organization.ward_nursing_obligation(h);IF o IS NULL THEN CONTINUE;END IF;
  PERFORM care_organization.ward_nursing_evidence_access(p_actor,h,jsonb_build_array(o->'original'->>'id',o->'head'->>'id'));
  accepted:=care_organization.ward_nursing_accepted_departments(o->'original'->'facts');current_basis:=care_organization.ward_nursing_current_departments(p_actor,h,r);
  FOR dept IN SELECT DISTINCT value->>'departmentId' FROM jsonb_array_elements(accepted||(current_basis->'departments')) WHERE p_departments ? (value->>'departmentId') ORDER BY 1 LOOP
   SELECT value->'acceptedVersions' INTO pins FROM jsonb_array_elements(accepted) WHERE value->>'departmentId'=dept;
   SELECT value->'periods' INTO periods FROM jsonb_array_elements(current_basis->'departments') WHERE value->>'departmentId'=dept;periods:=coalesce(periods,'[]');
   live:=EXISTS(SELECT 1 FROM jsonb_array_elements(periods) p WHERE (p->>'to') IS NULL OR (p->>'to')::timestamp>greatest((p->>'from')::timestamp,r));
   result:=result||jsonb_build_array(jsonb_build_object('owner','WARD_NURSING_COVERAGE','id',b.id,'versionId',o->'original'->>'id','version',o->'original'->>'number','referenceRole','OWNER','sourceSystemIds',jsonb_build_array(b.source_system_id),'departmentId',dept,'departmentVersionId',NULL,'acceptedVersions',coalesce(pins,'[]'),'originalPeriod',jsonb_build_object('from',o->'original'->>'validFrom','to',o->'original'->>'validTo'),'originalDigest',encode(sha256(convert_to((o->'original')::text,'UTF8')),'hex'),'frozenLabel','NURSING_COVERAGE','currentVersionId',o->'head'->>'id','currentPeriod',jsonb_build_object('from',o->>'from','to',o->>'to'),'currentPeriods',periods,'currentDependencyDigest',current_basis->>'digest','currentAction',o->'head'->>'action','currentTargetId',dept,'currentReferencesDepartment',jsonb_array_length(periods)>0,'current',live));
   IF jsonb_array_length(result)>2000 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;
  END LOOP;
 END LOOP;RETURN result;
END $$;

CREATE FUNCTION care_organization.ward_nursing_evidence_access(p_actor text,p_history jsonb,p_versions jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v jsonb;participant text;part jsonb;BEGIN
 FOR v IN SELECT value FROM jsonb_array_elements(p_history->'versions') WHERE p_versions ? (value->>'id') LOOP
  PERFORM department_master.evolution_source_authorize(p_actor,(v->'facts'->'source'->>'sourceSystemId')::uuid);
  FOR participant IN SELECT value FROM jsonb_array_elements_text(coalesce(v->'facts'->'rule'->'participants','[]')) LOOP PERFORM care_organization.nursing_snapshot(p_actor,participant::uuid);END LOOP;
  FOR part IN SELECT value FROM jsonb_array_elements(coalesce(v->'facts'->'dependencies'->'upstream'->'ward'->'parts','[]')) LOOP PERFORM care_organization.snapshot(p_actor,(part->'binding'->'unit'->>'id')::uuid);END LOOP;
 END LOOP;
END $$;

CREATE FUNCTION care_organization.ward_nursing_reference_access(p_actor text,p_ref jsonb,p_permission text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h jsonb;BEGIN
 IF p_ref->>'owner' IS DISTINCT FROM 'WARD_NURSING_COVERAGE' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 h:=care_organization.ward_nursing_snapshot(p_actor,(p_ref->>'id')::uuid);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(h->'versions') v WHERE v->>'id'=p_ref->>'versionId') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(h->'versions') v WHERE v->>'id'=p_ref->>'currentVersionId') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM care_organization.ward_nursing_authorize(p_actor,(h->'applicability'->'campus'->>'id')::uuid,p_permission);
 PERFORM department_master.snapshot(p_actor,(p_ref->>'departmentId')::uuid);
 PERFORM care_organization.ward_nursing_evidence_access(p_actor,h,jsonb_build_array(p_ref->>'versionId',p_ref->>'currentVersionId'));
 PERFORM care_organization.ward_nursing_current_departments(p_actor,h,timezone('Asia/Shanghai',clock_timestamp()));
END $$;

CREATE FUNCTION care_organization.ward_nursing_campus_dependencies(p_actor text,p_campus uuid,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b record;h jsonb;o jsonb;active boolean;outstanding boolean;from_at timestamp;to_at timestamp;result jsonb:='[]';r timestamp:=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM organization_master.campus_snapshot(p_actor,p_campus);
 IF p_from IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 FOR b IN SELECT * FROM care_organization.ward_nursing WHERE campus_id=p_campus ORDER BY id LOOP
  h:=care_organization.ward_nursing_snapshot_at(p_actor,b.id,r);o:=care_organization.ward_nursing_obligation(h);IF o IS NULL THEN CONTINUE;END IF;
  PERFORM care_organization.ward_nursing_evidence_access(p_actor,h,jsonb_build_array(o->'original'->>'id',o->'head'->>'id'));
  PERFORM care_organization.ward_nursing_current_departments(p_actor,h,r);
  from_at:=(o->>'from')::timestamp;to_at:=(o->>'to')::timestamp;active:=to_at IS NULL OR to_at>from_at;
  IF active THEN active:=tsrange(from_at,to_at,'[)')&&tsrange(p_from,p_to,'[)');END IF;
  outstanding:=active AND (p_to IS NULL OR p_to>r) AND (to_at IS NULL OR to_at>greatest(p_from,r));
  result:=result||jsonb_build_array(jsonb_build_object('owner','WARD_NURSING_COVERAGE','id',b.id,'version',o->'head'->>'number','active',active,'outstanding',outstanding));
 END LOOP;RETURN result;
END $$;

CREATE FUNCTION care_organization.ward_nursing_endpoint_impacts(p_actor text,p_kind text,p_id uuid,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE endpoint jsonb;b record;h jsonb;o jsonb;active boolean;outstanding boolean;from_at timestamp;to_at timestamp;piece tsrange;stop jsonb;lifecycles jsonb;affected jsonb;items jsonb:='[]';r timestamp:=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF p_from IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 IF p_kind='NURSING' THEN endpoint:=care_organization.nursing_snapshot_at(p_actor,p_id,r);
 ELSIF p_kind='WARD' THEN endpoint:=care_organization.ward_snapshot_at(p_actor,p_id,r);ELSE RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('versionId',value->>'id','action',value->>'action','from',value->>'validFrom','to',NULL) ORDER BY (value->>'number')::bigint),'[]') INTO lifecycles FROM jsonb_array_elements(endpoint->'versions') WHERE value->>'action' IN ('SUSPEND','CLOSE');
 FOR b IN SELECT c.* FROM care_organization.ward_nursing c WHERE (p_kind='WARD' AND c.ward_id=p_id) OR (p_kind='NURSING' AND (c.nursing_unit_id=p_id OR EXISTS(SELECT 1 FROM care_organization.ward_nursing_version v WHERE v.ward_nursing_id=c.id AND v.recorded_at<=r AND v.facts->'rule'->'participants' ? p_id::text))) ORDER BY c.id LOOP
  h:=care_organization.ward_nursing_snapshot_at(p_actor,b.id,r);o:=care_organization.ward_nursing_obligation(h);IF o IS NULL THEN CONTINUE;END IF;
  PERFORM care_organization.ward_nursing_evidence_access(p_actor,h,jsonb_build_array(o->'original'->>'id',o->'head'->>'id'));
  PERFORM care_organization.ward_nursing_current_departments(p_actor,h,r);
  IF p_kind='NURSING' AND b.nursing_unit_id<>p_id AND NOT coalesce(o->'declaration'->'facts'->'rule'->'participants' ? p_id::text,false) THEN CONTINUE;END IF;
  from_at:=(o->>'from')::timestamp;to_at:=(o->>'to')::timestamp;active:=to_at IS NULL OR to_at>from_at;
  IF active THEN active:=tsrange(from_at,to_at,'[)')&&tsrange(p_from,p_to,'[)');END IF;
  outstanding:=active AND (p_to IS NULL OR p_to>r) AND (to_at IS NULL OR to_at>greatest(p_from,r));affected:='[]';
  IF outstanding THEN FOR stop IN SELECT value FROM jsonb_array_elements(lifecycles) LOOP
   piece:=tsrange(from_at,to_at,'[)')*tsrange(greatest(p_from,r),p_to,'[)')*tsrange((stop->>'from')::timestamp,NULL,'[)');
   IF NOT isempty(piece) THEN affected:=affected||jsonb_build_array(jsonb_build_object('from',to_char(lower(piece),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(upper(piece),'YYYY-MM-DD"T"HH24:MI:SS.US')));END IF;
  END LOOP;END IF;
  items:=items||jsonb_build_array(jsonb_build_object('id',b.id,'applicability',h->'applicability','original',jsonb_build_object('versionId',o->'original'->>'id','version',o->'original'->>'number','period',jsonb_build_object('from',o->'original'->>'validFrom','to',o->'original'->>'validTo'),'coverage',o->'original'->'facts'->'coverageScope','digest',encode(sha256(convert_to((o->'original')::text,'UTF8')),'hex'),'dependencies',o->'original'->'facts'->'dependencies'),'current',jsonb_build_object('versionId',o->'head'->>'id','version',o->'head'->>'number','action',o->'head'->>'action','period',jsonb_build_object('from',o->>'from','to',o->>'to'),'coverage',o->'declaration'->'facts'->'coverageScope'),'active',active,'outstanding',outstanding,'affectedSpans',affected,'lifecycle',lifecycles,'constraint',CASE WHEN jsonb_array_length(affected)>0 THEN 'UNSATISFIED' ELSE 'SATISFIED' END));
  IF jsonb_array_length(items)>2000 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;
 END LOOP;
 RETURN jsonb_build_object('owner','WARD_NURSING_COVERAGE','endpoint',jsonb_build_object('kind',p_kind,'id',p_id),'validFrom',to_char(p_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(p_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordAsOf',to_char(r,'YYYY-MM-DD"T"HH24:MI:SS.US'),'status','EVALUATED','clinicalReadiness','NOT_READY','items',items);
END $$;

CREATE FUNCTION care_organization.ward_nursing_impact_result(p_actor text,p_ref jsonb,p_scope text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h jsonb;v care_organization.ward_nursing_version;c care_organization.ward_nursing_change;outcome jsonb;original jsonb;obligation jsonb;
 old_history jsonb;case_version jsonb;handover jsonb;old_head care_organization.ward_nursing_version;old_end care_organization.ward_nursing_version;old_declaration care_organization.ward_nursing_version;
 safe_shrink boolean:=false;departments jsonb;BEGIN
 h:=care_organization.ward_nursing_snapshot(p_actor,(p_ref->>'id')::uuid);IF h->>'scope' IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 SELECT * INTO v FROM care_organization.ward_nursing_version WHERE ward_nursing_id=(p_ref->>'id')::uuid AND id=(p_ref->>'versionId')::uuid;
 IF NOT FOUND OR v.action NOT IN ('CREATE','REVISE','END') THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 SELECT * INTO c FROM care_organization.ward_nursing_change WHERE id=v.change_id AND candidate_id=(p_ref->>'candidateId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 outcome:=governance_catalog.department_impact_committed_result(p_actor,c.candidate_id,(p_ref->>'requestId')::uuid);
 IF outcome->>'status' IS DISTINCT FROM 'COMMITTED' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(outcome->'facts') f WHERE f->>'owner'='care-organization/ward-nursing-coverage' AND f->>'id'=v.ward_nursing_id::text AND f->>'version'=v.number::text) THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 original:=h->'versions'->0;
 IF p_ref ? 'caseId' THEN
  obligation:=governance_catalog.department_impact_obligation(p_actor,(p_ref->>'caseId')::uuid,p_scope);
  IF obligation->>'kind' IS DISTINCT FROM 'REFERENCE' OR obligation->'reference'->>'owner' IS DISTINCT FROM 'WARD_NURSING_COVERAGE' THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  IF v.action='CREATE' THEN
   -- A committed CREATE can discharge this case only as its exact confirmed
   -- atomic successor. Department/time overlap alone proves no Ward handover.
   handover:=v.facts->'handover';
   IF handover->>'kind' IS DISTINCT FROM 'CONFIRMED_HANDOVER' OR handover->>'confirmed' IS DISTINCT FROM 'true'
    OR handover->'source'->>'owner' IS DISTINCT FROM 'care-organization/ward-nursing-coverage'
    OR handover->'source'->>'id' IS DISTINCT FROM obligation->'reference'->>'id'
    OR handover->>'successorSourceAlias' IS DISTINCT FROM v.facts->'source'->>'sourceAlias'
    OR handover->'successorNursing' IS DISTINCT FROM h->'applicability'->'nursing'
    OR (handover->>'cutover')::timestamp IS DISTINCT FROM v.valid_from THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
   old_history:=care_organization.ward_nursing_snapshot(p_actor,(obligation->'reference'->>'id')::uuid);
   SELECT value INTO case_version FROM jsonb_array_elements(old_history->'versions') WHERE value->>'id'=obligation->'reference'->>'versionId';
   IF case_version IS NULL OR case_version->>'action' NOT IN ('CREATE','REVISE')
    OR ((old_history->'applicability')-'nursing') IS DISTINCT FROM ((h->'applicability')-'nursing')
    OR old_history->'applicability'->'nursing' IS NOT DISTINCT FROM h->'applicability'->'nursing' THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
   -- Preserve the frozen case's complete scope. A later narrowed declaration
   -- cannot stand in for that original basis when proving complete replacement.
   IF NOT care_organization.ward_nursing_scope_contains(case_version->'facts'->'coverageScope',v.facts->'coverageScope')
    OR NOT care_organization.ward_nursing_scope_contains(v.facts->'coverageScope',case_version->'facts'->'coverageScope')
    OR NOT care_organization.ward_nursing_scope_contains(handover->'coverage',v.facts->'coverageScope')
    OR NOT care_organization.ward_nursing_scope_contains(v.facts->'coverageScope',handover->'coverage') THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
   SELECT * INTO old_head FROM care_organization.ward_nursing_version WHERE ward_nursing_id=(old_history->>'id')::uuid AND number=(handover->'source'->>'expectedHead')::bigint;
   IF NOT FOUND THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
   SELECT * INTO old_end FROM care_organization.ward_nursing_version WHERE ward_nursing_id=old_head.ward_nursing_id AND number=old_head.number+1 AND action='END' AND change_id=v.change_id;
   IF NOT FOUND OR old_end.valid_from IS DISTINCT FROM v.valid_from OR old_end.recorded_at IS DISTINCT FROM v.recorded_at
    OR old_head.recorded_at>old_end.recorded_at THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
   SELECT * INTO old_declaration FROM care_organization.ward_nursing_version WHERE ward_nursing_id=old_head.ward_nursing_id AND number<=old_head.number AND action IN ('CREATE','REVISE') ORDER BY number DESC LIMIT 1;
   IF NOT FOUND OR NOT care_organization.ward_nursing_scope_contains(old_declaration.facts->'coverageScope',v.facts->'coverageScope')
    OR NOT care_organization.ward_nursing_scope_contains(v.facts->'coverageScope',old_declaration.facts->'coverageScope')
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(outcome->'facts') f WHERE f->>'owner'='care-organization/ward-nursing-coverage' AND f->>'id'=old_head.ward_nursing_id::text AND f->>'version'=old_end.number::text AND f->'source'->>'step'='END') THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  ELSE
   IF obligation->'reference'->>'id' IS DISTINCT FROM v.ward_nursing_id::text THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
   SELECT value INTO original FROM jsonb_array_elements(h->'versions') WHERE value->>'id'=obligation->'reference'->>'versionId';IF original IS NULL THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  END IF;
 END IF;
 IF v.action='END' THEN safe_shrink:=v.valid_from>=(original->>'validFrom')::timestamp AND ((original->>'validTo') IS NULL OR v.valid_from<=(original->>'validTo')::timestamp);
 ELSIF v.action='REVISE' THEN safe_shrink:=v.valid_from=(original->>'validFrom')::timestamp AND ((original->>'validTo') IS NULL OR v.valid_to IS NOT NULL AND v.valid_to<=(original->>'validTo')::timestamp)
  AND care_organization.ward_nursing_scope_contains(original->'facts'->'coverageScope',v.facts->'coverageScope')
  AND (v.facts-ARRAY['coverageScope','coverageSource','source','verificationBasis','contractVersionId','dependencies','rule']) IS NOT DISTINCT FROM ((original->'facts')-ARRAY['coverageScope','coverageSource','source','verificationBasis','contractVersionId','dependencies','rule'])
  AND care_organization.ward_nursing_rule_equal(v.facts->'rule',original->'facts'->'rule')
  AND v.facts->'dependencies' IS NOT DISTINCT FROM original->'facts'->'dependencies';END IF;
 SELECT coalesce(jsonb_agg(value->>'departmentId' ORDER BY value->>'departmentId'),'[]') INTO departments FROM jsonb_array_elements(care_organization.ward_nursing_accepted_departments(v.facts));
 RETURN jsonb_build_object('owner','WARD_NURSING_COVERAGE','id',v.ward_nursing_id,'versionId',v.id,'departmentIds',departments,'period',jsonb_build_object('from',CASE WHEN v.action='END' THEN original->>'validFrom' ELSE to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US') END,'to',to_char(CASE WHEN v.action='END' THEN v.valid_from ELSE v.valid_to END,'YYYY-MM-DD"T"HH24:MI:SS.US')),'action',v.action,'safeShrink',safe_shrink);
END $$;

CREATE FUNCTION organization_master.campus_impact_with_ward_nursing(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_asof timestamp,p_units boolean,p_nursing boolean,p_wards boolean,p_capabilities boolean,p_relations boolean,p_coverages boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE report jsonb;BEGIN
 report:=organization_master.campus_impact_with_unit_ward(p_actor,p_id,p_from,p_to,p_asof,p_units,p_nursing,p_wards,p_capabilities,p_relations);
 IF p_coverages THEN report:=jsonb_set(report,'{dependencies}',(report->'dependencies')||care_organization.ward_nursing_campus_dependencies(p_actor,p_id,p_from,p_to,p_asof));report:=jsonb_set(report,'{unavailable}',(report->'unavailable')-'WARD_NURSING_COVERAGE');END IF;RETURN report;
END $$;

DO $integration$ DECLARE body text;needle text;f text;BEGIN
 FOREACH f IN ARRAY ARRAY['department_master.impact_reference_access(text,jsonb,text)','department_master.impact_case_authorize(text,jsonb,text,text)','department_master.impact_result(text,jsonb,text)'] LOOP
  body:=replace(pg_get_functiondef(f::regprocedure),E'\r\n',E'\n');
  IF f LIKE '%impact_reference_access%' THEN needle:=E'BEGIN\n';body:=replace(body,needle,needle||E' IF p_ref->>''owner''=''WARD_NURSING_COVERAGE'' THEN PERFORM care_organization.ward_nursing_reference_access(p_actor,p_ref,''READ'');RETURN;END IF;\n');
  ELSIF f LIKE '%impact_case_authorize%' THEN needle:=E'BEGIN\n';body:=replace(body,needle,needle||E' IF ref->>''owner''=''WARD_NURSING_COVERAGE'' THEN IF NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=p_actor AND active AND principal_kind=''HUMAN'') THEN RAISE EXCEPTION ''ACCESS_DENIED'';END IF;PERFORM care_organization.ward_nursing_reference_access(p_actor,ref,p_permission);RETURN department_master.lifecycle_authorize(p_actor,p_campus,p_permission);END IF;\n');
  ELSE needle:=E'BEGIN\n';body:=replace(body,needle,needle||E' IF p_ref->>''owner''=''WARD_NURSING_COVERAGE'' THEN RETURN care_organization.ward_nursing_impact_result(p_actor,p_ref,p_campus);END IF;\n');END IF;
  IF position(needle IN pg_get_functiondef(f::regprocedure))=0 THEN RAISE EXCEPTION 'WARD_NURSING_IMPACT_BASELINE_MISMATCH';END IF;EXECUTE body;
 END LOOP;
 body:=pg_get_functiondef('governance_catalog.department_impact_responsibility(text,uuid,uuid,text)'::regprocedure);needle:='WHEN ''UNIT_WARD_RELATION'' THEN ''ORG10''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_NURSING_RESPONSIBILITY_BASELINE_MISMATCH';END IF;EXECUTE replace(body,needle,needle||' WHEN ''WARD_NURSING_COVERAGE'' THEN ''ORG11''');
 body:=pg_get_functiondef('organization_master.campus_impact(text,uuid,timestamp,timestamp,timestamp)'::regprocedure);needle:='''UNIT_WARD_RELATION'',''LOCATION''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_NURSING_CAMPUS_BASELINE_MISMATCH';END IF;EXECUTE replace(body,needle,'''UNIT_WARD_RELATION'',''WARD_NURSING_COVERAGE'',''LOCATION''');
 body:=pg_get_functiondef('organization_master.campus_write_approved(text,text)'::regprocedure);
 needle:='organization_master.campus_impact_with_unit_ward(p_actor,s,(p_command->>''validFrom'')::timestamp,NULL,NULL,NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''BUSINESS_UNIT''),NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''NURSING_UNIT''),NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''WARD''),NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''UNIT_CAPABILITY''),NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''UNIT_WARD_RELATION''))';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_NURSING_CAMPUS_WRITE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,replace(needle,'campus_impact_with_unit_ward','campus_impact_with_ward_nursing')::text);
 body:=replace(body,'NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''UNIT_WARD_RELATION''))','NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''UNIT_WARD_RELATION''),NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''WARD_NURSING_COVERAGE''))');EXECUTE replace(body,'''UNIT_WARD_RELATION'',''LOCATION''','''UNIT_WARD_RELATION'',''WARD_NURSING_COVERAGE'',''LOCATION''');
 body:=pg_get_functiondef('department_master.project_ward_impact_references(text,jsonb,jsonb)'::regprocedure);
 needle:='IN (''WARD'',''UNIT_CAPABILITY'',''UNIT_WARD_RELATION'')';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_NURSING_PROJECTION_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IN (''WARD'',''UNIT_CAPABILITY'',''UNIT_WARD_RELATION'',''WARD_NURSING_COVERAGE'')');
 needle:='ref:=jsonb_set(ref,''{current}'',to_jsonb(active));';body:=replace(body,needle,'IF ref->>''owner''=''WARD_NURSING_COVERAGE'' THEN active:=(ref->>''current'')::boolean AND (ref->>''currentReferencesDepartment'')::boolean AND EXISTS(SELECT 1 FROM jsonb_array_elements(ref->''currentPeriods'') p WHERE (p->>''to'') IS NULL OR (p->>''to'')::timestamp>greatest((p->>''from'')::timestamp,boundary));END IF;'||needle);EXECUTE body;
 body:=pg_get_functiondef('department_master.evolution_impact_guard()'::regprocedure);needle:='jsonb_array_length(NEW.facts->''impacts'')<>12';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_NURSING_EVOLUTION_BASELINE_MISMATCH';END IF;
 body:=replace(body,'FROM jsonb_array_elements(NEW.facts->''impacts''))<>12','FROM jsonb_array_elements(NEW.facts->''impacts''))<>13');body:=replace(body,needle,'jsonb_array_length(NEW.facts->''impacts'')<>13');body:=replace(body,'''UNIT_CAPABILITY'',''UNIT_WARD_RELATION'']','''UNIT_CAPABILITY'',''UNIT_WARD_RELATION'',''WARD_NURSING_COVERAGE'']');
 needle:='IF jsonb_array_length(actual)>2000 THEN';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_NURSING_EVOLUTION_READER_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF EXISTS(SELECT 1 FROM jsonb_array_elements(assessment->''coverage'') c WHERE c->>''owner''=''WARD_NURSING_COVERAGE'' AND c->>''status''=''EVALUATED'') THEN actual:=actual||care_organization.ward_nursing_department_references(reviewer,departments,NEW.campus);END IF;'||needle);
 EXECUTE replace(body,'IN (''SOURCE_MAPPING'',''IDENTIFIER'',''HIERARCHY'',''WARD'',''UNIT_CAPABILITY'',''UNIT_WARD_RELATION'')','IN (''SOURCE_MAPPING'',''IDENTIFIER'',''HIERARCHY'',''WARD'',''UNIT_CAPABILITY'',''UNIT_WARD_RELATION'',''WARD_NURSING_COVERAGE'')');
END $integration$;

REVOKE ALL ON FUNCTION care_organization.ward_nursing_obligation(jsonb),care_organization.ward_nursing_accepted_departments(jsonb),care_organization.ward_nursing_current_departments(text,jsonb,timestamp),care_organization.ward_nursing_evidence_access(text,jsonb,jsonb),care_organization.ward_nursing_department_references(text,jsonb,text),care_organization.ward_nursing_reference_access(text,jsonb,text),care_organization.ward_nursing_campus_dependencies(text,uuid,timestamp,timestamp,timestamp),care_organization.ward_nursing_endpoint_impacts(text,text,uuid,timestamp,timestamp,timestamp),care_organization.ward_nursing_impact_result(text,jsonb,text),organization_master.campus_impact_with_ward_nursing(text,uuid,timestamp,timestamp,timestamp,boolean,boolean,boolean,boolean,boolean,boolean) FROM PUBLIC,hdi_prototype;
