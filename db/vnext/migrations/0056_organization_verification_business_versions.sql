SELECT pg_advisory_xact_lock(901002);
-- Keep ordinary mutations' expected-head check. A verification instead freezes
-- an exact business version plus the observed heads in its approved candidate.
DO $verification$
DECLARE body text; needle text;
BEGIN
 body:=pg_get_functiondef('organization_master.write(text,uuid,jsonb,jsonb)'::regprocedure);
 needle:='IF n::text IS DISTINCT FROM p_command->''target''->>''version'' OR s::text IS DISTINCT FROM p_command->''target''->>''id'' THEN';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ORGANIZATION_WRITE_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,'IF (action<>''VERIFY_REGISTRATION'' AND n::text IS DISTINCT FROM p_command->''target''->>''version'') OR s::text IS DISTINCT FROM p_command->''target''->>''id'' THEN');
 needle:='SELECT s,(SELECT id FROM organization_master.version WHERE subject_id=s ORDER BY number DESC LIMIT 1),ARRAY';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ORGANIZATION_VERIFICATION_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,'SELECT s,(SELECT id FROM organization_master.version WHERE subject_id=s AND number=(p_command->''target''->>''version'')::bigint),ARRAY');
 EXECUTE body;
END $verification$;
