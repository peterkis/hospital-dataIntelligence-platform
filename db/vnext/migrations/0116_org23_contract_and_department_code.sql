SELECT pg_advisory_xact_lock(901002);
DO $contract$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('governance_catalog.validation_rules_valid(jsonb,uuid)'::regprocedure);
 needle:=' FOR rule IN SELECT value FROM jsonb_array_elements(definition->''rules'') LOOP';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ORG_IDENTIFIER_RULE_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,needle||$rule$
  IF code='ORG23' AND definition->>'templateVersion'='ORG23_CORE_V1' AND rule->>'id'='ORG_IDENTIFIER_APPROVAL_V1' AND rule->>'field'='approval_ref' AND rule->>'version'='P2_04_V1' AND rule->>'status'='MACHINE' AND rule->>'text'='Source approval never replaces platform approval.' THEN CONTINUE;END IF;
$rule$);
 body:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 needle:='''ORGANIZATION_MAPPING_CORE'')';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ORG_IDENTIFIER_REFERENCE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'''ORGANIZATION_MAPPING_CORE'',''ORGANIZATION_IDENTIFIER_CORE'')');
 needle:='  IF entry->>''status''=''DECLARED_PARAMETER'' THEN';
 body:=replace(body,needle,$guard$
  IF entry->>'status'='ORGANIZATION_IDENTIFIER_CORE' AND (p_profile<>'CORE' OR p_definition->>'templateVersion'<>'ORG23_CORE_V1' OR NOT EXISTS(SELECT 1 FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_dataset_version AND o.code='ORG23' AND o.scope='SYNTHETIC')) THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
$guard$||needle);
 needle:=' IF p_profile=''FULL''';
 EXECUTE replace(body,needle,$fields$
 IF p_definition->>'templateVersion'='ORG23_CORE_V1' AND (p_profile<>'CORE' OR jsonb_array_length(p_definition->'fields')<>16 OR NOT EXISTS(SELECT 1 FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_dataset_version AND o.code='ORG23')) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
$fields$||needle);
END $contract$;
DO $parser$ DECLARE body text;signature text;BEGIN
 FOREACH signature IN ARRAY ARRAY['governance_catalog.import_job_command(text,jsonb)','governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)','governance_catalog.read_validation(text,uuid)'] LOOP
  body:=pg_get_functiondef(signature::regprocedure);
  IF position('''STRICT_ORGANIZATION_MAPPING_V1''' IN body)=0 THEN RAISE EXCEPTION 'ORG_IDENTIFIER_PARSER_BASELINE_MISMATCH';END IF;
  -- Extend finite IN lists; equality tests stay bound to the original Owner.
  body:=replace(body,'''STRICT_ORGANIZATION_MAPPING_V1'')','''STRICT_ORGANIZATION_MAPPING_V1'',''STRICT_ORGANIZATION_IDENTIFIER_V1'')');
  IF signature LIKE '%accept_validation%' THEN
   body:=replace(body,'OR (p.policy=''STRICT_ORGANIZATION_MAPPING_V1'' AND EXISTS(SELECT 1 FROM department_master.mapping_input WHERE job_revision=p.revision_id))','OR (p.policy=''STRICT_ORGANIZATION_MAPPING_V1'' AND EXISTS(SELECT 1 FROM department_master.mapping_input WHERE job_revision=p.revision_id)) OR (p.policy=''STRICT_ORGANIZATION_IDENTIFIER_V1'' AND EXISTS(SELECT 1 FROM department_master.identifier_input WHERE job_revision=p.revision_id))');
  END IF;EXECUTE body;
 END LOOP;
END $parser$;
ALTER TABLE governance_catalog.import_input_revision DROP CONSTRAINT import_input_revision_metadata_shape_check;
ALTER TABLE governance_catalog.import_input_revision ADD CONSTRAINT import_input_revision_metadata_shape_check CHECK(
 ((metadata->>'kind'='FILE' AND metadata->>'format' IN ('CSV','JSON','XLSX') AND metadata->>'parserPolicy' IN ('STRICT_V1','STRICT_V2','STRICT_DEPARTMENT_V1','STRICT_ORGANIZATION_MAPPING_V1','STRICT_ORGANIZATION_IDENTIFIER_V1') AND metadata-ARRAY['kind','format','parserPolicy']='{}'::jsonb)
 OR (metadata->>'kind'='FILE' AND metadata->>'format'='XLSX' AND metadata->>'parserPolicy'='STRICT_ORG_BUNDLE_V1' AND metadata->>'manifestDigest' ~ '^[a-f0-9]{64}$' AND metadata->>'contractsDigest' ~ '^[a-f0-9]{64}$' AND metadata-ARRAY['kind','format','parserPolicy','manifestDigest','contractsDigest']='{}'::jsonb)
 OR (metadata->>'kind'='METADATA_ONLY' AND metadata->>'declaredSha256' ~ '^[a-f0-9]{64}$' AND metadata-ARRAY['kind','declaredSha256']='{}'::jsonb)) IS TRUE);
