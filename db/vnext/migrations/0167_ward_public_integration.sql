DO $patch$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('governance_catalog.validation_rules_valid(jsonb,uuid)'::regprocedure);
 needle:=' FOR rule IN SELECT value FROM jsonb_array_elements(definition->''rules'') LOOP';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_RULE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,needle||E'\n IF code=''ORG08'' AND definition->>''templateVersion''=''ORG08_CORE_V1'' AND rule->>''status''=''MACHINE'' AND rule->>''version''=''P0_05_SOURCE_V1'' AND ((rule->>''id''=''SRC-COND-014'' AND rule->>''field''=''managing_unit_id'' AND rule->>''text''=''病区启用时必填；管理归口与可收治科室关联分别维护。'') OR (rule->>''id''=''SRC-COND-015'' AND rule->>''field''=''admission_rule_ref'' AND rule->>''text''=''有专科收治、混合病区、年龄或特殊隔离限制时必填。'')) THEN CONTINUE;END IF;\n IF code=''ORG08'' AND definition->>''templateVersion''=''ORG08_CORE_V1'' AND rule->>''id''=''WARD_APPROVAL_V1'' AND rule->>''field''=''approval_ref'' AND rule->>''version''=''P3_02_V1'' AND rule->>''status''=''MACHINE'' AND rule->>''text''=''Source approval never replaces platform approval.'' THEN CONTINUE;END IF;\n IF code=''ORG08'' AND definition->>''templateVersion''=''ORG08_CORE_V1'' AND rule->>''id''=''WARD_SOURCE_PLUS08_V1'' AND rule->>''field''=''valid_from'' AND rule->>''version''=''P3_02_TIME_V1'' AND rule->>''status''=''MACHINE'' AND rule->>''text''=''Explicit source +08:00 to Asia/Shanghai local; retain original timestamps.'' THEN CONTINUE;END IF;');EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 IF position('''LOCATION_CORE''' IN body)=0 THEN RAISE EXCEPTION 'WARD_CONTRACT_BASELINE_MISMATCH';END IF;
 needle:='''DEPARTMENT_CORE'',''UNIT_CORE'',''NURSING_CORE'',''LOCATION_CORE''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_REFERENCE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'''DEPARTMENT_CORE'',''UNIT_CORE'',''NURSING_CORE'',''WARD_CORE'',''LOCATION_CORE''');
 needle:='FOR entry IN SELECT value FROM jsonb_array_elements(p_definition->''references'') LOOP';
 body:=replace(body,needle,needle||E'\n IF entry->>''status''=''WARD_CORE'' AND (p_profile<>''CORE'' OR p_definition->>''templateVersion''<>''ORG08_CORE_V1'' OR NOT EXISTS(SELECT 1 FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_dataset_version AND o.code=''ORG08'' AND o.scope=''SYNTHETIC'')) THEN RAISE EXCEPTION ''REFERENCE_INVALID'';END IF;');
 needle:=' IF p_profile=''FULL''';body:=replace(body,needle,'IF p_definition->>''templateVersion''=''ORG08_CORE_V1'' AND (p_profile<>''CORE'' OR jsonb_array_length(p_definition->''fields'')<>16 OR jsonb_array_length(dataset->''fields'')<>16) THEN RAISE EXCEPTION ''FULL_FIELD_OMISSION'';END IF;'||needle);EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.import_job_command(text,jsonb)'::regprocedure);EXECUTE replace(body,'''STRICT_LOCATION_V1''','''STRICT_LOCATION_V1'',''STRICT_WARD_V1''');
 body:=pg_get_functiondef('governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)'::regprocedure);
 body:=replace(body,'''STRICT_LOCATION_V1'')','''STRICT_LOCATION_V1'',''STRICT_WARD_V1'')');
 needle:='OR (p.policy=''STRICT_LOCATION_V1'' AND EXISTS(SELECT 1 FROM location_master.input WHERE job_revision=p.revision_id))';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_VALIDATION_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,needle||' OR (p.policy=''STRICT_WARD_V1'' AND EXISTS(SELECT 1 FROM care_organization.ward_input WHERE job_revision=p.revision_id))');EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.read_validation(text,uuid)'::regprocedure);EXECUTE replace(body,'''STRICT_LOCATION_V1'')','''STRICT_LOCATION_V1'',''STRICT_WARD_V1'')');
