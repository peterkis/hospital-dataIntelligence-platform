SELECT pg_advisory_xact_lock(901002);
-- Care owns root membership. Location calls this finite port instead of its table.
CREATE FUNCTION care_organization.lifecycle_location_member_candidate(p_actor text,p_basis jsonb,p_r timestamp) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb;m care_organization.lifecycle_member;BEGIN
 PERFORM care_organization.closed(p_basis,ARRAY['inputId','revisionId','digest','contractVersionId','id','version','campusId','producerValidFrom','producerValidTo']);
 t:=care_organization.lifecycle_context(p_actor);IF t->>'phase' IS DISTINCT FROM 'APPLY' OR care_organization.local_time(t->>'recordAt') IS DISTINCT FROM p_r THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
 SELECT * INTO m FROM care_organization.lifecycle_member WHERE candidate_id=(t->>'candidateId')::uuid AND owner='LOCATION' AND member_id=(p_basis->>'inputId')::uuid;
 IF NOT FOUND OR m.revision::text IS DISTINCT FROM p_basis->>'revisionId' OR m.digest IS DISTINCT FROM p_basis->>'digest' OR m.contract_version_id::text IS DISTINCT FROM p_basis->>'contractVersionId' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 RETURN m.candidate_id;
END $$;
REVOKE ALL ON FUNCTION care_organization.lifecycle_location_member_candidate(text,jsonb,timestamp) FROM PUBLIC,hdi_prototype;
CREATE OR REPLACE FUNCTION location_master.lifecycle_location_input_guard(p_actor text,p_basis jsonb,p_r timestamp) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate uuid;p jsonb;v location_master.version;n location_master.location;BEGIN
 PERFORM location_master.use_closed(p_basis,ARRAY['kind','id','campusId','validFrom','validTo','inputs','prior']);
 IF p_basis->>'kind' IS DISTINCT FROM 'LIFECYCLE_LOCATION_INPUT' OR jsonb_typeof(p_basis->'inputs') IS DISTINCT FROM 'array' OR jsonb_array_length(p_basis->'inputs') NOT BETWEEN 1 AND 100 OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_basis->'inputs') x)<>jsonb_array_length(p_basis->'inputs') THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(p_basis->'inputs') LOOP
  PERFORM location_master.use_closed(p,ARRAY['inputId','revisionId','digest','contractVersionId','id','version','campusId','producerValidFrom','producerValidTo']);
  candidate:=care_organization.lifecycle_location_member_candidate(p_actor,p,p_r);
  SELECT x.* INTO v FROM location_master.change c JOIN location_master.version x ON x.change_id=c.id WHERE c.input_id=(p->>'inputId')::uuid AND c.candidate_id=candidate AND x.location_id=(p->>'id')::uuid AND x.number::text=p->>'version';
  IF NOT FOUND OR v.action<>'MOVE_CONTAINMENT' OR v.recorded_at IS DISTINCT FROM p_r OR v.valid_from IS DISTINCT FROM location_master.local_time(p->>'producerValidFrom') OR v.valid_to IS DISTINCT FROM (CASE WHEN p->>'producerValidTo' IS NULL THEN NULL ELSE location_master.local_time(p->>'producerValidTo') END) OR NOT tsrange(v.valid_from,v.valid_to,'[)') && tsrange(location_master.local_time(p_basis->>'validFrom'),CASE WHEN p_basis->>'validTo' IS NULL THEN NULL ELSE location_master.local_time(p_basis->>'validTo') END,'[)') THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  SELECT * INTO n FROM location_master.location WHERE id=v.location_id;IF n.campus_id::text IS DISTINCT FROM p->>'campusId' OR p->>'campusId' IS DISTINCT FROM p_basis->>'campusId' THEN RAISE EXCEPTION 'LOCATION_CAMPUS_MISMATCH';END IF;
  PERFORM location_master.authorize(p_actor,n.campus_id,n.scope,'READ');
 END LOOP;
END $$;
