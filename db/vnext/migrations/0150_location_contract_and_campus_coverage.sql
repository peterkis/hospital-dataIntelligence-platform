SELECT pg_advisory_xact_lock(901002);
-- Organization Owner owns this projection; callers never read its tables.
CREATE FUNCTION organization_master.location_coverage(p_actor text,p_id uuid,p_from timestamp,p_to timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE snapshot jsonb;segments jsonb;spans tsmultirange;retired timestamp;BEGIN
 snapshot:=organization_master.campus_snapshot(p_actor,p_id);
 IF p_to IS NOT NULL AND p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 WITH profiles AS (SELECT e.* FROM organization_master.campus_event e JOIN organization_master.campus_version v ON v.event_id=e.id WHERE e.campus_id=p_id),parts AS (
 SELECT v.id,v.number,v.recorded_at,unnest(tsmultirange(tsrange(v.valid_from,v.valid_to,'[)'))-coalesce((SELECT range_agg(tsrange(later.valid_from,later.valid_to,'[)')) FROM profiles later WHERE later.number>v.number),'{}'::tsmultirange)) span FROM profiles v
 ),clipped AS (SELECT id,number,recorded_at,span * tsrange(p_from,p_to,'[)') span FROM parts WHERE span && tsrange(p_from,p_to,'[)'))
 SELECT coalesce(jsonb_agg(jsonb_build_object('versionId',id,'version',number::text,'from',to_char(lower(span),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',CASE WHEN upper_inf(span) THEN NULL ELSE to_char(upper(span),'YYYY-MM-DD"T"HH24:MI:SS.US') END) ORDER BY lower(span)),'[]'),range_agg(span) INTO segments,spans FROM clipped;
 SELECT min(e.valid_from) INTO retired FROM organization_master.campus_event e JOIN organization_master.campus_operation o ON o.event_id=e.id WHERE e.campus_id=p_id AND o.state='RETIRED';
 RETURN jsonb_build_object('campusId',p_id,'scope',snapshot->>'scope','covered',coalesce(spans @> tsrange(p_from,p_to,'[)'),false),'segments',segments,'retiredAt',CASE WHEN retired IS NULL THEN NULL ELSE to_char(retired,'YYYY-MM-DD"T"HH24:MI:SS.US') END);
END $$;
REVOKE ALL ON FUNCTION organization_master.location_coverage(text,uuid,timestamp,timestamp) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.location_source(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_admission boolean,p_expected_version uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pin uuid;BEGIN
 PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',p_id);
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=p_id AND kind='SOURCE' AND scope='SYNTHETIC') THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.version WHERE id=p_expected_version AND object_id=p_id) THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 IF NOT p_admission THEN RETURN jsonb_build_object('sourceId',p_id);END IF;
 pin:=governance_catalog.source_covering_version(p_id,tsrange(p_from,p_to,'[)'));
 IF pin IS NULL THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;RETURN jsonb_build_object('sourceId',p_id,'versionId',pin);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.location_source(text,uuid,timestamp,timestamp,boolean,uuid) FROM PUBLIC,hdi_prototype;

DO $patch$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('governance_catalog.validation_rules_valid(jsonb,uuid)'::regprocedure);
 needle:='OR (code=''ORG22'' AND definition->>''templateVersion''=''ORG22_CORE_V1''';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'LOCATION_RULE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'OR (code=''ORG12'' AND definition->>''templateVersion''=''ORG12_CORE_V1'' AND rule->>''id'' IN (''SRC-COND-017'',''SRC-COND-018'')) '||needle);
 needle:=' FOR rule IN SELECT value FROM jsonb_array_elements(definition->''rules'') LOOP';
 body:=replace(body,needle,needle||E'\n IF code=''ORG12'' AND definition->>''templateVersion''=''ORG12_CORE_V1'' AND rule->>''id''=''LOCATION_APPROVAL_V1'' AND rule->>''field''=''approval_ref'' AND rule->>''version''=''P3_06_V1'' AND rule->>''status''=''MACHINE'' AND rule->>''text''=''Source approval never replaces platform approval.'' THEN CONTINUE;END IF;');EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.validation_rules_valid(jsonb,uuid)'::regprocedure);
 body:=replace(body,needle,needle||E'\n IF code=''ORG12'' AND definition->>''templateVersion''=''ORG12_CORE_V1'' AND rule->>''id''=''LOCATION_SOURCE_PLUS08_V1'' AND rule->>''field''=''valid_from'' AND rule->>''version''=''P3_06_TIME_V1'' AND rule->>''status''=''MACHINE'' AND rule->>''text''=''Explicit source +08:00 to Asia/Shanghai local; retain original timestamps.'' THEN CONTINUE;END IF;');EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 needle:='''ORGANIZATION_MAPPING_CORE''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'LOCATION_CONTRACT_BASELINE_MISMATCH';END IF;
 -- Only extend the finite allowed status set; add the specific dataset/template guard.
 body:=replace(body,'''DEPARTMENT_CORE'',''ORGANIZATION_MAPPING_CORE''','''DEPARTMENT_CORE'',''LOCATION_CORE'',''ORGANIZATION_MAPPING_CORE''');
 needle:='FOR entry IN SELECT value FROM jsonb_array_elements(p_definition->''references'') LOOP';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'LOCATION_REFERENCE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,needle||E'\n IF entry->>''status''=''LOCATION_CORE'' AND (p_profile<>''CORE'' OR p_definition->>''templateVersion''<>''ORG12_CORE_V1'' OR NOT EXISTS(SELECT 1 FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_dataset_version AND o.code=''ORG12'' AND o.scope=''SYNTHETIC'')) THEN RAISE EXCEPTION ''REFERENCE_INVALID'';END IF;');
 needle:=' IF p_profile=''FULL''';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'LOCATION_FIELDS_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF p_definition->>''templateVersion''=''ORG12_CORE_V1'' AND (p_profile<>''CORE'' OR jsonb_array_length(p_definition->''fields'')<>18 OR jsonb_array_length(dataset->''fields'')<>18) THEN RAISE EXCEPTION ''FULL_FIELD_OMISSION'';END IF;'||needle);EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.import_job_command(text,jsonb)'::regprocedure);EXECUTE replace(body,'''STRICT_ORGANIZATION_IDENTIFIER_V1''','''STRICT_ORGANIZATION_IDENTIFIER_V1'',''STRICT_LOCATION_V1''');
 body:=pg_get_functiondef('governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)'::regprocedure);
 body:=replace(body,'''STRICT_ORGANIZATION_IDENTIFIER_V1'')','''STRICT_ORGANIZATION_IDENTIFIER_V1'',''STRICT_LOCATION_V1'')');
 needle:='OR (p.policy=''STRICT_ORGANIZATION_IDENTIFIER_V1'' AND EXISTS(SELECT 1 FROM department_master.identifier_input WHERE job_revision=p.revision_id))';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'LOCATION_VALIDATION_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,needle||' OR (p.policy=''STRICT_LOCATION_V1'' AND EXISTS(SELECT 1 FROM location_master.input WHERE job_revision=p.revision_id))');EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.read_validation(text,uuid)'::regprocedure);EXECUTE replace(body,'''STRICT_ORGANIZATION_IDENTIFIER_V1'')','''STRICT_ORGANIZATION_IDENTIFIER_V1'',''STRICT_LOCATION_V1'')');
