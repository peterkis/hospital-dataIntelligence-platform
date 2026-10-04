DO $patch$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('governance_catalog.validation_rules_valid(jsonb,uuid)'::regprocedure);
 needle:=' FOR rule IN SELECT value FROM jsonb_array_elements(definition->''rules'') LOOP';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'NURSING_RULE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,needle||E'\n IF code=''ORG09'' AND definition->>''templateVersion''=''ORG09_CORE_V1'' AND rule->>''id'' IN (''SRC-COND-012'',''SRC-COND-013'') AND rule->>''status''=''MACHINE'' AND rule->>''version''=''P0_05_SOURCE_V1'' THEN CONTINUE;END IF;\n IF code=''ORG09'' AND definition->>''templateVersion''=''ORG09_CORE_V1'' AND rule->>''id''=''NURSING_APPROVAL_V1'' AND rule->>''field''=''approval_ref'' AND rule->>''version''=''P3_03_V1'' AND rule->>''status''=''MACHINE'' AND rule->>''text''=''Source approval never replaces platform approval.'' THEN CONTINUE;END IF;\n IF code=''ORG09'' AND definition->>''templateVersion''=''ORG09_CORE_V1'' AND rule->>''id''=''NURSING_SOURCE_PLUS08_V1'' AND rule->>''field''=''valid_from'' AND rule->>''version''=''P3_03_TIME_V1'' AND rule->>''status''=''MACHINE'' AND rule->>''text''=''Explicit source +08:00 to Asia/Shanghai local; retain original timestamps.'' THEN CONTINUE;END IF;');EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 IF position('''LOCATION_CORE''' IN body)=0 THEN RAISE EXCEPTION 'NURSING_CONTRACT_BASELINE_MISMATCH';END IF;
 needle:='''DEPARTMENT_CORE'',''UNIT_CORE'',''LOCATION_CORE''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'NURSING_REFERENCE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'''DEPARTMENT_CORE'',''UNIT_CORE'',''NURSING_CORE'',''LOCATION_CORE''');
 needle:='FOR entry IN SELECT value FROM jsonb_array_elements(p_definition->''references'') LOOP';
 body:=replace(body,needle,needle||E'\n IF entry->>''status''=''NURSING_CORE'' AND (p_profile<>''CORE'' OR p_definition->>''templateVersion''<>''ORG09_CORE_V1'' OR NOT EXISTS(SELECT 1 FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_dataset_version AND o.code=''ORG09'' AND o.scope=''SYNTHETIC'')) THEN RAISE EXCEPTION ''REFERENCE_INVALID'';END IF;');
 needle:=' IF p_profile=''FULL''';body:=replace(body,needle,'IF p_definition->>''templateVersion''=''ORG09_CORE_V1'' AND (p_profile<>''CORE'' OR jsonb_array_length(p_definition->''fields'')<>15 OR jsonb_array_length(dataset->''fields'')<>15) THEN RAISE EXCEPTION ''FULL_FIELD_OMISSION'';END IF;'||needle);EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.import_job_command(text,jsonb)'::regprocedure);EXECUTE replace(body,'''STRICT_LOCATION_V1''','''STRICT_LOCATION_V1'',''STRICT_NURSING_V1''');
 body:=pg_get_functiondef('governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)'::regprocedure);
 body:=replace(body,'''STRICT_LOCATION_V1'')','''STRICT_LOCATION_V1'',''STRICT_NURSING_V1'')');
 needle:='OR (p.policy=''STRICT_LOCATION_V1'' AND EXISTS(SELECT 1 FROM location_master.input WHERE job_revision=p.revision_id))';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'NURSING_VALIDATION_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,needle||' OR (p.policy=''STRICT_NURSING_V1'' AND EXISTS(SELECT 1 FROM care_organization.nursing_input WHERE job_revision=p.revision_id))');EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.read_validation(text,uuid)'::regprocedure);EXECUTE replace(body,'''STRICT_LOCATION_V1'')','''STRICT_LOCATION_V1'',''STRICT_NURSING_V1'')');