END $patch$;
DO $constraints$ DECLARE tab text;constraint_name text;definition text;BEGIN
 FOREACH tab IN ARRAY ARRAY['import_input_revision','parse_provenance'] LOOP
  constraint_name:=CASE tab WHEN 'import_input_revision' THEN 'import_input_revision_metadata_shape_check' ELSE 'parse_provenance_policy_check' END;
  SELECT pg_get_constraintdef(c.oid) INTO definition FROM pg_constraint c WHERE c.conrelid=('governance_catalog.'||tab)::regclass AND c.conname=constraint_name;
  IF position('''STRICT_LOCATION_V1''::text' IN definition)=0 THEN RAISE EXCEPTION 'WARD_PARSER_BASELINE_MISMATCH';END IF;
  definition:=replace(definition,'''STRICT_LOCATION_V1''::text','''STRICT_LOCATION_V1''::text,''STRICT_WARD_V1''::text');EXECUTE format('ALTER TABLE governance_catalog.%I DROP CONSTRAINT %I',tab,constraint_name);EXECUTE format('ALTER TABLE governance_catalog.%I ADD CONSTRAINT %I %s',tab,constraint_name,definition);
 END LOOP;
END $constraints$;

CREATE FUNCTION care_organization.ward_department_references(p_actor text,p_departments jsonb,p_scope text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b record;h jsonb;first_v jsonb;latest jsonb;original_binding jsonb;last_binding jsonb;ending timestamp;result jsonb:='[]';BEGIN
 IF p_scope NOT IN ('NORTH','SOUTH') OR jsonb_typeof(p_departments)<>'array' OR jsonb_array_length(p_departments) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR b IN SELECT wb.* FROM care_organization.ward_unit_binding wb JOIN care_organization.unit u ON u.id=wb.managing_unit_id WHERE p_departments ? u.department_id::text ORDER BY wb.id LOOP
  h:=care_organization.ward_snapshot(p_actor,b.unit_id);first_v:=h->'versions'->0;latest:=h->'versions'->(jsonb_array_length(h->'versions')-1);ending:=care_organization.ward_current_end(b.unit_id);
  SELECT x->'versions'->0,x->'versions'->(jsonb_array_length(x->'versions')-1) INTO original_binding,last_binding FROM jsonb_array_elements(h->'bindings') x WHERE x->>'id'=b.id::text;
  result:=result||jsonb_build_array(jsonb_build_object('owner','WARD','id',b.unit_id,'versionId',original_binding->>'id','version',original_binding->>'number','referenceRole','OWNER','sourceSystemIds',jsonb_build_array(first_v->'facts'->'source'->>'sourceSystemId'),'departmentId',(care_organization.snapshot(p_actor,b.managing_unit_id)->>'departmentId')::uuid,'departmentVersionId',NULL,'acceptedVersions',coalesce(original_binding->'dependencies'->'department'->'parts','[]'),'originalPeriod',jsonb_build_object('from',original_binding->>'validFrom','to',original_binding->>'validTo'),'originalDigest',encode(sha256(convert_to(original_binding::text,'UTF8')),'hex'),'frozenLabel',first_v->'facts'->>'wardName','currentVersionId',last_binding->>'id','currentPeriod',jsonb_build_object('from',last_binding->>'validFrom','to',to_char(least((last_binding->>'validTo')::timestamp,ending),'YYYY-MM-DD"T"HH24:MI:SS.US')),'currentAction',latest->>'action','currentTargetId',(care_organization.snapshot(p_actor,b.managing_unit_id)->>'departmentId')::uuid,'currentReferencesDepartment',true,'current',true));
 END LOOP;RETURN result;END $$;
CREATE FUNCTION care_organization.ward_campus_dependencies(p_actor text,p_campus uuid,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b record;h jsonb;v jsonb;stop timestamp;ending timestamp;result jsonb:='[]';outstanding boolean;active boolean;observed timestamp:=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));BEGIN
 FOR b IN SELECT * FROM care_organization.ward_unit_binding WHERE campus_id=p_campus LOOP
  h:=care_organization.ward_snapshot_at(p_actor,b.unit_id,coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp())));
  SELECT x->'versions'->(jsonb_array_length(x->'versions')-1) INTO v FROM jsonb_array_elements(h->'bindings') x WHERE x->>'id'=b.id::text;
  IF v IS NULL THEN CONTINUE;END IF;SELECT min((x->>'validFrom')::timestamp) INTO stop FROM jsonb_array_elements(h->'versions') x WHERE x->>'action'='CLOSE';
  SELECT (x->>'validTo')::timestamp INTO ending FROM jsonb_array_elements(h->'versions') x WHERE x->>'action' IN ('CREATE','REVISE') ORDER BY (x->>'number')::bigint DESC LIMIT 1;
  ending:=least((v->>'validTo')::timestamp,ending,stop);
  active:=ending IS NULL OR ending>(v->>'validFrom')::timestamp;IF active THEN active:=tsrange((v->>'validFrom')::timestamp,ending,'[)')&&tsrange(p_from,p_to,'[)');END IF;outstanding:=active AND (ending IS NULL OR ending>greatest(p_from,observed));
  result:=result||jsonb_build_array(jsonb_build_object('owner','WARD','id',b.unit_id,'version',v->>'number','active',active,'outstanding',outstanding));
 END LOOP;RETURN result;END $$;
