SELECT pg_advisory_xact_lock(901002);

-- A later handoff cannot invalidate an accepted consumer request. Reauthorize
-- that receipt's historical approval/binding/responsibility before returning it.
DO $$
DECLARE definition text;needle text;replacement text;
BEGIN
 definition:=replace(pg_get_functiondef('governance_catalog.department_impact_receipt(jsonb)'::regprocedure),chr(13)||chr(10),chr(10));
 needle:=$old$ SELECT * INTO proposal FROM governance_catalog.department_impact_case_event WHERE case_id=c.id AND kind='PROPOSE' ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO approval FROM governance_catalog.department_impact_case_event WHERE case_id=c.id AND kind='APPROVE' ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO assigned FROM governance_catalog.department_impact_case_event WHERE case_id=c.id AND kind='ASSIGN' ORDER BY sequence DESC LIMIT 1;$old$;
 replacement:=$new$ IF t->>'operation'='RECEIPT' THEN
  SELECT * INTO prior FROM governance_catalog.department_impact_case_event WHERE actor_identity=t->>'identity' AND request_id=(t->>'requestId')::uuid;
  IF FOUND AND (prior.case_id<>c.id OR prior.kind<>'RECEIPT' OR prior.request_digest IS DISTINCT FROM t->>'requestDigest') THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
 END IF;
 IF prior.id IS NULL THEN
  SELECT * INTO proposal FROM governance_catalog.department_impact_case_event WHERE case_id=c.id AND kind='PROPOSE' ORDER BY sequence DESC LIMIT 1;
  SELECT * INTO approval FROM governance_catalog.department_impact_case_event WHERE case_id=c.id AND kind='APPROVE' ORDER BY sequence DESC LIMIT 1;
  SELECT * INTO assigned FROM governance_catalog.department_impact_case_event WHERE case_id=c.id AND kind='ASSIGN' ORDER BY sequence DESC LIMIT 1;
 ELSE
  SELECT * INTO proposal FROM governance_catalog.department_impact_case_event WHERE case_id=c.id AND kind='PROPOSE' AND id=(prior.payload->>'proposalEventId')::uuid;
  SELECT * INTO approval FROM governance_catalog.department_impact_case_event WHERE case_id=c.id AND kind='APPROVE' AND payload->>'proposalEventId'=proposal.id::text AND sequence<prior.sequence ORDER BY sequence DESC LIMIT 1;
  SELECT * INTO assigned FROM governance_catalog.department_impact_case_event WHERE case_id=c.id AND kind='ASSIGN' AND sequence<approval.sequence ORDER BY sequence DESC LIMIT 1;
 END IF;$new$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'IMPACT_RECEIPT_HISTORY_BASELINE_MISMATCH';END IF;
 definition:=replace(definition,needle,replacement);

 needle:=$old$ IF t->>'proposalEventId' IS DISTINCT FROM proposal.id::text THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 SELECT * INTO prior FROM governance_catalog.department_impact_case_event WHERE actor_identity=t->>'identity' AND request_id=(t->>'requestId')::uuid;
 IF FOUND THEN IF prior.case_id<>c.id OR prior.request_digest IS DISTINCT FROM t->>'requestDigest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN governance_catalog.department_impact_event_json(prior.id);END IF;$old$;
 replacement:=$new$ IF prior.id IS NOT NULL THEN RETURN governance_catalog.department_impact_event_json(prior.id);END IF;
 IF t->>'proposalEventId' IS DISTINCT FROM proposal.id::text THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;$new$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'IMPACT_RECEIPT_HISTORY_BASELINE_MISMATCH';END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;