END $patch$;
DO $constraints$ DECLARE tab text;constraint_name text;definition text;BEGIN
 FOREACH tab IN ARRAY ARRAY['import_input_revision','parse_provenance'] LOOP
  constraint_name:=CASE tab WHEN 'import_input_revision' THEN 'import_input_revision_metadata_shape_check' ELSE 'parse_provenance_policy_check' END;
  SELECT pg_get_constraintdef(c.oid) INTO definition FROM pg_constraint c WHERE c.conrelid=('governance_catalog.'||tab)::regclass AND c.conname=constraint_name;
  IF position('''STRICT_LOCATION_V1''::text' IN definition)=0 THEN RAISE EXCEPTION 'NURSING_PARSER_BASELINE_MISMATCH';END IF;
  definition:=replace(definition,'''STRICT_LOCATION_V1''::text','''STRICT_LOCATION_V1''::text,''STRICT_NURSING_V1''::text');EXECUTE format('ALTER TABLE governance_catalog.%I DROP CONSTRAINT %I',tab,constraint_name);EXECUTE format('ALTER TABLE governance_catalog.%I ADD CONSTRAINT %I %s',tab,constraint_name,definition);
 END LOOP;
END $constraints$;

CREATE FUNCTION care_organization.nursing_department_references(p_actor text,p_departments jsonb,p_scope text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b record;h jsonb;first_v jsonb;latest jsonb;original_binding jsonb;last_binding jsonb;ending timestamp;result jsonb:='[]';BEGIN
 IF p_scope NOT IN ('NORTH','SOUTH') OR jsonb_typeof(p_departments)<>'array' OR jsonb_array_length(p_departments) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR b IN SELECT * FROM care_organization.nursing_unit_binding WHERE p_departments ? managing_department_id::text ORDER BY id LOOP
  h:=care_organization.nursing_snapshot(p_actor,b.unit_id);first_v:=h->'versions'->0;latest:=h->'versions'->(jsonb_array_length(h->'versions')-1);ending:=care_organization.nursing_current_end(b.unit_id);
  SELECT x->'versions'->0,x->'versions'->(jsonb_array_length(x->'versions')-1) INTO original_binding,last_binding FROM jsonb_array_elements(h->'bindings') x WHERE x->>'id'=b.id::text;
  result:=result||jsonb_build_array(jsonb_build_object('owner','NURSING_UNIT','id',b.unit_id,'versionId',original_binding->>'id','version',original_binding->>'number','referenceRole','OWNER','sourceSystemIds',jsonb_build_array(first_v->'facts'->'source'->>'sourceSystemId'),'departmentId',b.managing_department_id,'departmentVersionId',NULL,'acceptedVersions',coalesce(original_binding->'dependencies'->'department'->'parts','[]'),'originalPeriod',jsonb_build_object('from',original_binding->>'validFrom','to',original_binding->>'validTo'),'originalDigest',encode(sha256(convert_to(original_binding::text,'UTF8')),'hex'),'frozenLabel',first_v->'facts'->>'nursingName','currentVersionId',last_binding->>'id','currentPeriod',jsonb_build_object('from',last_binding->>'validFrom','to',to_char(least((last_binding->>'validTo')::timestamp,ending),'YYYY-MM-DD"T"HH24:MI:SS.US')),'currentAction',latest->>'action','currentTargetId',b.managing_department_id,'currentReferencesDepartment',true,'current',true));
 END LOOP;RETURN result;END $$;
CREATE FUNCTION care_organization.nursing_campus_dependencies(p_actor text,p_campus uuid,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b record;h jsonb;v jsonb;stop timestamp;ending timestamp;result jsonb:='[]';outstanding boolean;active boolean;observed timestamp:=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));BEGIN
 FOR b IN SELECT * FROM care_organization.nursing_unit_binding WHERE campus_id=p_campus LOOP
  h:=care_organization.nursing_snapshot_at(p_actor,b.unit_id,coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp())));
  SELECT x->'versions'->(jsonb_array_length(x->'versions')-1) INTO v FROM jsonb_array_elements(h->'bindings') x WHERE x->>'id'=b.id::text;
  IF v IS NULL THEN CONTINUE;END IF;SELECT min((x->>'validFrom')::timestamp) INTO stop FROM jsonb_array_elements(h->'versions') x WHERE x->>'action'='SUSPEND';ending:=least((v->>'validTo')::timestamp,stop);
  active:=ending IS NULL OR ending>(v->>'validFrom')::timestamp;IF active THEN active:=tsrange((v->>'validFrom')::timestamp,ending,'[)')&&tsrange(p_from,p_to,'[)');END IF;outstanding:=active AND (ending IS NULL OR ending>greatest(p_from,observed));
  result:=result||jsonb_build_array(jsonb_build_object('owner','NURSING_UNIT','id',b.unit_id,'version',v->>'number','active',active,'outstanding',outstanding));
 END LOOP;RETURN result;END $$;
