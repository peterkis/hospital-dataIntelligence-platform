SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION department_master.campus_relation_impact_references(p_actor text,p_departments jsonb,p_campus text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row record;latest department_master.campus_relation_version;result jsonb:='[]'::jsonb;snapshot jsonb;
BEGIN
 FOR row IN SELECT v.*,r.department_id,r.governance_scope FROM department_master.campus_relation_version v JOIN department_master.campus_relation r ON r.id=v.relation_id WHERE r.department_id IN(SELECT value::uuid FROM jsonb_array_elements_text(p_departments)) ORDER BY r.id,v.number LOOP
  snapshot:=department_master.lifecycle_relation_snapshot(p_actor,row.relation_id,p_campus,'READ');
  SELECT * INTO latest FROM department_master.campus_relation_version WHERE relation_id=row.relation_id ORDER BY number DESC LIMIT 1;
  result:=result||jsonb_build_array(jsonb_build_object('owner','CAMPUS_RELATION','id',row.relation_id,'versionId',row.id,'version',row.number::text,'referenceRole','TARGET','sourceSystemIds','[]'::jsonb,'departmentId',row.department_id,'departmentVersionId',NULL,'acceptedVersions',coalesce(row.dependencies->'departmentParts','[]'::jsonb),'originalPeriod',jsonb_build_object('from',to_char(row.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(row.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US')),'originalDigest',encode(sha256(convert_to(row.dependencies::text,'UTF8')),'hex'),'frozenLabel',NULL,'currentVersionId',latest.id,'currentPeriod',jsonb_build_object('from',to_char(latest.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(latest.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US')),'currentAction',latest.action,'currentTargetId',row.department_id,'currentReferencesDepartment',true,'current',row.id=latest.id));
  IF jsonb_array_length(result)>2000 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;
 END LOOP;
 RETURN result;
END $$;

CREATE FUNCTION department_master.campus_relation_impact_result(p_actor text,p_ref jsonb,p_campus text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE snapshot jsonb;r department_master.campus_relation;v department_master.campus_relation_version;original department_master.campus_relation_version;c governance_catalog.department_impact_case;o department_master.lifecycle_operation;outcome jsonb;safe boolean;
BEGIN
 snapshot:=department_master.lifecycle_relation_snapshot(p_actor,(p_ref->>'id')::uuid,p_campus,'READ');
 SELECT * INTO r FROM department_master.campus_relation WHERE id=(p_ref->>'id')::uuid;
 SELECT * INTO v FROM department_master.campus_relation_version WHERE relation_id=r.id AND id=(p_ref->>'versionId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 SELECT * INTO o FROM department_master.lifecycle_operation WHERE id=v.operation_id;
 IF v.number<>(SELECT max(number) FROM department_master.campus_relation_version WHERE relation_id=r.id) THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 outcome:=governance_catalog.department_impact_committed_result(p_actor,(p_ref->>'candidateId')::uuid,(p_ref->>'requestId')::uuid);
 IF outcome->>'status' IS DISTINCT FROM 'COMMITTED' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(outcome->'facts') fact WHERE fact->>'owner'='department-master/lifecycle' AND fact->>'id'=o.id::text) THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 SELECT * INTO c FROM governance_catalog.department_impact_case WHERE id=(p_ref->>'caseId')::uuid;
 SELECT * INTO original FROM department_master.campus_relation_version WHERE id=(c.obligation->'reference'->>'versionId')::uuid AND relation_id=r.id;
 safe:=original.id IS NOT NULL AND tsrange(original.valid_from,original.valid_to,'[)') @> tsrange(v.valid_from,v.valid_to,'[)') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(v.services) s WHERE NOT original.services ? s.value);
 RETURN jsonb_build_object('owner','CAMPUS_RELATION','id',r.id,'versionId',v.id,'departmentIds',jsonb_build_array(r.department_id),'period',jsonb_build_object('from',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US')),'action',CASE WHEN v.action='MOVE_SOURCE' THEN 'END' ELSE v.action END,'safeShrink',coalesce(safe,false));
END $$;

DO $reuse$
DECLARE body text;
BEGIN
 body:=pg_get_functiondef('department_master.impact_references(text,jsonb,text)'::regprocedure);
 IF position(' RETURN result;' IN body)=0 THEN RAISE EXCEPTION 'RELATION_IMPACT_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,' RETURN result;',$new$ result:=result||department_master.campus_relation_impact_references(p_actor,p_departments,p_campus);IF jsonb_array_length(result)>2000 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;RETURN result;$new$);
 body:=pg_get_functiondef('department_master.impact_reference_access(text,jsonb,text)'::regprocedure);
 body:=replace(body,E'\r\n',E'\n');EXECUTE replace(body,E'BEGIN\n',E'BEGIN\n IF p_ref->>''owner''=''CAMPUS_RELATION'' THEN PERFORM department_master.lifecycle_relation_snapshot(p_actor,(p_ref->>''id'')::uuid,p_campus,''READ'');IF NOT EXISTS(SELECT 1 FROM department_master.campus_relation_version WHERE relation_id=(p_ref->>''id'')::uuid AND id=(p_ref->>''versionId'')::uuid) OR NOT EXISTS(SELECT 1 FROM department_master.campus_relation_version WHERE relation_id=(p_ref->>''id'')::uuid AND id=(p_ref->>''currentVersionId'')::uuid) THEN RAISE EXCEPTION ''ACCESS_DENIED'';END IF;RETURN;END IF;\n');
 body:=pg_get_functiondef('department_master.impact_case_authorize(text,jsonb,text,text)'::regprocedure);
 body:=replace(body,E'\r\n',E'\n');EXECUTE replace(body,E'BEGIN\n',E'BEGIN\n IF ref->>''owner''=''CAMPUS_RELATION'' THEN PERFORM department_master.lifecycle_relation_snapshot(p_actor,(ref->>''id'')::uuid,p_campus,p_permission);PERFORM department_master.impact_reference_access(p_actor,ref,p_campus);RETURN department_master.lifecycle_authorize(p_actor,p_campus,p_permission);END IF;\n');
 body:=pg_get_functiondef('department_master.impact_result(text,jsonb,text)'::regprocedure);
 body:=replace(body,E'\r\n',E'\n');EXECUTE replace(body,E'BEGIN\n',E'BEGIN\n IF p_ref->>''owner''=''CAMPUS_RELATION'' THEN RETURN department_master.campus_relation_impact_result(p_actor,p_ref,p_campus);END IF;\n');
 body:=pg_get_functiondef('governance_catalog.department_impact_responsibility(text,uuid,uuid,text)'::regprocedure);
 IF position('WHEN ''HIERARCHY'' THEN ''ORG05'' ELSE NULL' IN body)=0 THEN RAISE EXCEPTION 'RELATION_RESPONSIBILITY_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,'WHEN ''HIERARCHY'' THEN ''ORG05'' ELSE NULL','WHEN ''HIERARCHY'' THEN ''ORG05'' WHEN ''CAMPUS_RELATION'' THEN ''ORG04'' ELSE NULL');
END $reuse$;
REVOKE ALL ON FUNCTION department_master.campus_relation_impact_references(text,jsonb,text),department_master.campus_relation_impact_result(text,jsonb,text) FROM PUBLIC,hdi_prototype;
