SELECT pg_advisory_xact_lock(901002);

-- Reference association only: every declared sharing participant must have
-- approved Unit bindings covering this Campus/window at the same record time.
-- END never enters admission, so parent shutdown cannot prevent safe shrinking.
CREATE FUNCTION care_organization.unit_ward_participant_campus_guard(p_actor text,p_scope jsonb,p_rule jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE participant text;h jsonb;b jsonb;v jsonb;periods tsmultirange;BEGIN
 IF p_rule->>'kind' IS DISTINCT FROM 'SHARED_BOUNDARY' THEN RETURN;END IF;
 PERFORM organization_master.campus_snapshot(p_actor,(p_scope->'campus'->>'id')::uuid);
 FOR participant IN SELECT value FROM jsonb_array_elements_text(p_rule->'participants') LOOP
  h:=care_organization.snapshot_at(p_actor,participant::uuid,p_r);periods:='{}';
  FOR b IN SELECT value FROM jsonb_array_elements(h->'bindings') WHERE value->>'campusId'=p_scope->'campus'->>'id' LOOP
   v:=b->'versions'->(jsonb_array_length(b->'versions')-1);periods:=periods+tsmultirange(tsrange((v->>'validFrom')::timestamp,(v->>'validTo')::timestamp,'[)'));
  END LOOP;
  IF NOT periods @> tsrange(p_from,p_to,'[)') THEN RAISE EXCEPTION 'CROSS_CAMPUS_POLICY_REQUIRED';END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION care_organization.unit_ward_participant_campus_guard(text,jsonb,jsonb,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;

DO $repair$
DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.unit_ward_admission(text,jsonb,jsonb,timestamp,timestamp,timestamp)'::regprocedure);
 needle:=$old$unit_basis:=care_organization.ward_management_coverage(p_actor,(p_scope->'unit'->>'id')::uuid,(p_scope->'campus'->>'id')::uuid,p_from,p_to,p_r);$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_WARD_PARTICIPANT_REPAIR_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'PERFORM care_organization.unit_ward_participant_campus_guard(p_actor,p_scope,p_rule,p_from,p_to,p_r);'||chr(10)||needle);
END $repair$;
