SELECT pg_advisory_xact_lock(901002);
ALTER TABLE governance_catalog.import_contract ADD COLUMN bundle_org boolean NOT NULL DEFAULT false;
ALTER TABLE governance_catalog.import_contract DROP CONSTRAINT import_contract_channel_key;
ALTER TABLE governance_catalog.import_contract ADD CONSTRAINT import_contract_channel_key UNIQUE(dataset_id,profile,manual_org03,bundle_org);
ALTER TABLE governance_catalog.import_contract ADD CONSTRAINT bundle_org_core CHECK(NOT bundle_org OR (profile='CORE' AND NOT manual_org03));
DO $patch$
DECLARE body text;needle text;
 manual text:=$m$(obj.scope='SYNTHETIC' AND obj.code='ORG03' AND coalesce(contract.profile,input->>'profile')='CORE' AND input->'definition'->>'templateVersion'='ORG03_MANUAL_CORE_V1')$m$;
 bundle text:=$b$(obj.scope='SYNTHETIC' AND obj.code IN ('ORG01','ORG02','ORG03') AND coalesce(contract.profile,input->>'profile')='CORE' AND input->'definition'->>'templateVersion'=obj.code||'_BUNDLE_CORE_V1')$b$;
BEGIN
 body:=pg_get_functiondef('governance_catalog.contract_command(text,jsonb)'::regprocedure);
 needle:='AND manual_org03='||manual||') THEN RAISE EXCEPTION ''CONTRACT_EXISTS'';';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_CONTRACT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'AND manual_org03='||manual||' AND bundle_org='||bundle||') THEN RAISE EXCEPTION ''CONTRACT_EXISTS'';');
 needle:='INSERT INTO governance_catalog.import_contract(dataset_id,profile,manual_org03) VALUES(obj.id,input->>''profile'','||manual||') RETURNING * INTO contract;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_CONTRACT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'INSERT INTO governance_catalog.import_contract(dataset_id,profile,manual_org03,bundle_org) VALUES(obj.id,input->>''profile'','||manual||','||bundle||') RETURNING * INTO contract;');
 needle:='  PERFORM governance_catalog.contract_definition(input->''definition'',dataset.id,coalesce(contract.profile,input->>''profile''));';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_CONTRACT_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'  IF action=''REVISE'' AND contract.bundle_org IS DISTINCT FROM '||bundle||' THEN RAISE EXCEPTION ''FIXED_DATASET_REFERENCE_REQUIRED'';END IF;'||E'\n'||needle);

 body:=pg_get_functiondef('governance_catalog.validation_rules_valid(jsonb,uuid)'::regprocedure);
 needle:=' FOR rule IN SELECT value FROM jsonb_array_elements(definition->''rules'') LOOP';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_RULE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$guard$
 IF code IN ('ORG01','ORG02','ORG03') AND definition->>'templateVersion'=code||'_BUNDLE_CORE_V1' THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(source->'rules') r WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition->'rules') a WHERE a->>'id'=r->>'id' AND a->>'status'='MACHINE')) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition->'rules') a WHERE a->>'id'='ORG_BUNDLE_APPROVAL_V1' AND a->>'field'='approval_ref' AND a->>'version'='P1_05_BUNDLE_V1' AND a->>'status'='MACHINE') THEN RETURN false;END IF;
 END IF;
$guard$||needle||$custom$
  IF code IN ('ORG01','ORG02','ORG03') AND definition->>'templateVersion'=code||'_BUNDLE_CORE_V1' AND rule->>'id'='ORG_BUNDLE_APPROVAL_V1' AND rule->>'field'='approval_ref' AND rule->>'version'='P1_05_BUNDLE_V1' AND rule->>'status'='MACHINE' AND rule->>'text'='Published source intent requires an approval reference; platform review is separate.' THEN CONTINUE;END IF;
$custom$);
 needle:='IF NOT (';
 -- Add only these finite source conditions to the existing MACHINE rule allowlist.
 IF position('OR (code=''ORG03'' AND definition->>''templateVersion''=''ORG03_MANUAL_CORE_V1''' IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_RULE_BASELINE_MISMATCH';END IF;
 body:=replace(body,'OR (code=''ORG03'' AND definition->>''templateVersion''=''ORG03_MANUAL_CORE_V1''','OR (code IN (''ORG01'',''ORG02'',''ORG03'') AND definition->>''templateVersion''=code||''_BUNDLE_CORE_V1'' AND rule->>''id'' IN (''SRC-COND-001'',''SRC-COND-002'',''SRC-COND-003'',''SRC-COND-004'',''SRC-COND-005'',''SRC-COND-006'',''SRC-COND-007'')) OR (code=''ORG03'' AND definition->>''templateVersion''=''ORG03_MANUAL_CORE_V1''');
 EXECUTE body;

 body:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 needle:='NOT IN (''BLOCKED_DEPENDENCY'',''DECLARED_PARAMETER'',''ADOPTED_CODESET'')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_REFERENCE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'NOT IN (''BLOCKED_DEPENDENCY'',''DECLARED_PARAMETER'',''ADOPTED_CODESET'',''ORG_BUNDLE'')');
 needle:='  IF entry->>''status''=''DECLARED_PARAMETER'' THEN';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_REFERENCE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$reference$
  IF entry->>'status'='ORG_BUNDLE' AND (p_profile<>'CORE' OR NOT EXISTS(SELECT 1 FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_dataset_version AND o.code IN ('ORG01','ORG02','ORG03') AND o.scope='SYNTHETIC' AND p_definition->>'templateVersion'=o.code||'_BUNDLE_CORE_V1')) THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
$reference$||needle);
 needle:=' IF p_profile=''FULL''';
 body:=replace(body,needle,$fields$
 IF p_definition->>'templateVersion' IN ('ORG01_BUNDLE_CORE_V1','ORG02_BUNDLE_CORE_V1','ORG03_BUNDLE_CORE_V1') AND (p_profile<>'CORE' OR jsonb_array_length(p_definition->'fields')<>jsonb_array_length(dataset->'fields')) THEN RAISE EXCEPTION 'FULL_FIELD_OMISSION';END IF;
$fields$||needle);
 EXECUTE body;
END $patch$;
