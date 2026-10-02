SELECT pg_advisory_xact_lock(901002);

-- Repair installed routines without rewriting case events or prior migrations.
DO $$
DECLARE definition text;needle text;replacement text;
BEGIN
 definition:=pg_get_functiondef('governance_catalog.department_impact_command(jsonb)'::regprocedure);
 needle:=$old$ ELSIF operation='APPROVE' THEN$old$;
 replacement:=needle||$new$
  IF coalesce(latest.status,'OPEN')<>'OPEN' THEN RAISE EXCEPTION 'DISPOSITION_ALREADY_COMPLETE';END IF;$new$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'IMPACT_TERMINAL_BASELINE_MISMATCH';END IF;
 EXECUTE replace(definition,needle,replacement);

 -- Exact request replay precedes this guard; a new callback cannot reopen a case.
 definition:=pg_get_functiondef('governance_catalog.department_impact_receipt(jsonb)'::regprocedure);
 needle:=$old$ IF latest.sequence::text IS DISTINCT FROM t->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;$old$;
 replacement:=needle||$new$
 IF latest.status<>'OPEN' THEN RAISE EXCEPTION 'DISPOSITION_ALREADY_COMPLETE';END IF;$new$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'IMPACT_RECEIPT_TERMINAL_BASELINE_MISMATCH';END IF;
 EXECUTE replace(definition,needle,replacement);

 -- A successful observation is replayed before scanning a possibly larger graph.
 -- The Owner must still reauthorize every original and frozen-current reference.
 definition:=pg_get_functiondef('governance_catalog.department_impact_record(text,text)'::regprocedure);
 needle:=$old$ IF t->>'operation' IN ('RECEIPT','READ_HANDOFF') THEN RETURN governance_catalog.department_impact_receipt(t);END IF;$old$;
 replacement:=$new$ IF t->>'operation'='PRIOR_ASSESSMENT' THEN
  SELECT * INTO r FROM governance_catalog.department_impact_assessment WHERE actor_identity=t->>'identity' AND request_id=(t->>'requestId')::uuid;
  IF NOT FOUND THEN RETURN NULL;END IF;
  IF r.campus IS DISTINCT FROM t->>'campus' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  IF r.request_digest IS DISTINCT FROM t->>'requestDigest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
  PERFORM department_master.evolution_input_read(t->>'actor',r.input_id,'READ_RESTRICTED');
  RETURN r.content||jsonb_build_object('assessmentId',r.id,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
 END IF;
$new$||needle;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'IMPACT_REPLAY_BASELINE_MISMATCH';END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;