CREATE FUNCTION care_organization.nursing_impact_result(p_actor text,p_ref jsonb,p_scope text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h jsonb;v care_organization.nursing_version;c care_organization.nursing_change;o jsonb;departments jsonb;BEGIN
 IF p_scope NOT IN ('NORTH','SOUTH') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;h:=care_organization.nursing_snapshot(p_actor,(p_ref->>'id')::uuid);
 SELECT * INTO v FROM care_organization.nursing_version WHERE unit_id=(p_ref->>'id')::uuid AND id=(p_ref->>'versionId')::uuid;IF NOT FOUND OR v.number::text IS DISTINCT FROM h->'versions'->(jsonb_array_length(h->'versions')-1)->>'number' THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 SELECT * INTO c FROM care_organization.nursing_change WHERE id=v.change_id AND candidate_id=(p_ref->>'candidateId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 o:=governance_catalog.department_impact_committed_result(p_actor,c.candidate_id,(p_ref->>'requestId')::uuid);
 IF o->>'status'<>'COMMITTED' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o->'facts') f WHERE f->>'owner'='care-organization/nursing' AND f->>'id'=v.unit_id::text AND f->>'version'=v.number::text) THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 SELECT jsonb_agg(DISTINCT x->>'managingDepartmentId') INTO departments FROM jsonb_array_elements(h->'bindings') x WHERE v.action='SUSPEND' OR EXISTS(SELECT 1 FROM jsonb_array_elements(x->'versions') bv WHERE bv->>'number'=x->'versions'->(jsonb_array_length(x->'versions')-1)->>'number' AND tsrange((bv->>'validFrom')::timestamp,(bv->>'validTo')::timestamp,'[)') @> tsrange(v.valid_from,v.valid_to,'[)'));
 RETURN jsonb_build_object('owner','NURSING_UNIT','id',v.unit_id,'versionId',v.id,'departmentIds',departments,'period',jsonb_build_object('from',CASE WHEN v.action='SUSPEND' THEN h->'versions'->0->>'validFrom' ELSE to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US') END,'to',to_char(CASE WHEN v.action='SUSPEND' THEN care_organization.nursing_current_end(v.unit_id) ELSE v.valid_to END,'YYYY-MM-DD"T"HH24:MI:SS.US')),'action',CASE WHEN v.action='SUSPEND' THEN 'END' ELSE v.action END,'safeShrink',v.action='SUSPEND');END $$;
CREATE FUNCTION organization_master.campus_impact_with_care(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_asof timestamp,p_units boolean,p_nursing boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE report jsonb;BEGIN report:=organization_master.campus_impact(p_actor,p_id,p_from,p_to,p_asof);
 IF p_units THEN report:=jsonb_set(report,'{dependencies}',(report->'dependencies')||care_organization.campus_dependencies(p_actor,p_id,p_from,p_to,p_asof));report:=jsonb_set(report,'{unavailable}',(report->'unavailable')-'BUSINESS_UNIT');END IF;
 IF p_nursing THEN report:=jsonb_set(report,'{dependencies}',(report->'dependencies')||care_organization.nursing_campus_dependencies(p_actor,p_id,p_from,p_to,p_asof));report:=jsonb_set(report,'{unavailable}',(report->'unavailable')-'NURSING_UNIT');END IF;
 RETURN report;END $$;
REVOKE ALL ON FUNCTION organization_master.campus_impact_with_care(text,uuid,timestamp,timestamp,timestamp,boolean,boolean) FROM PUBLIC,hdi_prototype;
DO $integration$ DECLARE body text;needle text;f text;BEGIN
 FOREACH f IN ARRAY ARRAY['department_master.impact_reference_access(text,jsonb,text)','department_master.impact_case_authorize(text,jsonb,text,text)','department_master.impact_result(text,jsonb,text)'] LOOP
  body:=replace(pg_get_functiondef(f::regprocedure),E'\r\n',E'\n');
  IF f LIKE '%impact_reference_access%' THEN body:=replace(body,E'BEGIN\n',E'BEGIN\n IF p_ref->>''owner''=''NURSING_UNIT'' THEN PERFORM care_organization.nursing_reference_access(p_actor,p_ref,''READ'');RETURN;END IF;\n');
  ELSIF f LIKE '%impact_case_authorize%' THEN body:=replace(body,E'BEGIN\n',E'BEGIN\n IF ref->>''owner''=''NURSING_UNIT'' THEN IF NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=p_actor AND active AND principal_kind=''HUMAN'') THEN RAISE EXCEPTION ''ACCESS_DENIED'';END IF;PERFORM care_organization.nursing_reference_access(p_actor,ref,p_permission);RETURN department_master.lifecycle_authorize(p_actor,p_campus,p_permission);END IF;\n');
  ELSE body:=replace(body,E'BEGIN\n',E'BEGIN\n IF p_ref->>''owner''=''NURSING_UNIT'' THEN RETURN care_organization.nursing_impact_result(p_actor,p_ref,p_campus);END IF;\n');END IF;EXECUTE body;
 END LOOP;
 body:=pg_get_functiondef('governance_catalog.department_impact_responsibility(text,uuid,uuid,text)'::regprocedure);EXECUTE replace(body,'WHEN ''BUSINESS_UNIT'' THEN ''ORG07''','WHEN ''BUSINESS_UNIT'' THEN ''ORG07'' WHEN ''NURSING_UNIT'' THEN ''ORG09''');
 body:=pg_get_functiondef('organization_master.campus_impact(text,uuid,timestamp,timestamp,timestamp)'::regprocedure);EXECUTE replace(body,'''BUSINESS_UNIT'',''LOCATION''','''BUSINESS_UNIT'',''NURSING_UNIT'',''LOCATION''');
 body:=pg_get_functiondef('organization_master.campus_write_approved(text,text)'::regprocedure);
 needle:='(CASE WHEN ticket->''lifecycle''->''report''->''unavailable'' ? ''BUSINESS_UNIT'' THEN organization_master.campus_impact(p_actor,s,(p_command->>''validFrom'')::timestamp,NULL,NULL) ELSE organization_master.campus_impact_with_units(p_actor,s,(p_command->>''validFrom'')::timestamp,NULL,NULL) END)';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'NURSING_CAMPUS_SQL_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'organization_master.campus_impact_with_care(p_actor,s,(p_command->>''validFrom'')::timestamp,NULL,NULL,NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''BUSINESS_UNIT''),NOT(ticket->''lifecycle''->''report''->''unavailable'' ? ''NURSING_UNIT''))');
 EXECUTE replace(body,'''BUSINESS_UNIT'',''LOCATION''','''BUSINESS_UNIT'',''NURSING_UNIT'',''LOCATION''');
END $integration$;
REVOKE ALL ON FUNCTION care_organization.nursing_department_references(text,jsonb,text),care_organization.nursing_campus_dependencies(text,uuid,timestamp,timestamp,timestamp),care_organization.nursing_impact_result(text,jsonb,text) FROM PUBLIC,hdi_prototype;
