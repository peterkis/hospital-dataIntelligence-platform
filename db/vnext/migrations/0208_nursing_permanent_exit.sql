SELECT pg_advisory_xact_lock(901002);
ALTER TABLE care_organization.nursing_version DROP CONSTRAINT nursing_version_action_check;
ALTER TABLE care_organization.nursing_version ADD CONSTRAINT nursing_version_action_check CHECK(action IN ('CREATE','REVISE','REBIND','SUSPEND','RESUME','CLOSE'));
ALTER TABLE care_organization.nursing_version ADD CONSTRAINT nursing_permanent_exit_open_end CHECK(action<>'CLOSE' OR valid_to IS NULL);

DO $$
DECLARE body text;needle text;replacement text;BEGIN
 body:=pg_get_functiondef('care_organization.nursing_mutate(text,text)'::regprocedure);
 needle:=$old$IF w->>'action'<>'RESUME' AND care_organization.care_unavailable(care_organization.nursing_snapshot(actor,target))$old$;
 replacement:=$new$IF EXISTS(SELECT 1 FROM care_organization.nursing_version WHERE unit_id=target AND action='CLOSE') THEN RAISE EXCEPTION 'NURSING_CLOSED';END IF;
   IF w->>'action' NOT IN ('RESUME','CLOSE') AND care_organization.care_unavailable(care_organization.nursing_snapshot(actor,target))$new$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_NURSING_EXIT_GUARD_BASELINE_MISMATCH';END IF;body:=replace(body,needle,replacement);
 needle:=$old$IF w->>'action' NOT IN ('CREATE','REVISE','REBIND','SUSPEND','RESUME') THEN$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_NURSING_EXIT_ACTION_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$IF w->>'action' NOT IN ('CREATE','REVISE','REBIND','SUSPEND','RESUME','CLOSE') THEN$new$);
 needle:=$old$IF w->>'action'='SUSPEND' THEN$old$;
 replacement:=$new$IF w->>'action'='CLOSE' THEN
   SELECT * INTO at_version FROM care_organization.nursing_version WHERE unit_id=target AND action IN ('CREATE','REVISE') AND valid_from<=from_at AND (valid_to IS NULL OR from_at<=valid_to) ORDER BY number DESC LIMIT 1;
   IF to_at IS NOT NULL OR at_version.id IS NULL OR jsonb_array_length(w->'bindingChanges')<>0 OR ((w->'facts')-ARRAY['source','contractVersionId','managementBasis']) IS DISTINCT FROM (at_version.facts-ARRAY['source','contractVersionId','managementBasis']) OR w->'facts'->'managementBasis' IS DISTINCT FROM at_version.facts->'managementBasis' THEN RAISE EXCEPTION 'NURSING_CLOSURE_EXPANSION';END IF;
  END IF;
  IF w->>'action'='SUSPEND' THEN$new$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_NURSING_EXIT_WRITE_BASELINE_MISMATCH';END IF;EXECUTE replace(body,needle,replacement);
END $$;
