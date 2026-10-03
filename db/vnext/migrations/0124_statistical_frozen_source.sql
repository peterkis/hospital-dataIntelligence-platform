SELECT pg_advisory_xact_lock(901002);

-- ADR-0133: a source snapshot only; no statistical calculation or financial view.
DO $$
DECLARE signature text; definition text;
 old_guard text := $old$p_payload->>'viewType' IN ('FINANCE','STATISTICAL')$old$;
 new_guard text := $new$(p_payload->>'viewType' = 'FINANCE' OR (p_payload->>'viewType' = 'STATISTICAL' AND p_payload->>'aggregationRule' IS DISTINCT FROM 'FROZEN_SOURCE'))$new$;
BEGIN
 FOREACH signature IN ARRAY ARRAY['department_master.hierarchy_store_candidate(text,jsonb)','department_master.hierarchy_publish(text,uuid,text,jsonb)'] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  IF (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1 THEN RAISE EXCEPTION 'FROZEN_SOURCE_BASELINE_MISMATCH';END IF;
  EXECUTE replace(definition,old_guard,new_guard);
 END LOOP;
END $$;
