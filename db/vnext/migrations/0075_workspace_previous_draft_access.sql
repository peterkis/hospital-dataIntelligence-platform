-- Replacing a private draft requires current access to both security boundaries.
-- Forward-only: preserve prior migrations, envelopes, function OID, owner and ACL.
SELECT pg_advisory_xact_lock(901002);
DO $repair$
DECLARE
 body text;
 needle text := $needle$  PERFORM organization_master.workspace_authorize(p_actor,previous.metadata,'WRITE');$needle$;
 replacement text := $replacement$  PERFORM organization_master.workspace_authorize(p_actor,previous.metadata,'READ');
  PERFORM organization_master.workspace_authorize(p_actor,previous.metadata,'READ_RESTRICTED');
  PERFORM organization_master.workspace_authorize(p_actor,previous.metadata,'WRITE');$replacement$;
BEGIN
 body:=pg_get_functiondef('organization_master.workspace_save(text,jsonb,text,jsonb)'::regprocedure);
 IF length(body)-length(replace(body,needle,''))<>length(needle) OR position(replacement IN body)>0 THEN
  RAISE EXCEPTION 'WORKSPACE_PREVIOUS_ACCESS_BASELINE_MISMATCH';
 END IF;
 EXECUTE replace(body,needle,replacement);
END $repair$;