CREATE FUNCTION governance_catalog.department_impact_obligation(p_actor text,p_case uuid,p_scope text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c governance_catalog.department_impact_case;BEGIN
 SELECT * INTO c FROM governance_catalog.department_impact_case WHERE id=p_case;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF c.campus IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM department_master.impact_change_snapshot(p_actor,c.event_id,c.campus);
 PERFORM department_master.impact_case_authorize(p_actor,c.obligation,c.campus,'READ');
 RETURN c.obligation;END $$;
REVOKE ALL ON FUNCTION governance_catalog.department_impact_obligation(text,uuid,text) FROM PUBLIC,hdi_prototype;
CREATE FUNCTION care_organization.ward_impact_result(p_actor text,p_ref jsonb,p_scope text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h jsonb;v care_organization.ward_version;c care_organization.ward_change;o jsonb;departments jsonb;frozen jsonb;old_binding jsonb;old_head jsonb;BEGIN
 IF p_scope NOT IN ('NORTH','SOUTH') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;h:=care_organization.ward_snapshot(p_actor,(p_ref->>'id')::uuid);
 SELECT * INTO v FROM care_organization.ward_version WHERE unit_id=(p_ref->>'id')::uuid AND id=(p_ref->>'versionId')::uuid;IF NOT FOUND OR v.number::text IS DISTINCT FROM h->'versions'->(jsonb_array_length(h->'versions')-1)->>'number' THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 SELECT * INTO c FROM care_organization.ward_change WHERE id=v.change_id AND candidate_id=(p_ref->>'candidateId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 o:=governance_catalog.department_impact_committed_result(p_actor,c.candidate_id,(p_ref->>'requestId')::uuid);
 IF o->>'status'<>'COMMITTED' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o->'facts') f WHERE f->>'owner'='care-organization/ward' AND f->>'id'=v.unit_id::text AND f->>'version'=v.number::text) THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 IF v.action='REBIND' THEN
  frozen:=governance_catalog.department_impact_obligation(p_actor,(p_ref->>'caseId')::uuid,p_scope);
  IF frozen->>'kind' IS DISTINCT FROM 'REFERENCE' OR frozen->'reference'->>'owner' IS DISTINCT FROM 'WARD' OR frozen->'reference'->>'id' IS DISTINCT FROM v.unit_id::text THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  SELECT x INTO old_binding FROM jsonb_array_elements(h->'bindings') x WHERE x->'versions'->0->>'id'=frozen->'reference'->>'versionId';
  old_head:=old_binding->'versions'->(jsonb_array_length(old_binding->'versions')-1);
  IF old_head->>'changeId' IS DISTINCT FROM v.change_id::text OR (old_head->>'validTo')::timestamp IS DISTINCT FROM v.valid_from THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  departments:=jsonb_build_array(care_organization.snapshot(p_actor,(old_binding->>'managingUnitId')::uuid)->>'departmentId');
  RETURN jsonb_build_object('owner','WARD','id',v.unit_id,'versionId',v.id,'departmentIds',departments,'period',jsonb_build_object('from',old_binding->'versions'->0->>'validFrom','to',old_head->>'validTo'),'action','END','safeShrink',true);
 END IF;
 SELECT jsonb_agg(DISTINCT care_organization.snapshot(p_actor,(x->>'managingUnitId')::uuid)->>'departmentId') INTO departments FROM jsonb_array_elements(h->'bindings') x WHERE v.action='CLOSE' OR EXISTS(SELECT 1 FROM jsonb_array_elements(x->'versions') bv WHERE bv->>'number'=x->'versions'->(jsonb_array_length(x->'versions')-1)->>'number' AND tsrange((bv->>'validFrom')::timestamp,(bv->>'validTo')::timestamp,'[)') @> tsrange(v.valid_from,v.valid_to,'[)'));
 RETURN jsonb_build_object('owner','WARD','id',v.unit_id,'versionId',v.id,'departmentIds',departments,'period',jsonb_build_object('from',CASE WHEN v.action='CLOSE' THEN h->'versions'->0->>'validFrom' ELSE to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US') END,'to',to_char(CASE WHEN v.action='CLOSE' THEN care_organization.ward_current_end(v.unit_id) ELSE v.valid_to END,'YYYY-MM-DD"T"HH24:MI:SS.US')),'action',CASE WHEN v.action='CLOSE' THEN 'END' ELSE v.action END,'safeShrink',v.action='CLOSE');END $$;
CREATE FUNCTION organization_master.campus_impact_with_wards(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_asof timestamp,p_units boolean,p_nursing boolean,p_wards boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE report jsonb;BEGIN report:=organization_master.campus_impact_with_care(p_actor,p_id,p_from,p_to,p_asof,p_units,p_nursing);
 IF p_wards THEN report:=jsonb_set(report,'{dependencies}',(report->'dependencies')||care_organization.ward_campus_dependencies(p_actor,p_id,p_from,p_to,p_asof));report:=jsonb_set(report,'{unavailable}',(report->'unavailable')-'WARD');END IF;RETURN report;END $$;
REVOKE ALL ON FUNCTION organization_master.campus_impact_with_wards(text,uuid,timestamp,timestamp,timestamp,boolean,boolean,boolean) FROM PUBLIC,hdi_prototype;
DO $integration$ DECLARE body text;needle text;f text;BEGIN
 FOREACH f IN ARRAY ARRAY['department_master.impact_reference_access(text,jsonb,text)','department_master.impact_case_authorize(text,jsonb,text,text)','department_master.impact_result(text,jsonb,text)'] LOOP
  body:=replace(pg_get_functiondef(f::regprocedure),E'\r\n',E'\n');
  IF f LIKE '%impact_reference_access%' THEN body:=replace(body,E'BEGIN\n',E'BEGIN\n IF p_ref->>''owner''=''WARD'' THEN PERFORM care_organization.ward_reference_access(p_actor,p_ref,''READ'');RETURN;END IF;\n');
  ELSIF f LIKE '%impact_case_authorize%' THEN body:=replace(body,E'BEGIN\n',E'BEGIN\n IF ref->>''owner''=''WARD'' THEN IF NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=p_actor AND active AND principal_kind=''HUMAN'') THEN RAISE EXCEPTION ''ACCESS_DENIED'';END IF;PERFORM care_organization.ward_reference_access(p_actor,ref,p_permission);RETURN department_master.lifecycle_authorize(p_actor,p_campus,p_permission);END IF;\n');
  ELSE body:=replace(body,E'BEGIN\n',E'BEGIN\n IF p_ref->>''owner''=''WARD'' THEN RETURN care_organization.ward_impact_result(p_actor,p_ref,p_campus);END IF;\n');END IF;EXECUTE body;
 END LOOP;
 body:=pg_get_functiondef('governance_catalog.department_impact_responsibility(text,uuid,uuid,text)'::regprocedure);EXECUTE replace(body,'WHEN ''BUSINESS_UNIT'' THEN ''ORG07''','WHEN ''BUSINESS_UNIT'' THEN ''ORG07'' WHEN ''WARD'' THEN ''ORG08''');
 body:=pg_get_functiondef('organization_master.campus_impact(text,uuid,timestamp,timestamp,timestamp)'::regprocedure);EXECUTE replace(body,'''BUSINESS_UNIT'',''NURSING_UNIT'',''LOCATION''','''BUSINESS_UNIT'',''NURSING_UNIT'',''WARD'',''LOCATION''');
 body:=pg_get_functiondef('organization_master.campus_write_approved(text,text)'::regprocedure);
 needle:='organization_master.campus_impact_with_care(p_actor,s,(p_command->>''validFrom'')::timestamp,NULL,NULL,NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''BUSINESS_UNIT''),NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''NURSING_UNIT''))';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_CAMPUS_SQL_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'organization_master.campus_impact_with_wards(p_actor,s,(p_command->>''validFrom'')::timestamp,NULL,NULL,NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''BUSINESS_UNIT''),NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''NURSING_UNIT''),NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''WARD''))');
 EXECUTE replace(body,'''BUSINESS_UNIT'',''NURSING_UNIT'',''LOCATION''','''BUSINESS_UNIT'',''NURSING_UNIT'',''WARD'',''LOCATION''');
END $integration$;
REVOKE ALL ON FUNCTION care_organization.ward_department_references(text,jsonb,text),care_organization.ward_campus_dependencies(text,uuid,timestamp,timestamp,timestamp),care_organization.ward_impact_result(text,jsonb,text) FROM PUBLIC,hdi_prototype;

SELECT pg_advisory_xact_lock(901002);

-- New evolution approvals require Ward coverage. Already committed nine-domain
-- events are immutable and never pass through this insert trigger again.
DO $evolution$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('department_master.evolution_impact_guard()'::regprocedure);
 needle:='jsonb_array_length(NEW.facts->''impacts'')<>9';
 IF position(needle IN body)=0 OR position('actual:=department_master.impact_references(reviewer,departments,NEW.campus);' IN body)=0 THEN RAISE EXCEPTION 'WARD_EVOLUTION_BASELINE_MISMATCH';END IF;
 body:=replace(body,'FROM jsonb_array_elements(NEW.facts->''impacts''))<>9','FROM jsonb_array_elements(NEW.facts->''impacts''))<>10');
 body:=replace(body,needle,'jsonb_array_length(NEW.facts->''impacts'')<>10');
 body:=replace(body,'''CONSUMER'',''IDENTIFIER'']','''CONSUMER'',''IDENTIFIER'',''WARD'']');
 body:=replace(body,'actual:=department_master.impact_references(reviewer,departments,NEW.campus);',$actual$actual:=department_master.impact_references(reviewer,departments,NEW.campus);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(assessment->'coverage') c WHERE c->>'owner'='BUSINESS_UNIT' AND c->>'status'='EVALUATED') THEN actual:=actual||care_organization.department_references(reviewer,departments,NEW.campus);END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(assessment->'coverage') c WHERE c->>'owner'='NURSING_UNIT' AND c->>'status'='EVALUATED') THEN actual:=actual||care_organization.nursing_department_references(reviewer,departments,NEW.campus);END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(assessment->'coverage') c WHERE c->>'owner'='WARD' AND c->>'status'='EVALUATED') THEN actual:=actual||care_organization.ward_department_references(reviewer,departments,NEW.campus);END IF;
 IF jsonb_array_length(actual)>2000 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;$actual$);
 body:=replace(body,'IN (''SOURCE_MAPPING'',''IDENTIFIER'',''HIERARCHY'')','IN (''SOURCE_MAPPING'',''IDENTIFIER'',''HIERARCHY'',''WARD'')');
 EXECUTE body;