ALTER TABLE governance_catalog.parse_provenance DROP CONSTRAINT parse_provenance_policy_check;
ALTER TABLE governance_catalog.parse_provenance ADD CONSTRAINT parse_provenance_policy_check CHECK(policy IN ('STRICT_V1','STRICT_V2','STRICT_ORG_BUNDLE_V1','STRICT_DEPARTMENT_V1','STRICT_ORGANIZATION_MAPPING_V1','STRICT_ORGANIZATION_IDENTIFIER_V1'));
DO $code$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('department_master.mutate(text,text)'::regprocedure);
 needle:='IF prior IS DISTINCT FROM command->''row''->>''org_code'' THEN RAISE EXCEPTION ''BLOCKED_DEPENDENCY'';END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'DEPARTMENT_CODE_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'IF NOT EXISTS(SELECT 1 FROM department_master.organization_identifier WHERE kind=''HOSPITAL_CODE'' AND target_id=target AND reserved_value=command->''row''->>''org_code'') THEN RAISE EXCEPTION ''BLOCKED_DEPENDENCY'';END IF;');
END $code$;
CREATE OR REPLACE FUNCTION department_master.committed_row(p_actor text,p_job_id uuid,p_source_row integer,p_intent text,p_target_id uuid,p_expected_version bigint,p_org_code text,p_valid_from timestamp,p_valid_to timestamp,p_facts jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');
 IF p_source_row NOT BETWEEN 1 AND 1048576 OR p_intent NOT IN ('CREATE','REVISE') OR p_intent='CREATE' AND p_target_id IS NOT NULL OR p_intent='REVISE' AND p_target_id IS NULL OR jsonb_typeof(p_facts) IS DISTINCT FROM 'object' OR p_facts->>'commandDigest' !~ '^[a-f0-9]{64}$' OR nullif(btrim(p_org_code),'') IS NULL OR p_valid_from IS NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 RETURN EXISTS(SELECT 1 FROM department_master.version v JOIN department_master.input i ON i.id=v.input_id WHERE i.job_id=p_job_id AND EXISTS(SELECT 1 FROM department_master.organization_identifier m WHERE m.kind='HOSPITAL_CODE' AND m.target_id=v.department_id AND m.reserved_value=p_org_code) AND v.valid_from=p_valid_from AND v.valid_to IS NOT DISTINCT FROM p_valid_to AND v.facts->>'commandDigest'=p_facts->>'commandDigest' AND (v.facts-'verificationId'-'commandDigest')=(p_facts-'verificationId'-'commandDigest') AND ((p_intent='CREATE' AND p_expected_version IS NULL AND v.number=1) OR (p_intent='REVISE' AND p_expected_version IS NOT NULL AND v.department_id=p_target_id AND v.number-1=p_expected_version)));
END $$;
CREATE FUNCTION department_master.department_code_at(p_actor text,p_id uuid,p_business timestamp,p_record timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d department_master.department;m department_master.organization_identifier;v department_master.organization_identifier_version;baseline timestamp;BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');SELECT * INTO d FROM department_master.department WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT min(v2.recorded_at) INTO baseline FROM department_master.organization_identifier m2 JOIN department_master.organization_identifier_version v2 ON v2.identifier_id=m2.id WHERE m2.target_type='ORG' AND m2.target_id=p_id AND m2.kind='HOSPITAL_CODE';
 IF p_record IS NOT NULL AND p_record<baseline AND EXISTS(SELECT 1 FROM department_master.version WHERE department_id=p_id AND recorded_at<=p_record AND valid_from<=p_business) THEN RETURN jsonb_build_object('initialCode',d.code,'effectiveCode',d.code,'codeVersion',NULL,'codeEvidence','ORG04_HISTORICAL');END IF;
 SELECT current.* INTO v FROM department_master.organization_identifier x CROSS JOIN LATERAL (SELECT * FROM department_master.organization_identifier_version WHERE identifier_id=x.id AND (p_record IS NULL OR recorded_at<=p_record) ORDER BY number DESC LIMIT 1) current WHERE x.target_type='ORG' AND x.target_id=p_id AND x.kind='HOSPITAL_CODE' AND current.action<>'RETRACT' AND tsrange(current.valid_from,current.valid_to,'[)')@>p_business;
 RETURN jsonb_build_object('initialCode',d.code,'effectiveCode',v.value,'codeVersion',CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object('id',v.identifier_id,'version',v.number::text,'versionId',v.id) END,'codeEvidence','ORG23_ASSERTION');
END $$;
REVOKE ALL ON FUNCTION department_master.department_code_at(text,uuid,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
