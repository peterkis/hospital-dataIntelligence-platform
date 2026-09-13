-- Forward-only correction: one reference field binds exactly one owner version.
-- Keep existing immutable contracts/history intact. Older ambiguous candidates
-- must be revised; validation/approval/publication cannot advance them.
DO $reference_uniqueness$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 needle:=' FOR entry IN SELECT value FROM jsonb_array_elements(p_definition->''references'') LOOP';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'CONTRACT_DEFINITION_VERSION_MISMATCH'; END IF;
 definition:=replace(definition,needle,
  ' IF (SELECT count(*)<>count(DISTINCT value->>''field'') FROM jsonb_array_elements(p_definition->''references'')) THEN RAISE EXCEPTION ''DUPLICATE_REFERENCE_FIELD''; END IF;'
  ||E'\n'||needle);
 EXECUTE definition;

 definition:=pg_get_functiondef('governance_catalog.contract_command(text,jsonb)'::regprocedure);
 needle:='  IF action<>''RETIRE'' THEN';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'CONTRACT_COMMAND_VERSION_MISMATCH'; END IF;
 definition:=replace(definition,needle,needle||E'\n'||
  '   IF (SELECT count(*)<>count(DISTINCT value->>''field'') FROM jsonb_array_elements(ver.definition->''references'')) THEN blockers:=blockers||jsonb_build_array(''DUPLICATE_REFERENCE_FIELD''); END IF;');
 EXECUTE definition;
END $reference_uniqueness$;
