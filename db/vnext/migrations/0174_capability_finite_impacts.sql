SELECT pg_advisory_xact_lock(901002);

-- Owner-owned finite readers retain the first accepted evidence. Current
-- obligation periods are clipped by explicit END, including future grants.
CREATE FUNCTION care_organization.capability_department_references(p_actor text,p_departments jsonb,p_scope text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b record;h jsonb;original jsonb;d jsonb;head jsonb;ending timestamp;observed timestamp:=timezone('Asia/Shanghai',clock_timestamp());accepted jsonb;result jsonb:='[]';BEGIN
 IF p_scope NOT IN ('NORTH','SOUTH') OR jsonb_typeof(p_departments)<>'array' OR jsonb_array_length(p_departments) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR b IN SELECT c.*,u.department_id FROM care_organization.capability c JOIN care_organization.unit u ON u.id=c.unit_id WHERE c.scope=p_scope AND p_departments ? u.department_id::text ORDER BY c.id LOOP
  h:=care_organization.capability_snapshot(p_actor,b.id);original:=h->'versions'->0;head:=h->'versions'->(jsonb_array_length(h->'versions')-1);
  SELECT x INTO d FROM jsonb_array_elements(h->'versions') x WHERE x->>'action' IN ('GRANT','REVISE') ORDER BY (x->>'number')::bigint DESC LIMIT 1;
  SELECT min((x->>'validFrom')::timestamp) INTO ending FROM jsonb_array_elements(h->'versions') x WHERE x->>'action'='END';ending:=least(ending,(d->>'validTo')::timestamp);
  SELECT coalesce(jsonb_agg(DISTINCT dp.item),'[]') INTO accepted FROM jsonb_array_elements(coalesce(original->'facts'->'dependencies'->'unit'->'parts','[]')) part(item) CROSS JOIN LATERAL jsonb_array_elements(coalesce(part.item->'department'->'accepted'->'departmentParts','[]')) dp(item);
  result:=result||jsonb_build_array(jsonb_build_object('owner','UNIT_CAPABILITY','id',b.id,'versionId',original->>'id','version',original->>'number','referenceRole','OWNER','sourceSystemIds',jsonb_build_array(b.source_system_id),'departmentId',b.department_id,'departmentVersionId',NULL,'acceptedVersions',accepted,'originalPeriod',jsonb_build_object('from',original->>'validFrom','to',original->>'validTo'),'originalDigest',encode(sha256(convert_to(original::text,'UTF8')),'hex'),'frozenLabel',b.applicability->>'capabilityType','currentVersionId',head->>'id','currentPeriod',jsonb_build_object('from',d->>'validFrom','to',to_char(CASE WHEN ending IS NULL THEN NULL ELSE greatest((d->>'validFrom')::timestamp,ending) END,'YYYY-MM-DD"T"HH24:MI:SS.US')),'currentAction',head->>'action','currentTargetId',b.department_id,'currentReferencesDepartment',true,'current',coalesce(ending>greatest((d->>'validFrom')::timestamp,observed),true)));
 END LOOP;RETURN result;END $$;
CREATE FUNCTION care_organization.capability_reference_access(p_actor text,p_ref jsonb,p_permission text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h jsonb;BEGIN h:=care_organization.capability_snapshot(p_actor,(p_ref->>'id')::uuid);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(h->'versions') v WHERE v->>'id'=p_ref->>'versionId') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(h->'versions') v WHERE v->>'id'=p_ref->>'currentVersionId') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM care_organization.capability_authorize(p_actor,(h->'applicability'->'campus'->>'id')::uuid,p_permission);END $$;
CREATE FUNCTION care_organization.capability_campus_dependencies(p_actor text,p_campus uuid,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b record;h jsonb;d jsonb;head jsonb;ending timestamp;active boolean;outstanding boolean;observed timestamp:=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));result jsonb:='[]';BEGIN
 IF p_to IS NOT NULL AND p_to<=p_from THEN RAISE EXCEPTION 'PERIOD_INVALID';END IF;
 FOR b IN SELECT * FROM care_organization.capability WHERE campus_id=p_campus ORDER BY id LOOP
  h:=care_organization.capability_snapshot_at(p_actor,b.id,observed);head:=h->'versions'->(jsonb_array_length(h->'versions')-1);
  SELECT x INTO d FROM jsonb_array_elements(h->'versions') x WHERE x->>'action' IN ('GRANT','REVISE') ORDER BY (x->>'number')::bigint DESC LIMIT 1;IF d IS NULL THEN CONTINUE;END IF;
  SELECT min((x->>'validFrom')::timestamp) INTO ending FROM jsonb_array_elements(h->'versions') x WHERE x->>'action'='END';ending:=least(ending,(d->>'validTo')::timestamp);
  active:=ending IS NULL OR ending>(d->>'validFrom')::timestamp;
  IF active THEN active:=tsrange((d->>'validFrom')::timestamp,ending,'[)')&&tsrange(p_from,p_to,'[)');END IF;
  outstanding:=active AND (p_to IS NULL OR p_to>observed) AND (ending IS NULL OR ending>greatest(p_from,observed));
  result:=result||jsonb_build_array(jsonb_build_object('owner','UNIT_CAPABILITY','id',b.id,'version',head->>'number','active',active,'outstanding',outstanding));
 END LOOP;RETURN result;END $$;
