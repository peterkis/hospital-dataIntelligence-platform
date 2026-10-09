SELECT pg_advisory_xact_lock(901002);
-- Location Owner resolves exact prospective native producers at the root's common R.
CREATE FUNCTION location_master.lifecycle_location_input_guard(p_actor text,p_basis jsonb,p_r timestamp) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb;m care_organization.lifecycle_member;p jsonb;v location_master.version;n location_master.location;BEGIN
 PERFORM location_master.use_closed(p_basis,ARRAY['kind','id','campusId','validFrom','validTo','inputs','prior']);
 IF p_basis->>'kind' IS DISTINCT FROM 'LIFECYCLE_LOCATION_INPUT' OR jsonb_typeof(p_basis->'inputs') IS DISTINCT FROM 'array' OR jsonb_array_length(p_basis->'inputs') NOT BETWEEN 1 AND 100 OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_basis->'inputs') x)<>jsonb_array_length(p_basis->'inputs') THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
 t:=care_organization.lifecycle_context(p_actor);IF t->>'phase' IS DISTINCT FROM 'APPLY' OR care_organization.local_time(t->>'recordAt') IS DISTINCT FROM p_r THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(p_basis->'inputs') LOOP
  PERFORM location_master.use_closed(p,ARRAY['inputId','revisionId','digest','contractVersionId','id','version','campusId','producerValidFrom','producerValidTo']);
  SELECT * INTO m FROM care_organization.lifecycle_member WHERE candidate_id=(t->>'candidateId')::uuid AND owner='LOCATION' AND member_id=(p->>'inputId')::uuid;
  IF NOT FOUND OR m.revision::text IS DISTINCT FROM p->>'revisionId' OR m.digest IS DISTINCT FROM p->>'digest' OR m.contract_version_id::text IS DISTINCT FROM p->>'contractVersionId' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  SELECT x.* INTO v FROM location_master.change c JOIN location_master.version x ON x.change_id=c.id WHERE c.input_id=m.member_id AND c.candidate_id=m.candidate_id AND x.location_id=(p->>'id')::uuid AND x.number::text=p->>'version';
  IF NOT FOUND OR v.action<>'MOVE_CONTAINMENT' OR v.recorded_at IS DISTINCT FROM p_r OR v.valid_from IS DISTINCT FROM location_master.local_time(p->>'producerValidFrom') OR v.valid_to IS DISTINCT FROM location_master.local_time(p->>'producerValidTo') OR NOT tsrange(v.valid_from,v.valid_to,'[)') && tsrange(location_master.local_time(p_basis->>'validFrom'),location_master.local_time(p_basis->>'validTo'),'[)') THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  SELECT * INTO n FROM location_master.location WHERE id=v.location_id;IF n.campus_id::text IS DISTINCT FROM p->>'campusId' OR p->>'campusId' IS DISTINCT FROM p_basis->>'campusId' THEN RAISE EXCEPTION 'LOCATION_CAMPUS_MISMATCH';END IF;
  PERFORM location_master.authorize(p_actor,n.campus_id,n.scope,'READ');
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION location_master.lifecycle_location_input_guard(text,jsonb,timestamp) FROM PUBLIC,hdi_prototype;
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('location_master.use_mutate(text,text)'::regprocedure);
 needle:=$old$'recordAtProof']||(CASE WHEN t ? 'resolutions' THEN ARRAY['resolutions'] ELSE ARRAY[]::text[] END));$old$;IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_LOCATION_RESOLUTION_TICKET_BASELINE';END IF;
 body:=replace(body,needle,$new$'recordAtProof']||(CASE WHEN t ? 'resolutions' THEN ARRAY['resolutions'] ELSE ARRAY[]::text[] END)||(CASE WHEN t ? 'locationResolutions' THEN ARRAY['locationResolutions'] ELSE ARRAY[]::text[] END));$new$);
 needle:=$old$FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP$old$;IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_LOCATION_RESOLUTION_WRITE_BASELINE';END IF;
 body:=replace(body,needle,$new$
 IF jsonb_typeof(coalesce(t->'locationResolutions','[]'::jsonb)) IS DISTINCT FROM 'array' OR (SELECT count(DISTINCT x->>'key') FROM jsonb_array_elements(coalesce(t->'locationResolutions','[]')) x)<>jsonb_array_length(coalesce(t->'locationResolutions','[]')) OR jsonb_array_length(coalesce(t->'locationResolutions','[]'))<>(SELECT count(*) FROM jsonb_array_elements(t->'writes') x WHERE x->'facts'->'dependencies'->'location'->>'kind'='LIFECYCLE_LOCATION_INPUT') THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
 FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP
  IF w->'facts'->'dependencies'->'location'->>'kind'='LIFECYCLE_LOCATION_INPUT' THEN
   IF w->'facts'->'dependencies'->'location'->>'id' IS DISTINCT FROM w->'applicability'->'location'->>'id' OR w->'facts'->'dependencies'->'location'->>'campusId' IS DISTINCT FROM w->'applicability'->'campus'->>'id' OR location_master.local_time(w->'facts'->'dependencies'->'location'->>'validFrom') IS DISTINCT FROM location_master.local_time(w->>'validFrom') OR location_master.local_time(w->'facts'->'dependencies'->'location'->>'validTo') IS DISTINCT FROM location_master.local_time(w->>'validTo') THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
   PERFORM location_master.lifecycle_location_input_guard(actor,w->'facts'->'dependencies'->'location',record_at);
   SELECT x INTO fresh FROM jsonb_array_elements(t->'locationResolutions') x WHERE x->>'key'=w->>'key';PERFORM location_master.use_closed(fresh,ARRAY['key','basis']);IF fresh IS NULL OR jsonb_typeof(fresh->'basis') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
   w:=jsonb_set(w,'{facts,dependencies,location}',fresh->'basis');
  END IF;
 $new$);EXECUTE body;
END $$;
