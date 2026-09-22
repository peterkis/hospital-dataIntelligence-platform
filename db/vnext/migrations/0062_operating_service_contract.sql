SELECT pg_advisory_xact_lock(901002);
DO $rules$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.validation_rules_valid(jsonb,uuid)'::regprocedure);
 needle:=' FOR rule IN SELECT value FROM jsonb_array_elements(definition->''rules'') LOOP';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'OPERATING_RULE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$guard$
 IF code='ORG03' AND definition->>'templateVersion'='ORG03_MANUAL_CORE_V1' AND (
  NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition->'rules') r WHERE r->>'id'='SRC-COND-007' AND r->>'field'='license_scope' AND r->>'status'='MACHINE') OR
  NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition->'fields') f WHERE f->>'code'='license_scope' AND f->>'condition'='EVALUATED') OR
  NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition->'codeSets') c WHERE c->>'field'='license_scope' AND c->>'codeSystem'='SYNTHETIC_OPERATING_SERVICE' AND c->>'status'='SYNTHETIC_ADOPTED' AND c->'codes' @> '["DEMO_MEDICAL_A","DEMO_MEDICAL_B"]'::jsonb AND c->'codes' <@ '["DEMO_MEDICAL_A","DEMO_MEDICAL_B"]'::jsonb) OR
  NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition->'codeSets') c WHERE c->>'field'='relation_type' AND c->>'codeSystem'='SYNTHETIC_RELATION_ROLE' AND c->>'status'='SYNTHETIC_ADOPTED' AND c->'codes' @> '["OPERATOR","REGISTRANT","MANAGER","BILLING","OTHER"]'::jsonb AND c->'codes' <@ '["OPERATOR","REGISTRANT","MANAGER","BILLING","OTHER"]'::jsonb) OR
  NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition->'codeSets') c WHERE c->>'field'='is_primary_operator' AND c->>'codeSystem'='SYNTHETIC_YES_NO' AND c->>'status'='SYNTHETIC_ADOPTED' AND c->'codes' @> '["Y","N"]'::jsonb AND c->'codes' <@ '["Y","N"]'::jsonb)
 ) THEN RETURN false;END IF;
$guard$||needle);
 needle:='OR (code=''ORG02'' AND definition->>''templateVersion''=''ORG02_MANUAL_CORE_V1'' AND rule->>''id'' IN (''SRC-COND-005'',''SRC-COND-006''))';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'OPERATING_RULE_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,needle||' OR (code=''ORG03'' AND definition->>''templateVersion''=''ORG03_MANUAL_CORE_V1'' AND rule->>''id''=''SRC-COND-007'' AND rule->>''field''=''license_scope'')');
END $rules$;
CREATE FUNCTION governance_catalog.operating_catalog(p_actor text,p_ref jsonb,p_from timestamp,p_to timestamp,p_asof timestamp DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v governance_catalog.import_contract_version;e governance_catalog.import_contract_event;c jsonb;spans tsmultirange;cutoff timestamp:=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',(p_ref->>'contractVersionId')::uuid,'READ');
 SELECT * INTO v FROM governance_catalog.import_contract_version WHERE id=(p_ref->>'contractVersionId')::uuid AND contract_id=(p_ref->>'contractId')::uuid;
 SELECT * INTO e FROM governance_catalog.import_contract_event WHERE contract_id=v.contract_id AND status IN ('PUBLISHED','RETIRED') AND recorded_at<=cutoff ORDER BY head DESC LIMIT 1;
 IF v.id IS NULL OR e.version_id IS DISTINCT FROM v.id OR e.status IS DISTINCT FROM 'PUBLISHED' OR v.definition->>'templateVersion' IS DISTINCT FROM 'ORG03_MANUAL_CORE_V1' OR NOT governance_catalog.validation_rules_valid(v.definition,v.dataset_version_id) OR NOT EXISTS(SELECT 1 FROM governance_catalog.import_contract k JOIN governance_catalog.object o ON o.id=k.dataset_id WHERE k.id=v.contract_id AND k.profile='CORE' AND o.scope='SYNTHETIC' AND o.code='ORG03') THEN RETURN NULL;END IF;
 IF p_ref->>'codeSystem' IS DISTINCT FROM 'SYNTHETIC_OPERATING_SERVICE' THEN RETURN NULL;END IF;
 spans:=governance_catalog.contract_supported_spans(v.id,cutoff);
 IF NOT(tsrange(p_from,p_to,'[)') <@ spans) THEN RETURN NULL;END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(v.definition->'codeSets') LOOP
  IF c->>'status' IS DISTINCT FROM 'SYNTHETIC_ADOPTED' OR c->>'sourceVersionId' IS DISTINCT FROM p_ref->>'sourceVersionId' OR c->>'version' IS DISTINCT FROM p_ref->>'version' OR NOT(tsrange(p_from,p_to,'[)') <@ tsrange((c->>'validFrom')::timestamp,(c->>'validTo')::timestamp,'[)')) THEN RETURN NULL;END IF;
 END LOOP;
 RETURN jsonb_build_object('reference',p_ref,'publication',e.head::text,'semanticsDigest',v.semantics_digest,'codeSets',v.definition->'codeSets');
END $$;
REVOKE ALL ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;

DO $adoption$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 needle:='coalesce(entry->>''status'','''') NOT IN (''BLOCKED_DEPENDENCY'',''DECLARED_PARAMETER'')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'OPERATING_ENUM_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'coalesce(entry->>''status'','''') NOT IN (''BLOCKED_DEPENDENCY'',''DECLARED_PARAMETER'',''ADOPTED_CODESET'')');
 needle:='  IF entry->>''status''=''DECLARED_PARAMETER'' THEN';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'OPERATING_ENUM_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,$guard$
  IF entry->>'status'='ADOPTED_CODESET' AND (p_definition->>'templateVersion' IS DISTINCT FROM 'ORG03_MANUAL_CORE_V1' OR entry->>'field' IS DISTINCT FROM 'is_primary_operator' OR entry->>'target' IS DISTINCT FROM 'enum:yes_no' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_definition->'codeSets') c WHERE c->>'field'='is_primary_operator' AND c->>'status'='SYNTHETIC_ADOPTED' AND c->>'codeSystem'='SYNTHETIC_YES_NO' AND c->'codes' @> '["Y","N"]'::jsonb AND c->'codes' <@ '["Y","N"]'::jsonb)) THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
$guard$||needle);
END $adoption$;
