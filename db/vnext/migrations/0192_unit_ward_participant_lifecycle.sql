SELECT pg_advisory_xact_lock(901002);

-- Effective reference coverage follows the Unit property/lifecycle stream,
-- including closure masks over future bindings. Frozen binding pins stay raw.
CREATE OR REPLACE FUNCTION care_organization.unit_ward_participant_campus_guard(p_actor text,p_scope jsonb,p_rule jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE participant text;h jsonb;property jsonb;later jsonb;b jsonb;v jsonb;spans tsmultirange;core tsmultirange;periods tsmultirange;closing timestamp;BEGIN
 IF p_rule->>'kind' IS DISTINCT FROM 'SHARED_BOUNDARY' THEN RETURN;END IF;
 PERFORM organization_master.campus_snapshot(p_actor,(p_scope->'campus'->>'id')::uuid);
 FOR participant IN SELECT value FROM jsonb_array_elements_text(p_rule->'participants') LOOP
  h:=care_organization.snapshot_at(p_actor,participant::uuid,p_r);core:='{}';periods:='{}';
  FOR property IN SELECT value FROM jsonb_array_elements(h->'versions') WHERE value->>'action' IN ('CREATE','REVISE') LOOP
   spans:=tsmultirange(tsrange((property->>'validFrom')::timestamp,(property->>'validTo')::timestamp,'[)'));
   FOR later IN SELECT value FROM jsonb_array_elements(h->'versions') WHERE (value->>'number')::bigint>(property->>'number')::bigint AND value->>'action'<>'REBIND' LOOP
    spans:=spans-tsmultirange(tsrange((later->>'validFrom')::timestamp,CASE WHEN later->>'action'='CLOSE' THEN NULL ELSE (later->>'validTo')::timestamp END,'[)'));
   END LOOP;
   core:=core+spans;
  END LOOP;
  SELECT min((value->>'validFrom')::timestamp) INTO closing FROM jsonb_array_elements(h->'versions') WHERE value->>'action'='CLOSE';
  IF closing IS NOT NULL THEN core:=core*tsmultirange(tsrange((h->'versions'->0->>'validFrom')::timestamp,closing,'[)'));END IF;
  FOR b IN SELECT value FROM jsonb_array_elements(h->'bindings') WHERE value->>'campusId'=p_scope->'campus'->>'id' LOOP
   v:=b->'versions'->(jsonb_array_length(b->'versions')-1);periods:=periods+(core*tsmultirange(tsrange((v->>'validFrom')::timestamp,(v->>'validTo')::timestamp,'[)')));
  END LOOP;
  IF NOT periods @> tsrange(p_from,p_to,'[)') THEN RAISE EXCEPTION 'CROSS_CAMPUS_POLICY_REQUIRED';END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION care_organization.unit_ward_participant_campus_guard(text,jsonb,jsonb,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
