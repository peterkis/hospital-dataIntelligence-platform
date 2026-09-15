SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION governance_catalog.validation_rules_valid(definition jsonb,dataset_version uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE rule jsonb; field jsonb; code text; source jsonb;
BEGIN
 IF jsonb_array_length(definition->'rules')>100 OR (SELECT count(*)<>count(DISTINCT r->>'id') FROM jsonb_array_elements(definition->'rules') r) THEN RETURN false; END IF;
 SELECT o.code INTO code FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=dataset_version;
 SELECT d->'definition' INTO source FROM governance_catalog.source_snapshot s CROSS JOIN LATERAL jsonb_array_elements(s.content->'drafts') d WHERE s.source_key='P0_02_CONTRACT_DRAFTS' AND d->>'dataset'=code;
 FOR rule IN SELECT value FROM jsonb_array_elements(definition->'rules') LOOP
  IF rule->>'status'='UNRESOLVED' THEN CONTINUE; END IF;
  IF rule->>'version' IS DISTINCT FROM 'P0_05_SOURCE_V1' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source->'rules') r WHERE r->>'id'=rule->>'id' AND r->>'field'=rule->>'field' AND r->>'text'=rule->>'text') THEN RETURN false; END IF;
  IF rule->>'status'='MACHINE' THEN
   IF rule->>'id'<>'SRC-COND-061' OR code<>'PER17' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition->'fields') f WHERE f->>'code'='account_kind') THEN RETURN false; END IF;
  ELSIF rule->>'status'<>'MANUAL_EVIDENCE' THEN RETURN false;
  END IF;
 END LOOP;
 FOR field IN SELECT value FROM jsonb_array_elements(definition->'fields') LOOP
  IF field->>'condition'='EVALUATED' AND (SELECT count(*) FROM jsonb_array_elements(definition->'rules') r WHERE r->>'field'=field->>'code' AND r->>'status'='MACHINE')<>1 THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.validation_rules_valid(jsonb,uuid) FROM PUBLIC,hdi_prototype;
DO $finite$
DECLARE body text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 IF position('coalesce(entry->>''status'','''')<>''UNRESOLVED''' IN body)=0 THEN RAISE EXCEPTION 'RULE_PATCH_BASELINE_MISMATCH'; END IF;
 body:=replace(body,'''ALWAYS'',''OPTIONAL'',''UNRESOLVED'',''MANUAL_EVIDENCE''','''ALWAYS'',''OPTIONAL'',''UNRESOLVED'',''MANUAL_EVIDENCE'',''EVALUATED''');
 body:=replace(body,'NOT IN (''UNRESOLVED'',''MANUAL_EVIDENCE'')','NOT IN (''UNRESOLVED'',''MANUAL_EVIDENCE'',''EVALUATED'')');
 body:=replace(body,'coalesce(entry->>''status'','''')<>''UNRESOLVED''','coalesce(entry->>''status'','''') NOT IN (''UNRESOLVED'',''MACHINE'',''MANUAL_EVIDENCE'')');
 body:=replace(body,' IF p_profile=''FULL''',' IF NOT governance_catalog.validation_rules_valid(p_definition,p_dataset_version) THEN RAISE EXCEPTION ''FINITE_RULE_REQUIRED''; END IF;'||E'\n'||' IF p_profile=''FULL''');
 EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.contract_command(text,jsonb)'::regprocedure);
 IF position('jsonb_array_length(ver.definition->''rules'')>0' IN body)=0 THEN RAISE EXCEPTION 'RULE_COMMAND_BASELINE_MISMATCH'; END IF;
 body:=replace(body,'jsonb_array_length(ver.definition->''rules'')>0','EXISTS(SELECT 1 FROM jsonb_array_elements(ver.definition->''rules'') r WHERE r->>''status''<>''MACHINE'')');
 EXECUTE body;
END $finite$;
