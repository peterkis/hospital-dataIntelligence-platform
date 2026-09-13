-- Filter the immutable version before checking its referenced owner permissions.
-- Exact schema reads must not authorize unrelated versions of the same contract.
SELECT pg_advisory_xact_lock(901002);
DO $exact_contract_version$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('governance_catalog.contract_read(text,jsonb)'::regprocedure);
 needle:='(''scope'',''mode'',''target'',''asOf'',''businessAt'')';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'CONTRACT_READ_VERSION_MISMATCH'; END IF;
 definition:=replace(definition,needle,'(''scope'',''mode'',''target'',''asOf'',''businessAt'',''versionId'')');
 needle:=' IF (mode=''HISTORY'' AND input->>''target'' IS NULL)';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'CONTRACT_READ_VERSION_MISMATCH'; END IF;
 definition:=replace(definition,needle,
  ' IF input ? ''versionId'' AND (mode<>''HISTORY'' OR input->>''target'' IS NULL OR coalesce(input->>''versionId'','''') !~ ''^[a-f0-9-]{36}$'') THEN RAISE EXCEPTION ''INVALID_READ_MODE''; END IF;'
  ||E'\n'||needle);
 needle:='  AND (mode=''HISTORY'' OR e.head=';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'CONTRACT_READ_VERSION_MISMATCH'; END IF;
 definition:=replace(definition,needle,
  '  AND (input->>''versionId'' IS NULL OR v.id=(input->>''versionId'')::uuid)'
  ||E'\n'||needle);
 EXECUTE definition;
END $exact_contract_version$;
