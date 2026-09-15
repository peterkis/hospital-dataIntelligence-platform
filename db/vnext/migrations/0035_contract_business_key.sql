-- PR7: business-key declaration is governed by the exact contract, never inferred
-- from a selected ID. Old snapshots remain valid but lack an evaluated L3 key.
SELECT pg_advisory_xact_lock(901002);
DO $key$
DECLARE body text; needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 needle:='k NOT IN (''ruleVersion'',''templateVersion'',''fields'',''codeSets'',''rules'',''references'',''sourceVersionId'')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUSINESS_KEY_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,'k NOT IN (''ruleVersion'',''templateVersion'',''fields'',''codeSets'',''rules'',''references'',''sourceVersionId'',''businessKey'')');
 needle:=' IF p_profile=''FULL''';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUSINESS_KEY_VALIDATION_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,$validation$
 IF p_definition ? 'businessKey' THEN
  IF jsonb_typeof(p_definition->'businessKey') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'BUSINESS_KEY_INVALID'; END IF;
  IF jsonb_array_length(p_definition->'businessKey') NOT BETWEEN 1 AND 8
   OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(p_definition->'businessKey'))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_definition->'businessKey') k WHERE jsonb_typeof(k)<>'string' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_definition->'fields') f WHERE f->>'code'=k#>>'{}'))
  THEN RAISE EXCEPTION 'BUSINESS_KEY_INVALID'; END IF;
 END IF;
$validation$||needle);
 EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.contract_schemas(jsonb)'::regprocedure);
 needle:=' RETURN jsonb_build_object(''sourceRowSchema'',row_schema,';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUSINESS_KEY_SCHEMA_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,' IF definition ? ''businessKey'' THEN row_schema:=row_schema||jsonb_build_object(''x-businessKey'',definition->''businessKey''); END IF;'||E'\n'||needle);
 EXECUTE body;
END $key$;
