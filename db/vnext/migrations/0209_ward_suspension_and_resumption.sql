SELECT pg_advisory_xact_lock(901002);
ALTER TABLE care_organization.ward_version DROP CONSTRAINT ward_version_action_check;
ALTER TABLE care_organization.ward_version ADD CONSTRAINT ward_version_action_check CHECK(action IN ('CREATE','REVISE','REBIND','CLOSE','SUSPEND','RESUME'));
ALTER TABLE care_organization.ward_version ADD CONSTRAINT ward_suspension_open_end CHECK(action<>'SUSPEND' OR valid_to IS NULL);

DO $$
DECLARE body text;needle text;replacement text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_mutate(text,text)'::regprocedure);
 needle:=$old$IF w->>'action' NOT IN ('CREATE','REVISE','REBIND','CLOSE') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;$old$;
 replacement:=$new$IF w->>'action' NOT IN ('CREATE','REVISE','REBIND','CLOSE','SUSPEND','RESUME') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF w->>'action' IN ('REVISE','REBIND') AND care_organization.care_unavailable(care_organization.ward_snapshot(actor,target)) && tsmultirange(tsrange(from_at,to_at,'[)')) THEN RAISE EXCEPTION 'WARD_SUSPENDED';END IF;
  IF w->>'action' IN ('SUSPEND','RESUME') THEN
   SELECT * INTO at_version FROM care_organization.ward_version WHERE unit_id=target AND action IN ('CREATE','REVISE') AND valid_from<=from_at ORDER BY number DESC LIMIT 1;
   IF at_version.id IS NULL OR (at_version.valid_to IS NOT NULL AND from_at>=at_version.valid_to) OR jsonb_array_length(w->'bindingChanges')<>0 OR ((w->'facts')-ARRAY['source','contractVersionId','managementBasis','receivingBasis']) IS DISTINCT FROM (at_version.facts-ARRAY['source','contractVersionId','managementBasis','receivingBasis']) OR w->'facts'->'managementBasis' IS DISTINCT FROM at_version.facts->'managementBasis' OR w->'facts'->'receivingBasis' IS DISTINCT FROM at_version.facts->'receivingBasis' THEN RAISE EXCEPTION 'WARD_CONTENT_CHANGED';END IF;
   IF (w->>'action'='RESUME') IS DISTINCT FROM (care_organization.care_unavailable(care_organization.ward_snapshot(actor,target)) @> from_at) THEN RAISE EXCEPTION 'UNSUPPORTED_STATE_TRANSITION';END IF;
   IF w->>'action'='SUSPEND' AND to_at IS NOT NULL THEN RAISE EXCEPTION 'WARD_CLOSURE_EXPANSION';END IF;
   IF w->>'action'='RESUME' THEN
    PERFORM care_organization.ward_admission(actor,w->'binding',from_at,to_at,record_at);PERFORM care_organization.ward_admission(approved_by,w->'binding',from_at,to_at,record_at);
    PERFORM governance_catalog.ward_source_coverage(actor,(w->'facts'->'source'->>'sourceSystemId')::uuid,from_at,to_at,record_at);PERFORM governance_catalog.ward_source_coverage(approved_by,(w->'facts'->'source'->>'sourceSystemId')::uuid,from_at,to_at,record_at);
   END IF;
  END IF;$new$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_ACTION_BASELINE_MISMATCH';END IF;EXECUTE replace(body,needle,replacement);

 body:=pg_get_functiondef('care_organization.unit_ward_ward_guard(text,jsonb,jsonb,timestamp,timestamp,timestamp)'::regprocedure);
 needle:=$old$value->>'action'<>'REBIND' AND (value->>'number')::bigint>(property->>'number')::bigint$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_WINDOW_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$value->>'action' IN ('CREATE','REVISE') AND (value->>'number')::bigint>(property->>'number')::bigint$new$);
 needle:=$old$SELECT item INTO b FROM jsonb_array_elements(h->'bindings')$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_BINDING_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$spans:=spans-care_organization.care_unavailable(h);
  SELECT item INTO b FROM jsonb_array_elements(h->'bindings')$new$);EXECUTE body;
END $$;