END $evolution$;

-- A suspension can precede an already recorded future binding. Retain its
-- accepted evidence, but expose an empty historical current interval rather
-- than a reversed range. Unbounded active bindings keep an unbounded end.
DO $repair$
DECLARE body text;period text;current_flag text;
BEGIN
 body:=pg_get_functiondef('care_organization.ward_department_references(text,jsonb,text)'::regprocedure);
 period:='to_char(least((last_binding->>''validTo'')::timestamp,ending),''YYYY-MM-DD"T"HH24:MI:SS.US'')';
 current_flag:='''current'',true';
 IF position(period IN body)=0 OR position(current_flag IN body)=0 THEN RAISE EXCEPTION 'WARD_MASKED_IMPACT_PREDECESSOR_MISMATCH';END IF;
 body:=replace(body,period,'to_char(CASE WHEN least((last_binding->>''validTo'')::timestamp,ending) IS NULL THEN NULL ELSE greatest((last_binding->>''validFrom'')::timestamp,least((last_binding->>''validTo'')::timestamp,ending)) END,''YYYY-MM-DD"T"HH24:MI:SS.US'')');
 body:=replace(body,current_flag,'''current'',coalesce(least((last_binding->>''validTo'')::timestamp,ending)>(last_binding->>''validFrom'')::timestamp,true)');
 EXECUTE body;
END $repair$;

SELECT pg_advisory_xact_lock(901002);

-- Historical overlap remains visible after a finite assessment window ends.
-- Outstanding obligations are restricted to its remaining future interval.
DO $repair$
DECLARE body text;obligation text;observation text;
BEGIN
 body:=pg_get_functiondef('care_organization.ward_campus_dependencies(text,uuid,timestamp,timestamp,timestamp)'::regprocedure);
 obligation:='outstanding:=active AND (ending IS NULL OR ending>greatest(p_from,observed));';
 observation:='care_organization.ward_snapshot_at(p_actor,b.unit_id,coalesce(p_asof,timezone(''Asia/Shanghai'',clock_timestamp())))';
 IF position(obligation IN body)=0 OR position(observation IN body)=0 THEN RAISE EXCEPTION 'WARD_FINITE_IMPACT_PREDECESSOR_MISMATCH';END IF;
 body:=replace(body,obligation,'outstanding:=active AND (p_to IS NULL OR p_to>observed) AND (ending IS NULL OR ending>greatest(p_from,observed));');
 body:=replace(body,observation,'care_organization.ward_snapshot_at(p_actor,b.unit_id,observed)');
 EXECUTE body;
END $repair$;
