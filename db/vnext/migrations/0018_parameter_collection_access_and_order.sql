SELECT pg_advisory_xact_lock(901002);
DO $parameter_collection$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('governance_catalog.parameter_read(text,jsonb)'::regprocedure);
 needle:='ORDER BY p.parameter_key LOOP';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'PARAMETER_READ_VERSION_MISMATCH'; END IF;
 definition:=replace(definition,needle,'ORDER BY p.parameter_key,p.id,v.number,v.id LOOP');
 needle:='  PERFORM governance_catalog.parameter_require_access(actor,input->>''scope'',ver.id,''READ'');';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'PARAMETER_READ_VERSION_MISMATCH'; END IF;
 definition:=replace(definition,needle,'  BEGIN'||E'\n'||needle||E'\n  EXCEPTION WHEN SQLSTATE ''P0001'' THEN\n   IF SQLERRM<>''ACCESS_DENIED'' OR input->>''target'' IS NOT NULL OR input->>''versionId'' IS NOT NULL THEN RAISE; END IF;\n   CONTINUE;\n  END;');
 EXECUTE definition;
END $parameter_collection$;
