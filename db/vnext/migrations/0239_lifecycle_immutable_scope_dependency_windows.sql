SELECT pg_advisory_xact_lock(901002);
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.lifecycle_dependencies(text,text,uuid,timestamp,timestamp,timestamp)'::regprocedure);
 needle:='DECLARE u record;';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_SCOPE_DEPENDENCY_DECLARATION_BASELINE';END IF;
 body:=replace(body,needle,'DECLARE scope_head bigint;scope_row jsonb;scope_ref uuid;u record;');
 needle:='IF jsonb_array_length(result)>2000 THEN';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_SCOPE_DEPENDENCY_RESULT_BASELINE';END IF;
 body:=replace(body,needle,$new$IF p_kind='WARD' THEN
  FOR u IN SELECT * FROM care_organization.ward_nursing_scope_set WHERE ward_id=p_id AND recorded_at<=p_r ORDER BY id LOOP
   SELECT coalesce(max(number),1) INTO scope_head FROM care_organization.ward_nursing_scope_version WHERE scope_set_id=u.id AND recorded_at<=p_r;
   FOR scope_row IN SELECT value FROM jsonb_array_elements(care_organization.ward_nursing_scope_versions_for_ward(p_actor,p_id,p_r)) WHERE value->>'id'=u.id::text LOOP
    period:=tsrange((scope_row->>'validFrom')::timestamp,(scope_row->>'validTo')::timestamp,'[)');
    IF period&&tsrange(p_from,p_to,'[)') THEN
     IF scope_row->>'version'='1' THEN scope_ref:=u.change_id;ELSE SELECT input_id INTO scope_ref FROM care_organization.ward_nursing_scope_version WHERE scope_set_id=u.id AND number=(scope_row->>'version')::bigint;END IF;
     result:=result||jsonb_build_array(jsonb_build_object('owner','WARD_NURSING','id',u.id,'head',scope_head::text,'referenceId',u.id,'referenceVersionId',scope_ref,'from',scope_row->>'validFrom','to',scope_row->>'validTo','campusId',scope_row->'applicability'->'campus'->>'id','disposition','OPEN'));
    END IF;
   END LOOP;
  END LOOP;
 END IF;
 IF jsonb_array_length(result)>2000 THEN$new$);EXECUTE body;
END $$;
