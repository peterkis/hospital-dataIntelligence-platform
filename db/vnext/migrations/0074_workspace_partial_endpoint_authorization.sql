-- Forward-only repair: a creation-policy grant is not an existing endpoint grant.
-- Keep all stored envelopes, prior migrations, function ownership and ACLs intact.
SELECT pg_advisory_xact_lock(901002);
DO $repair$
DECLARE
 body text;
 needle text := $needle$ IF domain='ORG03' AND target IS NOT NULL AND (subject IS NULL OR campus IS NULL) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;$needle$;
 addition text := $addition$
 -- Complete pairs are checked by operating_authorize below. For partial pairs,
 -- every selected endpoint still needs READ, just as it does in a complete pair.
 -- Resolve the endpoint's actual scope: never substitute the draft scope or NIL.
 IF domain='ORG03' AND (subject IS NULL OR campus IS NULL) THEN
  IF subject IS NOT NULL THEN
   SELECT s.campus INTO sc FROM organization_master.subject s WHERE s.id=subject;
   IF sc IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
   PERFORM organization_master.authorize(p_actor,subject,sc,'READ');
  END IF;
  IF campus IS NOT NULL THEN
   SELECT c.scope INTO sc FROM organization_master.campus c WHERE c.id=campus;
   IF sc IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
   PERFORM organization_master.authorize(p_actor,campus,sc,'READ');
  END IF;
 END IF;$addition$;
BEGIN
 body:=pg_get_functiondef('organization_master.workspace_authorize(text,jsonb,text)'::regprocedure);
 IF length(body)-length(replace(body,needle,''))<>length(needle) OR position(addition IN body)>0 THEN
  RAISE EXCEPTION 'WORKSPACE_ENDPOINT_BASELINE_MISMATCH';
 END IF;
 -- CREATE OR REPLACE preserves the function OID, owner and existing EXECUTE ACL.
 EXECUTE replace(body,needle,needle||addition);
END $repair$;