END $patch$;
DO $constraints$ DECLARE tab text;constraint_name text;definition text;BEGIN
 FOREACH tab IN ARRAY ARRAY['import_input_revision','parse_provenance'] LOOP
  constraint_name:=CASE tab WHEN 'import_input_revision' THEN 'import_input_revision_metadata_shape_check' ELSE 'parse_provenance_policy_check' END;
  SELECT pg_get_constraintdef(c.oid) INTO definition FROM pg_constraint c WHERE c.conrelid=('governance_catalog.'||tab)::regclass AND c.conname=constraint_name;
  IF position('''STRICT_ORGANIZATION_IDENTIFIER_V1''::text' IN definition)=0 THEN RAISE EXCEPTION 'LOCATION_PARSER_BASELINE_MISMATCH';END IF;
  definition:=replace(definition,'''STRICT_ORGANIZATION_IDENTIFIER_V1''::text','''STRICT_ORGANIZATION_IDENTIFIER_V1''::text,''STRICT_LOCATION_V1''::text');
  EXECUTE format('ALTER TABLE governance_catalog.%I DROP CONSTRAINT %I',tab,constraint_name);
  EXECUTE format('ALTER TABLE governance_catalog.%I ADD CONSTRAINT %I %s',tab,constraint_name,definition);
 END LOOP;
END $constraints$;
