SELECT pg_advisory_xact_lock(901002);
-- A prospective reference is an exact native producer input, never an accepted version.
-- Consumers may resolve it only after that producer wrote in this approved transaction.
CREATE FUNCTION care_organization.lifecycle_care_input_guard(p_basis jsonb,p_r timestamp) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE frame jsonb;t jsonb;m care_organization.lifecycle_member;accepted jsonb;BEGIN
 PERFORM care_organization.closed(p_basis,ARRAY['kind','owner','inputId','revisionId','digest','contractVersionId','id','version','campusId','producerValidFrom','producerValidTo','validFrom','validTo','managerId']);
 IF p_basis->>'kind' IS DISTINCT FROM 'LIFECYCLE_CARE_INPUT' OR p_basis->>'owner' NOT IN ('UNIT','NURSING','WARD') OR coalesce(current_setting('hdi.care_lifecycle',true),'')='' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 frame:=current_setting('hdi.care_lifecycle')::jsonb;t:=care_organization.lifecycle_attest(frame->>'ticket',frame->>'signature');
 IF t->>'phase' IS DISTINCT FROM 'APPLY' OR care_organization.local_time(t->>'recordAt') IS DISTINCT FROM p_r THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
 SELECT * INTO m FROM care_organization.lifecycle_member WHERE candidate_id=(t->>'candidateId')::uuid AND owner=p_basis->>'owner' AND member_id=(p_basis->>'inputId')::uuid;
 IF NOT FOUND OR m.revision::text IS DISTINCT FROM p_basis->>'revisionId' OR m.digest IS DISTINCT FROM p_basis->>'digest' OR m.contract_version_id::text IS DISTINCT FROM p_basis->>'contractVersionId' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 IF p_basis->>'owner'='UNIT' THEN
  SELECT to_jsonb(v) INTO accepted FROM care_organization.change c JOIN care_organization.version v ON v.change_id=c.id WHERE c.input_id=m.member_id AND c.candidate_id=m.candidate_id AND v.unit_id=(p_basis->>'id')::uuid AND v.number::text=p_basis->>'version';
 ELSIF p_basis->>'owner'='NURSING' THEN
  SELECT to_jsonb(v) INTO accepted FROM care_organization.nursing_change c JOIN care_organization.nursing_version v ON v.change_id=c.id WHERE c.input_id=m.member_id AND c.candidate_id=m.candidate_id AND v.unit_id=(p_basis->>'id')::uuid AND v.number::text=p_basis->>'version';
 ELSE
  SELECT to_jsonb(v) INTO accepted FROM care_organization.ward_change c JOIN care_organization.ward_version v ON v.change_id=c.id WHERE c.input_id=m.member_id AND c.candidate_id=m.candidate_id AND v.unit_id=(p_basis->>'id')::uuid AND v.number::text=p_basis->>'version';
 END IF;
 IF accepted IS NULL OR accepted->>'action' NOT IN ('REBIND','RESUME') OR (accepted->>'recorded_at')::timestamp IS DISTINCT FROM p_r OR (accepted->>'valid_from')::timestamp IS DISTINCT FROM care_organization.local_time(p_basis->>'producerValidFrom') OR (accepted->>'valid_to')::timestamp IS DISTINCT FROM (CASE WHEN p_basis->>'producerValidTo' IS NULL THEN NULL ELSE care_organization.local_time(p_basis->>'producerValidTo') END) OR NOT tsrange((accepted->>'valid_from')::timestamp,(accepted->>'valid_to')::timestamp,'[)') @> tsrange(care_organization.local_time(p_basis->>'validFrom'),CASE WHEN p_basis->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(p_basis->>'validTo') END,'[)') THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
END $$;
REVOKE ALL ON FUNCTION care_organization.lifecycle_care_input_guard(jsonb,timestamp) FROM PUBLIC,hdi_prototype;
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('location_master.use_mutate(text,text)'::regprocedure);
 needle:=$old$'digest','recordAt','recordAtProof']);$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_USE_RESOLUTION_TICKET_BASELINE';END IF;
 body:=replace(body,needle,$new$'digest','recordAt','recordAtProof','resolutions']);$new$);
 needle:=$old$FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_USE_RESOLUTION_WRITE_BASELINE';END IF;
 body:=replace(body,needle,$new$
 IF jsonb_typeof(coalesce(t->'resolutions','[]'::jsonb)) IS DISTINCT FROM 'array' OR (SELECT count(DISTINCT x->>'key') FROM jsonb_array_elements(coalesce(t->'resolutions','[]')) x)<>jsonb_array_length(coalesce(t->'resolutions','[]')) OR jsonb_array_length(coalesce(t->'resolutions','[]'))<>(SELECT count(*) FROM jsonb_array_elements(t->'writes') x WHERE x->'facts'->'dependencies'->'upstream'->>'kind'='LIFECYCLE_CARE_INPUT') THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
 FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP
  IF w->'facts'->'dependencies'->'upstream'->>'kind'='LIFECYCLE_CARE_INPUT' THEN
   IF w->'facts'->'dependencies'->'upstream'->>'id' IS DISTINCT FROM w->'applicability'->'target'->>'id' OR w->'facts'->'dependencies'->'upstream'->>'owner' IS DISTINCT FROM w->'applicability'->>'targetType' OR w->'facts'->'dependencies'->'upstream'->>'campusId' IS DISTINCT FROM w->'applicability'->'campus'->>'id' OR care_organization.local_time(w->'facts'->'dependencies'->'upstream'->>'validFrom') IS DISTINCT FROM care_organization.local_time(w->>'validFrom') OR care_organization.local_time(w->'facts'->'dependencies'->'upstream'->>'validTo') IS DISTINCT FROM care_organization.local_time(w->>'validTo') THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
   PERFORM care_organization.lifecycle_care_input_guard(w->'facts'->'dependencies'->'upstream',record_at);
   SELECT x INTO fresh FROM jsonb_array_elements(t->'resolutions') x WHERE x->>'key'=w->>'key';
   PERFORM location_master.use_closed(fresh,ARRAY['key','basis']);IF fresh IS NULL OR jsonb_typeof(fresh->'basis') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
   w:=jsonb_set(w,'{facts,dependencies,upstream}',fresh->'basis');
  END IF;
$new$);EXECUTE body;
END $$;
