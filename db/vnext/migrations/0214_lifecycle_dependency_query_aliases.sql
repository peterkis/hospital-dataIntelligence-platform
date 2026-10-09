SELECT pg_advisory_xact_lock(901002);
CREATE OR REPLACE FUNCTION care_organization.lifecycle_dependencies(p_actor text,p_kind text,p_id uuid,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u record;h jsonb;v jsonb;head jsonb;b jsonb;period tsrange;closing timestamp;result jsonb:='[]';BEGIN
 IF p_kind NOT IN ('UNIT','NURSING','WARD','LOCATION') OR p_from IS NULL OR p_to<=p_from OR p_r IS NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF p_kind='UNIT' THEN PERFORM care_organization.snapshot_at(p_actor,p_id,p_r);ELSIF p_kind='NURSING' THEN PERFORM care_organization.nursing_snapshot_at(p_actor,p_id,p_r);ELSIF p_kind='WARD' THEN PERFORM care_organization.ward_snapshot_at(p_actor,p_id,p_r);END IF;
 IF p_kind='UNIT' THEN FOR u IN SELECT DISTINCT unit_id id FROM care_organization.ward_unit_binding WHERE managing_unit_id=p_id ORDER BY unit_id LOOP
  h:=care_organization.ward_snapshot_at(p_actor,u.id,p_r);head:=h->'versions'->(jsonb_array_length(h->'versions')-1);
  FOR b IN SELECT value FROM jsonb_array_elements(h->'bindings') WHERE value->>'managingUnitId'=p_id::text LOOP
   v:=b->'versions'->(jsonb_array_length(b->'versions')-1);period:=tsrange((v->>'validFrom')::timestamp,(v->>'validTo')::timestamp,'[)');
   IF period&&tsrange(p_from,p_to,'[)') THEN result:=result||jsonb_build_array(jsonb_build_object('owner','WARD','id',u.id,'head',head->>'number','referenceId',b->>'id','referenceVersionId',v->>'id','from',v->>'validFrom','to',v->>'validTo','campusId',b->>'campusId','disposition','OPEN'));END IF;
  END LOOP;
 END LOOP;END IF;
 FOR u IN SELECT * FROM care_organization.unit_ward candidate_row WHERE (p_kind='UNIT' AND (candidate_row.unit_id=p_id OR EXISTS(SELECT 1 FROM care_organization.unit_ward_version v WHERE v.unit_ward_id=candidate_row.id AND v.recorded_at<=p_r AND v.facts->'rule'->'participants' ? p_id::text))) OR (p_kind='WARD' AND candidate_row.ward_id=p_id) ORDER BY candidate_row.id LOOP
  h:=care_organization.unit_ward_snapshot_at(p_actor,u.id,p_r);SELECT value INTO v FROM jsonb_array_elements(h->'versions') WHERE value->>'action' IN ('CREATE','REVISE') ORDER BY (value->>'number')::bigint DESC LIMIT 1;IF v IS NULL THEN CONTINUE;END IF;
  head:=h->'versions'->(jsonb_array_length(h->'versions')-1);SELECT min((value->>'validFrom')::timestamp) INTO closing FROM jsonb_array_elements(h->'versions') WHERE value->>'action'='END';
  period:=tsrange((v->>'validFrom')::timestamp,least((v->>'validTo')::timestamp,closing),'[)');
  IF period&&tsrange(p_from,p_to,'[)') THEN result:=result||jsonb_build_array(jsonb_build_object('owner','UNIT_WARD','id',u.id,'head',head->>'number','referenceId',u.id,'referenceVersionId',v->>'id','from',to_char(lower(period),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(upper(period),'YYYY-MM-DD"T"HH24:MI:SS.US'),'campusId',u.campus_id,'disposition','OPEN'));END IF;
 END LOOP;
 FOR u IN SELECT * FROM care_organization.ward_nursing candidate_row WHERE (p_kind='NURSING' AND (candidate_row.nursing_unit_id=p_id OR EXISTS(SELECT 1 FROM care_organization.ward_nursing_version v WHERE v.ward_nursing_id=candidate_row.id AND v.recorded_at<=p_r AND v.facts->'rule'->'participants' ? p_id::text))) OR (p_kind='WARD' AND candidate_row.ward_id=p_id) ORDER BY candidate_row.id LOOP
  h:=care_organization.ward_nursing_snapshot_at(p_actor,u.id,p_r);SELECT value INTO v FROM jsonb_array_elements(h->'versions') WHERE value->>'action' IN ('CREATE','REVISE') ORDER BY (value->>'number')::bigint DESC LIMIT 1;IF v IS NULL THEN CONTINUE;END IF;
  head:=h->'versions'->(jsonb_array_length(h->'versions')-1);SELECT min((value->>'validFrom')::timestamp) INTO closing FROM jsonb_array_elements(h->'versions') WHERE value->>'action'='END';
  period:=tsrange((v->>'validFrom')::timestamp,least((v->>'validTo')::timestamp,closing),'[)');
  IF period&&tsrange(p_from,p_to,'[)') THEN result:=result||jsonb_build_array(jsonb_build_object('owner','WARD_NURSING','id',u.id,'head',head->>'number','referenceId',u.id,'referenceVersionId',v->>'id','from',to_char(lower(period),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(upper(period),'YYYY-MM-DD"T"HH24:MI:SS.US'),'campusId',u.campus_id,'disposition','OPEN'));END IF;
 END LOOP;
 FOR u IN SELECT * FROM care_organization.capability candidate_row WHERE p_kind='UNIT' AND candidate_row.unit_id=p_id ORDER BY candidate_row.id LOOP
  h:=care_organization.capability_snapshot_at(p_actor,u.id,p_r);SELECT value INTO v FROM jsonb_array_elements(h->'versions') WHERE value->>'action' IN ('GRANT','REVISE') ORDER BY (value->>'number')::bigint DESC LIMIT 1;IF v IS NULL THEN CONTINUE;END IF;
  head:=h->'versions'->(jsonb_array_length(h->'versions')-1);SELECT min((value->>'validFrom')::timestamp) INTO closing FROM jsonb_array_elements(h->'versions') WHERE value->>'action'='END';
  period:=tsrange((v->>'validFrom')::timestamp,least((v->>'validTo')::timestamp,closing),'[)');
  IF period&&tsrange(p_from,p_to,'[)') THEN result:=result||jsonb_build_array(jsonb_build_object('owner','CAPABILITY','id',u.id,'head',head->>'number','referenceId',u.id,'referenceVersionId',v->>'id','from',to_char(lower(period),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(upper(period),'YYYY-MM-DD"T"HH24:MI:SS.US'),'campusId',u.campus_id,'disposition','OPEN'));END IF;
 END LOOP;
 FOR u IN SELECT * FROM care_organization.subject_relation candidate_row WHERE p_kind='UNIT' AND candidate_row.scope->'target'->>'type'='UNIT' AND candidate_row.scope->'target'->>'id'=p_id::text ORDER BY candidate_row.id LOOP
  h:=care_organization.subject_snapshot(p_actor,u.id,p_r);SELECT value INTO v FROM jsonb_array_elements(h->'versions') WHERE value->>'action' IN ('RECORD','REVISE') ORDER BY (value->>'number')::bigint DESC LIMIT 1;IF v IS NULL THEN CONTINUE;END IF;
  head:=h->'versions'->(jsonb_array_length(h->'versions')-1);SELECT min((value->>'validFrom')::timestamp) INTO closing FROM jsonb_array_elements(h->'versions') WHERE value->>'action'='RETIRE';
  period:=tsrange((v->>'validFrom')::timestamp,least((v->>'validTo')::timestamp,closing),'[)');
  IF period&&tsrange(p_from,p_to,'[)') THEN result:=result||jsonb_build_array(jsonb_build_object('owner','PERMISSION','id',u.id,'head',head->>'number','referenceId',u.id,'referenceVersionId',v->>'id','from',to_char(lower(period),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(upper(period),'YYYY-MM-DD"T"HH24:MI:SS.US'),'campusId',u.scope->'campus'->>'id','disposition','OPEN'));END IF;
 END LOOP;
 IF jsonb_array_length(result)>2000 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;RETURN result;
END $$;
CREATE OR REPLACE FUNCTION location_master.lifecycle_dependencies(p_actor text,p_kind text,p_id uuid,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u record;h jsonb;v jsonb;head jsonb;period tsrange;closing timestamp;result jsonb:='[]';BEGIN
 IF p_kind NOT IN ('UNIT','NURSING','WARD','LOCATION') OR p_from IS NULL OR p_to<=p_from OR p_r IS NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR u IN SELECT * FROM location_master.use_relation candidate_row WHERE (p_kind='LOCATION' AND candidate_row.location_id=p_id) OR (candidate_row.target_type=p_kind AND candidate_row.target_id=p_id) ORDER BY candidate_row.id LOOP
  h:=location_master.use_snapshot_at(p_actor,u.id,p_r);SELECT value INTO v FROM jsonb_array_elements(h->'versions') WHERE value->>'action' IN ('CREATE','REVISE') ORDER BY (value->>'number')::bigint DESC LIMIT 1;IF v IS NULL THEN CONTINUE;END IF;
  head:=h->'versions'->(jsonb_array_length(h->'versions')-1);SELECT min((value->>'validFrom')::timestamp) INTO closing FROM jsonb_array_elements(h->'versions') WHERE value->>'action'='END';
  period:=tsrange((v->>'validFrom')::timestamp,least((v->>'validTo')::timestamp,closing),'[)');
  IF period&&tsrange(p_from,p_to,'[)') THEN result:=result||jsonb_build_array(jsonb_build_object('owner','LOCATION_USE','id',u.id,'head',head->>'number','referenceId',u.id,'referenceVersionId',v->>'id','from',to_char(lower(period),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(upper(period),'YYYY-MM-DD"T"HH24:MI:SS.US'),'campusId',u.campus_id,'disposition','OPEN'));END IF;
 END LOOP;
 IF p_kind='LOCATION' THEN FOR u IN SELECT DISTINCT l.id FROM location_master.location l JOIN location_master.version v ON v.location_id=l.id WHERE v.parent_id=p_id AND v.recorded_at<=p_r ORDER BY l.id LOOP
  h:=location_master.snapshot(p_actor,u.id);SELECT value INTO v FROM jsonb_array_elements(h->'versions') WHERE (value->>'recordedAt')::timestamp<=p_r AND value->>'action' IN ('CREATE','REVISE','MOVE_CONTAINMENT') ORDER BY (value->>'number')::bigint DESC LIMIT 1;IF v IS NULL OR v->>'parentId' IS DISTINCT FROM p_id::text THEN CONTINUE;END IF;
  head:=h->'versions'->(jsonb_array_length(h->'versions')-1);SELECT min((value->>'validFrom')::timestamp) INTO closing FROM jsonb_array_elements(h->'versions') WHERE value->>'action'='CLOSE' AND (value->>'recordedAt')::timestamp<=p_r;
  period:=tsrange((v->>'validFrom')::timestamp,least((v->>'validTo')::timestamp,closing),'[)');
  IF period&&tsrange(p_from,p_to,'[)') THEN result:=result||jsonb_build_array(jsonb_build_object('owner','LOCATION','id',u.id,'head',head->>'number','referenceId',u.id,'referenceVersionId',v->>'id','from',to_char(lower(period),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(upper(period),'YYYY-MM-DD"T"HH24:MI:SS.US'),'campusId',h->>'campusId','disposition','OPEN'));END IF;
 END LOOP;END IF;
 IF jsonb_array_length(result)>2000 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;RETURN result;
END $$;
REVOKE ALL ON FUNCTION care_organization.lifecycle_dependencies(text,text,uuid,timestamp,timestamp,timestamp),location_master.lifecycle_dependencies(text,text,uuid,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
