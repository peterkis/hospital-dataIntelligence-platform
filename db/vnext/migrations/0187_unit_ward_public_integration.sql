DO $patch$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('governance_catalog.validation_rules_valid(jsonb,uuid)'::regprocedure);
 body:=replace(body,' FOR rule IN SELECT value FROM jsonb_array_elements(definition->''rules'') LOOP',' FOR rule IN SELECT value FROM jsonb_array_elements(definition->''rules'') LOOP'||E'\n IF code=''ORG10'' AND definition->>''templateVersion''=''ORG10_CORE_V1'' AND rule->>''id''=''SRC-COND-016'' AND rule->>''field''=''sharing_rule'' AND rule->>''version''=''P0_05_SOURCE_V1'' AND rule->>''text''=''同病区被多个科室使用或存在跨院区转入边界时必填。'' AND rule->>''status''=''MACHINE'' THEN CONTINUE;END IF;');
 needle:=' FOR rule IN SELECT value FROM jsonb_array_elements(definition->''rules'') LOOP';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_WARD_RULE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,needle||E'\n IF code=''ORG10'' AND definition->>''templateVersion''=''ORG10_CORE_V1'' AND rule->>''status''=''MACHINE'' AND ((rule->>''id''=''UNIT_WARD_EMPTY_END_V1'' AND rule->>''field''=''valid_to'' AND rule->>''version''=''P3_04_EMPTY_END_V1'' AND rule->>''text''=''CSV/XLSX blank valid_to is an explicit open end; JSON requires native null.'') OR (rule->>''id''=''UNIT_WARD_APPROVAL_V1'' AND rule->>''field''=''approval_ref'' AND rule->>''version''=''P3_04_V1'' AND rule->>''text''=''Source approval never replaces platform approval.'')) THEN CONTINUE;END IF;');EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 needle:='''WARD_CORE''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_WARD_CONTRACT_BASELINE_MISMATCH';END IF;
 body:=replace(body,'''SUBJECT_CORE'',''LOCATION_CORE''','''SUBJECT_CORE'',''UNIT_WARD_CORE'',''LOCATION_CORE''');
 needle:='FOR entry IN SELECT value FROM jsonb_array_elements(p_definition->''references'') LOOP';
 body:=replace(body,needle,needle||E'\n IF entry->>''status''=''UNIT_WARD_CORE'' AND (p_profile<>''CORE'' OR p_definition->>''templateVersion''<>''ORG10_CORE_V1'' OR NOT EXISTS(SELECT 1 FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_dataset_version AND o.code=''ORG10'' AND o.scope=''SYNTHETIC'')) THEN RAISE EXCEPTION ''REFERENCE_INVALID'';END IF;');
 needle:=' IF p_profile=''FULL''';body:=replace(body,needle,'IF p_definition->>''templateVersion''=''ORG10_CORE_V1'' AND (p_profile<>''CORE'' OR jsonb_array_length(p_definition->''fields'')<>14 OR jsonb_array_length(dataset->''fields'')<>14) THEN RAISE EXCEPTION ''FULL_FIELD_OMISSION'';END IF;'||needle);EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.import_job_command(text,jsonb)'::regprocedure);EXECUTE replace(body,'''STRICT_LOCATION_V1''','''STRICT_LOCATION_V1'',''STRICT_UNIT_WARD_V1''');
 body:=pg_get_functiondef('governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)'::regprocedure);
 body:=replace(body,'''STRICT_LOCATION_V1'')','''STRICT_LOCATION_V1'',''STRICT_UNIT_WARD_V1'')');
 needle:='OR (p.policy=''STRICT_LOCATION_V1'' AND EXISTS(SELECT 1 FROM location_master.input WHERE job_revision=p.revision_id))';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_WARD_VALIDATION_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,needle||' OR (p.policy=''STRICT_UNIT_WARD_V1'' AND EXISTS(SELECT 1 FROM care_organization.unit_ward_input WHERE job_revision=p.revision_id))');EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.read_validation(text,uuid)'::regprocedure);EXECUTE replace(body,'''STRICT_LOCATION_V1'')','''STRICT_LOCATION_V1'',''STRICT_UNIT_WARD_V1'')');
END $patch$;
DO $constraints$ DECLARE tab text;constraint_name text;definition text;BEGIN
 FOREACH tab IN ARRAY ARRAY['import_input_revision','parse_provenance'] LOOP
  constraint_name:=CASE tab WHEN 'import_input_revision' THEN 'import_input_revision_metadata_shape_check' ELSE 'parse_provenance_policy_check' END;
  SELECT pg_get_constraintdef(c.oid) INTO definition FROM pg_constraint c WHERE c.conrelid=('governance_catalog.'||tab)::regclass AND c.conname=constraint_name;
  IF position('''STRICT_LOCATION_V1''::text' IN definition)=0 THEN RAISE EXCEPTION 'UNIT_WARD_PARSER_BASELINE_MISMATCH';END IF;
  definition:=replace(definition,'''STRICT_LOCATION_V1''::text','''STRICT_LOCATION_V1''::text,''STRICT_UNIT_WARD_V1''::text');EXECUTE format('ALTER TABLE governance_catalog.%I DROP CONSTRAINT %I',tab,constraint_name);EXECUTE format('ALTER TABLE governance_catalog.%I ADD CONSTRAINT %I %s',tab,constraint_name,definition);
 END LOOP;
END $constraints$;

