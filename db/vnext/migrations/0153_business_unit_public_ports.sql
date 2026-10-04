SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION department_master.unit_binding_coverage(p_actor text,p_department uuid,p_relation uuid,p_version text,p_version_id uuid,p_campus uuid,p_subject uuid,p_services jsonb,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r department_master.campus_relation;v department_master.campus_relation_version;latest department_master.campus_relation_version;admission jsonb;BEGIN
 PERFORM department_master.snapshot(p_actor,p_department);SELECT * INTO r FROM department_master.campus_relation WHERE id=p_relation;IF NOT FOUND THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 PERFORM department_master.lifecycle_relation_snapshot(p_actor,p_relation,r.governance_scope,'READ');
 IF r.department_id<>p_department OR r.campus_id<>p_campus OR r.subject_id<>p_subject THEN RAISE EXCEPTION 'UNIT_ANCHOR_MISMATCH';END IF;
 SELECT * INTO v FROM department_master.campus_relation_version WHERE relation_id=r.id AND id=p_version_id AND number::text=p_version AND recorded_at<=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));IF NOT FOUND THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 SELECT * INTO latest FROM department_master.campus_relation_version WHERE relation_id=r.id AND recorded_at<=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp())) ORDER BY number DESC LIMIT 1;
 IF latest.id<>v.id OR v.action IN ('END','MOVE_SOURCE') OR NOT tsrange(v.valid_from,v.valid_to,'[)') @> tsrange(p_from,p_to,'[)') OR jsonb_typeof(p_services)<>'array' OR jsonb_array_length(p_services)<1 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_services) code WHERE NOT v.services ? code.value) THEN RAISE EXCEPTION 'UNIT_SERVICE_PERIOD_NOT_COVERED';END IF;
 admission:=department_master.lifecycle_admission(p_actor,p_department,p_from,p_to,p_asof);IF admission->>'covered'<>'true' THEN RAISE EXCEPTION 'UNIT_DEPARTMENT_NOT_ADMITTED';END IF;
 RETURN jsonb_build_object('scope',r.governance_scope,'department',admission,'relationId',r.id,'relationVersion',v.number::text,'relationVersionId',v.id,'services',p_services,'from',to_char(p_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(p_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'accepted',v.dependencies);
END $$;
REVOKE ALL ON FUNCTION department_master.unit_binding_coverage(text,uuid,uuid,text,uuid,uuid,uuid,jsonb,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
DO $patch$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('governance_catalog.validation_rules_valid(jsonb,uuid)'::regprocedure);
 needle:=' FOR rule IN SELECT value FROM jsonb_array_elements(definition->''rules'') LOOP';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_RULE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,needle||E'\n IF code=''ORG07'' AND definition->>''templateVersion''=''ORG07_CORE_V1'' AND rule->>''id'' IN (''SRC-COND-012'',''SRC-COND-013'') AND rule->>''status''=''MACHINE'' AND rule->>''version''=''P0_05_SOURCE_V1'' THEN CONTINUE;END IF;\n IF code=''ORG07'' AND definition->>''templateVersion''=''ORG07_CORE_V1'' AND rule->>''id''=''UNIT_APPROVAL_V1'' AND rule->>''field''=''approval_ref'' AND rule->>''version''=''P3_01_V1'' AND rule->>''status''=''MACHINE'' AND rule->>''text''=''Source approval never replaces platform approval.'' THEN CONTINUE;END IF;\n IF code=''ORG07'' AND definition->>''templateVersion''=''ORG07_CORE_V1'' AND rule->>''id''=''UNIT_SOURCE_PLUS08_V1'' AND rule->>''field''=''valid_from'' AND rule->>''version''=''P3_01_TIME_V1'' AND rule->>''status''=''MACHINE'' AND rule->>''text''=''Explicit source +08:00 to Asia/Shanghai local; retain original timestamps.'' THEN CONTINUE;END IF;');EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 IF position('''LOCATION_CORE''' IN body)=0 THEN RAISE EXCEPTION 'UNIT_CONTRACT_BASELINE_MISMATCH';END IF;
 body:=replace(body,'''DEPARTMENT_CORE'',''LOCATION_CORE''','''DEPARTMENT_CORE'',''UNIT_CORE'',''LOCATION_CORE''');
 needle:='FOR entry IN SELECT value FROM jsonb_array_elements(p_definition->''references'') LOOP';
 body:=replace(body,needle,needle||E'\n IF entry->>''status''=''UNIT_CORE'' AND (p_profile<>''CORE'' OR p_definition->>''templateVersion''<>''ORG07_CORE_V1'' OR NOT EXISTS(SELECT 1 FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_dataset_version AND o.code=''ORG07'' AND o.scope=''SYNTHETIC'')) THEN RAISE EXCEPTION ''REFERENCE_INVALID'';END IF;');
 needle:=' IF p_profile=''FULL''';body:=replace(body,needle,'IF p_definition->>''templateVersion''=''ORG07_CORE_V1'' AND (p_profile<>''CORE'' OR jsonb_array_length(p_definition->''fields'')<>19 OR jsonb_array_length(dataset->''fields'')<>19) THEN RAISE EXCEPTION ''FULL_FIELD_OMISSION'';END IF;'||needle);EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.import_job_command(text,jsonb)'::regprocedure);EXECUTE replace(body,'''STRICT_LOCATION_V1''','''STRICT_LOCATION_V1'',''STRICT_UNIT_V1''');
 body:=pg_get_functiondef('governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)'::regprocedure);
 body:=replace(body,'''STRICT_LOCATION_V1'')','''STRICT_LOCATION_V1'',''STRICT_UNIT_V1'')');
 needle:='OR (p.policy=''STRICT_LOCATION_V1'' AND EXISTS(SELECT 1 FROM location_master.input WHERE job_revision=p.revision_id))';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_VALIDATION_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,needle||' OR (p.policy=''STRICT_UNIT_V1'' AND EXISTS(SELECT 1 FROM care_organization.input WHERE job_revision=p.revision_id))');EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.read_validation(text,uuid)'::regprocedure);EXECUTE replace(body,'''STRICT_LOCATION_V1'')','''STRICT_LOCATION_V1'',''STRICT_UNIT_V1'')');
END $patch$;
DO $constraints$ DECLARE tab text;constraint_name text;definition text;BEGIN
 FOREACH tab IN ARRAY ARRAY['import_input_revision','parse_provenance'] LOOP
  constraint_name:=CASE tab WHEN 'import_input_revision' THEN 'import_input_revision_metadata_shape_check' ELSE 'parse_provenance_policy_check' END;
  SELECT pg_get_constraintdef(c.oid) INTO definition FROM pg_constraint c WHERE c.conrelid=('governance_catalog.'||tab)::regclass AND c.conname=constraint_name;
  IF position('''STRICT_LOCATION_V1''::text' IN definition)=0 THEN RAISE EXCEPTION 'UNIT_PARSER_BASELINE_MISMATCH';END IF;
  definition:=replace(definition,'''STRICT_LOCATION_V1''::text','''STRICT_LOCATION_V1''::text,''STRICT_UNIT_V1''::text');EXECUTE format('ALTER TABLE governance_catalog.%I DROP CONSTRAINT %I',tab,constraint_name);EXECUTE format('ALTER TABLE governance_catalog.%I ADD CONSTRAINT %I %s',tab,constraint_name,definition);
 END LOOP;
END $constraints$;
