SELECT pg_advisory_xact_lock(901002);

-- A selected assertion authorizes only the complete version it returns.
-- Full-history authorization remains the responsibility of identifier_snapshot callers.
CREATE FUNCTION department_master.identifier_selected(p_actor text,p_id uuid,p_campus text,p_record timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m department_master.organization_identifier;v department_master.organization_identifier_version;BEGIN
 SELECT * INTO m FROM department_master.organization_identifier WHERE id=p_id;IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM department_master.identifier_authorize(p_actor,m.scheme,p_campus,'READ');
 PERFORM department_master.mapping_target_authorize(p_actor,m.target_type,m.target_id,p_campus);
 SELECT * INTO v FROM department_master.organization_identifier_version WHERE identifier_id=m.id AND (p_record IS NULL OR recorded_at<=p_record) ORDER BY number DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM department_master.mapping_source(p_actor,(v.facts->>'sourceSystemId')::uuid,v.valid_from,v.valid_to,false);
 RETURN to_jsonb(m)||jsonb_build_object('versions',jsonb_build_array((to_jsonb(v)-ARRAY['input_id','legacy_version_id'])||jsonb_build_object('number',v.number::text)));
END $$;

CREATE FUNCTION department_master.department_code_at_authorized(p_actor text,p_id uuid,p_business timestamp,p_record timestamp,p_campus text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d department_master.department;legacy department_master.version;baseline timestamp;selected jsonb;v jsonb;selected_id uuid;BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');
 SELECT * INTO d FROM department_master.department WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT min(v2.recorded_at) INTO baseline FROM department_master.organization_identifier m2 JOIN department_master.organization_identifier_version v2 ON v2.identifier_id=m2.id WHERE m2.target_type='ORG' AND m2.target_id=p_id AND m2.kind='HOSPITAL_CODE';
 IF p_record IS NOT NULL AND p_record<baseline THEN
  SELECT * INTO legacy FROM department_master.version WHERE department_id=p_id AND recorded_at<=p_record ORDER BY number LIMIT 1;
  RETURN jsonb_build_object('initialCode',d.code,'effectiveCode',CASE WHEN legacy.id IS NOT NULL AND tsrange(legacy.valid_from,legacy.valid_to,'[)')@>p_business THEN d.code ELSE NULL END,'codeVersion',NULL,'codeEvidence','ORG04_HISTORICAL');
 END IF;
 -- HOSPITAL/READ does not imply access to ORG23 derived facts, even when none
 -- is currently effective. Missing context or withdrawn authority is denial.
 PERFORM department_master.identifier_authorize(p_actor,'SYNTHETIC_DEPARTMENT_CODE',p_campus,'READ');
 PERFORM department_master.mapping_target_authorize(p_actor,'ORG',p_id,p_campus);
 SELECT x.id INTO selected_id FROM department_master.organization_identifier x CROSS JOIN LATERAL (SELECT * FROM department_master.organization_identifier_version WHERE identifier_id=x.id AND (p_record IS NULL OR recorded_at<=p_record) ORDER BY number DESC LIMIT 1) current WHERE x.target_type='ORG' AND x.target_id=p_id AND x.kind='HOSPITAL_CODE' AND current.action<>'RETRACT' AND tsrange(current.valid_from,current.valid_to,'[)')@>p_business;
 IF selected_id IS NOT NULL THEN selected:=department_master.identifier_selected(p_actor,selected_id,p_campus,p_record);v:=selected->'versions'->0;END IF;
 RETURN jsonb_build_object('initialCode',d.code,'effectiveCode',v->>'value','codeVersion',CASE WHEN v IS NULL THEN NULL ELSE jsonb_build_object('id',selected_id,'version',v->>'number','versionId',v->>'id') END,'codeEvidence','ORG23_ASSERTION');
END $$;

-- Close the old context-free entry point for roles that retained its grant.
CREATE OR REPLACE FUNCTION department_master.department_code_at(p_actor text,p_id uuid,p_business timestamp,p_record timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'ACCESS_DENIED';
END $$;
REVOKE ALL ON FUNCTION department_master.identifier_selected(text,uuid,text,timestamp),department_master.department_code_at_authorized(text,uuid,timestamp,timestamp,text) FROM PUBLIC,hdi_prototype;


