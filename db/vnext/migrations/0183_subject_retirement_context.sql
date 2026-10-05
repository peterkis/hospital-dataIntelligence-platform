SELECT pg_advisory_xact_lock(901002);

-- Retirement retains the exact Department-campus reference from its declaration.
-- Do not rerun upstream admission or alter historical declarations.
DO $context$ DECLARE body text;needle text:=$old$OR w->'facts'->'license' IS DISTINCT FROM declaration.facts->'license'$old$;BEGIN
 body:=pg_get_functiondef('care_organization.subject_mutate(text,text)'::regprocedure);
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'SUBJECT_RETIREMENT_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,$new$OR w->'facts'->'context' IS DISTINCT FROM declaration.facts->'context' $new$||needle);
END $context$;
REVOKE ALL ON FUNCTION care_organization.subject_mutate(text,text) FROM PUBLIC,hdi_prototype;
