SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION governance_catalog.contract_enum_types_valid(definition jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE field jsonb; literal text; kind text;
BEGIN
 FOR field IN SELECT value FROM jsonb_array_elements(definition->'fields') LOOP
  kind:=field->>'type';
  FOR literal IN SELECT value FROM jsonb_array_elements_text(field->'enumValues') LOOP
   IF kind='integer' AND literal !~ '^-?(0|[1-9][0-9]*)$' THEN RETURN false; END IF;
   IF kind='decimal' AND literal !~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$' THEN RETURN false; END IF;
   IF kind IN ('date','datetime') THEN
    IF kind='date' AND literal !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN false; END IF;
    IF kind='datetime' AND literal !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$' THEN RETURN false; END IF;
    BEGIN
     PERFORM governance_catalog.contract_time(CASE WHEN kind='date' THEN literal||'T00:00:00' ELSE literal END);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN false;
    END;
   END IF;
  END LOOP;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.contract_enum_types_valid(jsonb) FROM PUBLIC,hdi_prototype;
DO $enum_types$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 needle:=' IF p_profile=''FULL''';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'CONTRACT_DEFINITION_VERSION_MISMATCH'; END IF;
 definition:=replace(definition,needle,' IF NOT governance_catalog.contract_enum_types_valid(p_definition) THEN RAISE EXCEPTION ''ENUM_LITERAL_TYPE_MISMATCH''; END IF;'||E'\n'||needle);
 EXECUTE definition;
 definition:=pg_get_functiondef('governance_catalog.contract_command(text,jsonb)'::regprocedure);
 needle:='  IF action<>''RETIRE'' THEN';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'CONTRACT_COMMAND_VERSION_MISMATCH'; END IF;
 definition:=replace(definition,needle,needle||E'\n'||'   IF NOT governance_catalog.contract_enum_types_valid(ver.definition) THEN blockers:=blockers||jsonb_build_array(''ENUM_LITERAL_TYPE_MISMATCH''); END IF;');
 EXECUTE definition;
END $enum_types$;
