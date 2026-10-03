SELECT pg_advisory_xact_lock(901002);

-- Accepted request replay remains first. New terminal commands must report the
-- completed disposition even when the client retained its earlier observed head.
DO $$
DECLARE definition text;needle text;replacement text;
BEGIN
 definition:=pg_get_functiondef('governance_catalog.department_impact_command(jsonb)'::regprocedure);
 needle:=$old$ IF operation='PRIOR_COMMAND' THEN RETURN NULL;END IF;$old$;
 replacement:=needle||$new$
 IF operation='APPROVE' AND coalesce(latest.status,'OPEN')<>'OPEN' THEN RAISE EXCEPTION 'DISPOSITION_ALREADY_COMPLETE';END IF;$new$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'IMPACT_TERMINAL_ORDER_BASELINE_MISMATCH';END IF;
 definition:=replace(definition,needle,replacement);
 needle:=$old$ ELSIF operation='APPROVE' THEN
  IF coalesce(latest.status,'OPEN')<>'OPEN' THEN RAISE EXCEPTION 'DISPOSITION_ALREADY_COMPLETE';END IF;$old$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'IMPACT_TERMINAL_ORDER_BASELINE_MISMATCH';END IF;
 EXECUTE replace(definition,needle,$new$ ELSIF operation='APPROVE' THEN$new$);

 -- ASSIGN request lookup uses the same explicit responsibility and authority
 -- checks as its write path, including a first assignment with no prior event.
 definition:=pg_get_functiondef('governance_catalog.department_impact_command(jsonb)'::regprocedure);
 needle:=$old$ IF operation='ASSIGN' THEN responsibility:=$old$;
 replacement:=$new$ IF operation='ASSIGN' OR operation='PRIOR_COMMAND' AND t->>'commandOperation'='ASSIGN' THEN responsibility:=$new$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'IMPACT_ASSIGN_REPLAY_BASELINE_MISMATCH';END IF;
 EXECUTE replace(definition,needle,replacement);

 definition:=pg_get_functiondef('governance_catalog.department_impact_receipt(jsonb)'::regprocedure);
 needle:=$old$ IF latest.sequence::text IS DISTINCT FROM t->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
 IF latest.status<>'OPEN' THEN RAISE EXCEPTION 'DISPOSITION_ALREADY_COMPLETE';END IF;$old$;
 replacement:=$new$ IF latest.status<>'OPEN' THEN RAISE EXCEPTION 'DISPOSITION_ALREADY_COMPLETE';END IF;
 IF latest.sequence::text IS DISTINCT FROM t->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;$new$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'IMPACT_RECEIPT_ORDER_BASELINE_MISMATCH';END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;
