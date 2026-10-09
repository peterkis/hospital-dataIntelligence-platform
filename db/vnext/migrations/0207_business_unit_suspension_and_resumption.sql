SELECT pg_advisory_xact_lock(901002);
ALTER TABLE care_organization.version DROP CONSTRAINT version_action_check;
ALTER TABLE care_organization.version ADD CONSTRAINT version_action_check CHECK(action IN ('CREATE','REVISE','REBIND','CLOSE','SUSPEND','RESUME'));
ALTER TABLE care_organization.version ADD CONSTRAINT unit_suspension_open_end CHECK(action<>'SUSPEND' OR valid_to IS NULL);

DO $$
DECLARE body text;needle text;replacement text;BEGIN
 body:=pg_get_functiondef('care_organization.mutate(text,text)'::regprocedure);
 needle:=$old$PERFORM care_organization.closed(w,ARRAY['key','targetId','expectedHead','action','validFrom','validTo','facts','binding','bindingChanges','reason','sourceRow','scope']);$old$;
 replacement:=$new$PERFORM care_organization.closed(w,ARRAY['key','targetId','expectedHead','action','validFrom','validTo','facts','binding','bindingChanges','reason','sourceRow','scope']||CASE WHEN w?'lifecycleAdmission' THEN ARRAY['lifecycleAdmission'] ELSE '{}'::text[] END);$new$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_UNIT_SHAPE_BASELINE_MISMATCH';END IF;body:=replace(body,needle,replacement);
 needle:=$old$IF w->>'action' NOT IN ('CREATE','REVISE','REBIND','CLOSE') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;$old$;
 replacement:=$new$IF w->>'action' NOT IN ('CREATE','REVISE','REBIND','CLOSE','SUSPEND','RESUME') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF w->>'action' IN ('REVISE','REBIND') AND care_organization.care_unavailable(care_organization.snapshot(actor,target)) && tsmultirange(tsrange(from_at,to_at,'[)')) THEN RAISE EXCEPTION 'UNIT_SUSPENDED';END IF;
  IF w->>'action' IN ('SUSPEND','RESUME') THEN
   SELECT * INTO at_version FROM care_organization.version WHERE unit_id=target AND action IN ('CREATE','REVISE') AND valid_from<=from_at AND (valid_to IS NULL OR from_at<valid_to) ORDER BY number DESC LIMIT 1;
   IF at_version.id IS NULL OR jsonb_array_length(w->'bindingChanges')<>0 OR ((w->'facts')-ARRAY['source','contractVersionId','receivingBasis']) IS DISTINCT FROM (at_version.facts-ARRAY['source','contractVersionId','receivingBasis']) OR w->'facts'->'receivingBasis' IS DISTINCT FROM at_version.facts->'receivingBasis' THEN RAISE EXCEPTION 'UNIT_CLOSURE_EXPANSION';END IF;
   IF (w->>'action'='RESUME') IS DISTINCT FROM (care_organization.care_unavailable(care_organization.snapshot(actor,target)) @> from_at) THEN RAISE EXCEPTION 'UNSUPPORTED_STATE_TRANSITION';END IF;
   IF w->>'action'='SUSPEND' AND to_at IS NOT NULL THEN RAISE EXCEPTION 'UNIT_CLOSURE_EXPANSION';END IF;
   IF w->>'action'='RESUME' THEN
    PERFORM department_master.unit_binding_coverage(actor,(w->'binding'->'department'->>'id')::uuid,(w->'binding'->'relation'->>'id')::uuid,w->'binding'->'relation'->>'version',(w->'binding'->'relation'->>'versionId')::uuid,(w->'binding'->'campus'->>'id')::uuid,(w->'binding'->'subject'->>'id')::uuid,w->'binding'->'services',from_at,to_at,record_at);
    PERFORM department_master.unit_binding_coverage(approved_by,(w->'binding'->'department'->>'id')::uuid,(w->'binding'->'relation'->>'id')::uuid,w->'binding'->'relation'->>'version',(w->'binding'->'relation'->>'versionId')::uuid,(w->'binding'->'campus'->>'id')::uuid,(w->'binding'->'subject'->>'id')::uuid,w->'binding'->'services',from_at,to_at,record_at);
    PERFORM care_organization.unit_ward_operating_guard(actor,w->'lifecycleAdmission',record_at);PERFORM care_organization.unit_ward_operating_guard(approved_by,w->'lifecycleAdmission',record_at);
   END IF;
  END IF;$new$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_UNIT_ACTION_BASELINE_MISMATCH';END IF;EXECUTE replace(body,needle,replacement);

 body:=pg_get_functiondef('care_organization.ward_management_coverage(text,uuid,uuid,timestamp,timestamp,timestamp)'::regprocedure);
 needle:=$old$AND value->>'action'<>'REBIND' LOOP$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_UNIT_WINDOW_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$AND value->>'action' IN ('CREATE','REVISE') LOOP$new$);
 needle:=$old$FOR b IN SELECT value FROM jsonb_array_elements(h->'bindings') LOOP$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_UNIT_BINDING_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$spans:=spans-care_organization.care_unavailable(h);
  FOR b IN SELECT value FROM jsonb_array_elements(h->'bindings') LOOP$new$);EXECUTE body;
END $$;