CREATE FUNCTION care_organization.capability_impact_result(p_actor text,p_ref jsonb,p_scope text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h jsonb;v care_organization.capability_version;c care_organization.capability_change;o jsonb;dept uuid;BEGIN
 h:=care_organization.capability_snapshot(p_actor,(p_ref->>'id')::uuid);IF h->>'scope' IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 SELECT * INTO v FROM care_organization.capability_version WHERE capability_id=(p_ref->>'id')::uuid AND id=(p_ref->>'versionId')::uuid;IF NOT FOUND OR v.action NOT IN ('END','GRANT') THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 SELECT * INTO c FROM care_organization.capability_change WHERE id=v.change_id AND candidate_id=(p_ref->>'candidateId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 o:=governance_catalog.department_impact_committed_result(p_actor,c.candidate_id,(p_ref->>'requestId')::uuid);
 IF o->>'status' IS DISTINCT FROM 'COMMITTED' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o->'facts') f WHERE f->>'owner'='care-organization/unit-capability' AND f->>'id'=v.capability_id::text AND f->>'version'=v.number::text) THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 SELECT department_id INTO dept FROM care_organization.unit WHERE id=(h->'applicability'->'unit'->>'id')::uuid;
 RETURN jsonb_build_object('owner','UNIT_CAPABILITY','id',v.capability_id,'versionId',v.id,'departmentIds',jsonb_build_array(dept),'period',jsonb_build_object('from',CASE WHEN v.action='END' THEN h->'versions'->0->>'validFrom' ELSE to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US') END,'to',to_char(CASE WHEN v.action='END' THEN v.valid_from ELSE v.valid_to END,'YYYY-MM-DD"T"HH24:MI:SS.US')),'action',CASE WHEN v.action='GRANT' THEN 'CREATE' ELSE 'END' END,'safeShrink',v.action='END');END $$;
CREATE FUNCTION organization_master.campus_impact_with_capabilities(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_asof timestamp,p_units boolean,p_nursing boolean,p_wards boolean,p_capabilities boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE report jsonb;BEGIN report:=organization_master.campus_impact_with_wards(p_actor,p_id,p_from,p_to,p_asof,p_units,p_nursing,p_wards);
 IF p_capabilities THEN report:=jsonb_set(report,'{dependencies}',(report->'dependencies')||care_organization.capability_campus_dependencies(p_actor,p_id,p_from,p_to,p_asof));report:=jsonb_set(report,'{unavailable}',(report->'unavailable')-'UNIT_CAPABILITY');END IF;RETURN report;END $$;
REVOKE ALL ON FUNCTION care_organization.capability_department_references(text,jsonb,text),care_organization.capability_reference_access(text,jsonb,text),care_organization.capability_campus_dependencies(text,uuid,timestamp,timestamp,timestamp),care_organization.capability_impact_result(text,jsonb,text),organization_master.campus_impact_with_capabilities(text,uuid,timestamp,timestamp,timestamp,boolean,boolean,boolean,boolean) FROM PUBLIC,hdi_prototype;

DO $integration$ DECLARE body text;needle text;f text;BEGIN
 FOREACH f IN ARRAY ARRAY['department_master.impact_reference_access(text,jsonb,text)','department_master.impact_case_authorize(text,jsonb,text,text)','department_master.impact_result(text,jsonb,text)'] LOOP
  body:=replace(pg_get_functiondef(f::regprocedure),E'\r\n',E'\n');
  IF f LIKE '%impact_reference_access%' THEN body:=replace(body,E'BEGIN\n',E'BEGIN\n IF p_ref->>''owner''=''UNIT_CAPABILITY'' THEN PERFORM care_organization.capability_reference_access(p_actor,p_ref,''READ'');RETURN;END IF;\n');
  ELSIF f LIKE '%impact_case_authorize%' THEN body:=replace(body,E'BEGIN\n',E'BEGIN\n IF ref->>''owner''=''UNIT_CAPABILITY'' THEN IF NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=p_actor AND active AND principal_kind=''HUMAN'') THEN RAISE EXCEPTION ''ACCESS_DENIED'';END IF;PERFORM care_organization.capability_reference_access(p_actor,ref,p_permission);RETURN department_master.lifecycle_authorize(p_actor,p_campus,p_permission);END IF;\n');
  ELSE body:=replace(body,E'BEGIN\n',E'BEGIN\n IF p_ref->>''owner''=''UNIT_CAPABILITY'' THEN RETURN care_organization.capability_impact_result(p_actor,p_ref,p_campus);END IF;\n');END IF;EXECUTE body;
 END LOOP;
 body:=pg_get_functiondef('governance_catalog.department_impact_responsibility(text,uuid,uuid,text)'::regprocedure);EXECUTE replace(body,'WHEN ''BUSINESS_UNIT'' THEN ''ORG07''','WHEN ''BUSINESS_UNIT'' THEN ''ORG07'' WHEN ''UNIT_CAPABILITY'' THEN ''ORG16''');
 body:=pg_get_functiondef('organization_master.campus_impact(text,uuid,timestamp,timestamp,timestamp)'::regprocedure);EXECUTE replace(body,'''WARD'',''LOCATION''','''WARD'',''UNIT_CAPABILITY'',''LOCATION''');
 body:=pg_get_functiondef('organization_master.campus_write_approved(text,text)'::regprocedure);
 needle:='organization_master.campus_impact_with_wards(p_actor,s,(p_command->>''validFrom'')::timestamp,NULL,NULL,NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''BUSINESS_UNIT''),NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''NURSING_UNIT''),NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''WARD''))';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAPABILITY_CAMPUS_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'organization_master.campus_impact_with_capabilities(p_actor,s,(p_command->>''validFrom'')::timestamp,NULL,NULL,NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''BUSINESS_UNIT''),NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''NURSING_UNIT''),NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''WARD''),NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''UNIT_CAPABILITY''))');
 EXECUTE replace(body,'''WARD'',''LOCATION''','''WARD'',''UNIT_CAPABILITY'',''LOCATION''');
 body:=pg_get_functiondef('department_master.project_ward_impact_references(text,jsonb,jsonb)'::regprocedure);EXECUTE replace(body,'ref->>''owner''=''WARD''','ref->>''owner'' IN (''WARD'',''UNIT_CAPABILITY'')');
 body:=pg_get_functiondef('department_master.evolution_impact_guard()'::regprocedure);
 IF position('jsonb_array_length(NEW.facts->''impacts'')<>10' IN body)=0 THEN RAISE EXCEPTION 'CAPABILITY_EVOLUTION_BASELINE_MISMATCH';END IF;
 body:=replace(body,'FROM jsonb_array_elements(NEW.facts->''impacts''))<>10','FROM jsonb_array_elements(NEW.facts->''impacts''))<>11');body:=replace(body,'jsonb_array_length(NEW.facts->''impacts'')<>10','jsonb_array_length(NEW.facts->''impacts'')<>11');body:=replace(body,'''IDENTIFIER'',''WARD'']','''IDENTIFIER'',''WARD'',''UNIT_CAPABILITY'']');
 needle:='IF jsonb_array_length(actual)>2000 THEN';body:=replace(body,needle,'IF EXISTS(SELECT 1 FROM jsonb_array_elements(assessment->''coverage'') c WHERE c->>''owner''=''UNIT_CAPABILITY'' AND c->>''status''=''EVALUATED'') THEN actual:=actual||care_organization.capability_department_references(reviewer,departments,NEW.campus);END IF;'||needle);
 EXECUTE replace(body,'IN (''SOURCE_MAPPING'',''IDENTIFIER'',''HIERARCHY'',''WARD'')','IN (''SOURCE_MAPPING'',''IDENTIFIER'',''HIERARCHY'',''WARD'',''UNIT_CAPABILITY'')');
END $integration$;

-- Select the accurate business scope before authorizing visible identities.
CREATE FUNCTION care_organization.capability_scope_histories(p_actor text,p_scope jsonb,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b record;result jsonb:='[]';BEGIN
 PERFORM care_organization.capability_authorize(p_actor,(p_scope->'campus'->>'id')::uuid,'READ');
 FOR b IN SELECT id FROM care_organization.capability WHERE unit_id=(p_scope->'unit'->>'id')::uuid AND campus_id=(p_scope->'campus'->>'id')::uuid AND subject_id=(p_scope->'subject'->>'id')::uuid AND applicability->>'capabilityType'=p_scope->>'capabilityType' AND applicability->>'careSetting'=p_scope->>'careSetting' ORDER BY id LOOP
  result:=result||jsonb_build_array(care_organization.capability_snapshot_at(p_actor,b.id,p_r));
 END LOOP;RETURN result;END $$;
REVOKE ALL ON FUNCTION care_organization.capability_scope_histories(text,jsonb,timestamp) FROM PUBLIC,hdi_prototype;
