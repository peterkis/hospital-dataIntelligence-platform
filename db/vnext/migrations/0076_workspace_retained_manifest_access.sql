-- Payload-free bundle manifests still contain protected targets, evidence and scopes.
-- Forward-only: preserve prior migrations, envelopes, function OIDs, owners and ACLs.
SELECT pg_advisory_xact_lock(901002);
DO $repair_authorize$
DECLARE
 body text;
 needle text := $needle$ IF domain='BUNDLE' AND (m->>'hasPayload')::boolean THEN$needle$;
 replacement text := $replacement$ IF domain='BUNDLE' AND ((m->>'hasPayload')::boolean OR coalesce((m->>'manifestProtected')::boolean,false) OR coalesce(jsonb_array_length(m->'bindings'),0)>0) THEN$replacement$;
BEGIN
 body:=pg_get_functiondef('organization_master.workspace_authorize(text,jsonb,text)'::regprocedure);
 IF length(body)-length(replace(body,needle,''))<>length(needle) OR position(replacement IN body)>0 THEN
  RAISE EXCEPTION 'WORKSPACE_RETAINED_MANIFEST_AUTH_BASELINE_MISMATCH';
 END IF;
 EXECUTE replace(body,needle,replacement);
END $repair_authorize$;
DO $repair_save$
DECLARE
 body text;
 needle text := $needle$  PERFORM organization_master.workspace_authorize(p_actor,previous.metadata,'READ');
  PERFORM organization_master.workspace_authorize(p_actor,previous.metadata,'READ_RESTRICTED');
  PERFORM organization_master.workspace_authorize(p_actor,previous.metadata,'WRITE');$needle$;
 replacement text := $replacement$  PERFORM organization_master.workspace_authorize(p_actor,previous.metadata,'READ');
  PERFORM organization_master.workspace_authorize(p_actor,previous.metadata,'READ_RESTRICTED');
  PERFORM organization_master.workspace_authorize(p_actor,previous.metadata,'WRITE');
  -- Pre-V3 payload-free bundle metadata cannot prove whether protected manifest
  -- rows were retained. Immutable ambiguous revisions are readable only through
  -- the application fail-closed path and cannot be appended or retargeted.
  IF previous.metadata->>'domain'='BUNDLE' AND NOT coalesce((previous.metadata->>'hasPayload')::boolean,false)
   AND coalesce(jsonb_array_length(previous.metadata->'bindings'),0)=0
   AND NOT (previous.metadata ? 'manifestProtected') THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;$replacement$;
BEGIN
 body:=pg_get_functiondef('organization_master.workspace_save(text,jsonb,text,jsonb)'::regprocedure);
 IF length(body)-length(replace(body,needle,''))<>length(needle) OR position(replacement IN body)>0 THEN
  RAISE EXCEPTION 'WORKSPACE_RETAINED_MANIFEST_SAVE_BASELINE_MISMATCH';
 END IF;
 EXECUTE replace(body,needle,replacement);
END $repair_save$;
