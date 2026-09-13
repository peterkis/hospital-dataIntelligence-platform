-- A collection omits inaccessible rows; an explicit target still fails closed.
SELECT pg_advisory_xact_lock(901002);
DO $collection_dependency_access$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('governance_catalog.contract_read(text,jsonb)'::regprocedure);
 needle:='  PERFORM governance_catalog.contract_require_access(actor,sc,item.version_id,''READ'');';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'CONTRACT_READ_VERSION_MISMATCH'; END IF;
 definition:=replace(definition,needle,'  BEGIN'||E'\n'||needle);
 needle:=E'  END LOOP;\n  result:=result||jsonb_build_array';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'CONTRACT_READ_VERSION_MISMATCH'; END IF;
 definition:=replace(definition,needle,E'  END LOOP;\n  EXCEPTION WHEN SQLSTATE ''P0001'' THEN\n   IF SQLERRM<>''ACCESS_DENIED'' OR input->>''target'' IS NOT NULL THEN RAISE; END IF;\n   CONTINUE;\n  END;\n  result:=result||jsonb_build_array');
 EXECUTE definition;
END $collection_dependency_access$;
