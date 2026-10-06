SELECT pg_advisory_xact_lock(901002);

CREATE FUNCTION care_organization.unit_ward_participant_pins(p_actor text,p_scope jsonb,p_rule jsonb,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE participant text;h jsonb;b jsonb;v jsonb;c jsonb;parts jsonb;result jsonb:='[]';BEGIN
 IF p_rule->>'kind' IS DISTINCT FROM 'SHARED_BOUNDARY' THEN RETURN result;END IF;
 c:=organization_master.campus_snapshot(p_actor,(p_scope->'campus'->>'id')::uuid);
 FOR participant IN SELECT value FROM jsonb_array_elements_text(p_rule->'participants') LOOP
  h:=care_organization.snapshot_at(p_actor,participant::uuid,p_r);parts:='[]';
  FOR b IN SELECT value FROM jsonb_array_elements(h->'bindings') WHERE value->>'campusId'=p_scope->'campus'->>'id' LOOP
   v:=b->'versions'->(jsonb_array_length(b->'versions')-1);
   parts:=parts||jsonb_build_array(jsonb_build_object('id',b->>'id','versionId',v->>'id','version',v->>'number','from',v->>'validFrom','to',v->'validTo'));
  END LOOP;
  result:=result||jsonb_build_array(jsonb_build_object('id',participant,'basis',jsonb_build_object('scope',c->>'scope','parts',parts)));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION care_organization.unit_ward_participant_pins(text,jsonb,jsonb,timestamp) FROM PUBLIC,hdi_prototype;

-- Recheck the exact approved participant binding IDs/versions in addition to
-- current coverage. END bypasses admission and keeps its original evidence.
DO $repair$
DECLARE body text;needle text;replacement text;BEGIN
 body:=pg_get_functiondef('care_organization.unit_ward_mutate(text,text)'::regprocedure);
 needle:=$old$PERFORM care_organization.unit_ward_operating_guard(actor,w->'facts'->'dependencies'->'upstream',record_at);$old$;
 replacement:=needle||chr(10)||$new$IF care_organization.unit_ward_participant_pins(actor,u.applicability,w->'facts'->'rule',record_at) IS DISTINCT FROM w->'facts'->'dependencies'->'upstream'->'participants' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;$new$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_WARD_PARTICIPANT_PINS_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,replacement);
END $repair$;
