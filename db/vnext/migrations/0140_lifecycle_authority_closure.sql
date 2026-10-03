SELECT pg_advisory_xact_lock(901002);
DO $closure$
DECLARE body text;patched text;needle text;
BEGIN
 -- Current admission is stricter than a historical coverage observation.
 body:=pg_get_functiondef('department_master.lifecycle_admission(text,uuid,timestamp,timestamp,timestamp)'::regprocedure);
 needle:=' active:=department_master.lifecycle_active_periods';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'LIFECYCLE_ADMISSION_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,$new$
 IF p_asof IS NULL AND (EXISTS(SELECT 1 FROM department_master.lifecycle_version WHERE department_id=p_id AND action='DEPRECATE' AND effective_at<=timezone('Asia/Shanghai',clock_timestamp())) OR EXISTS(SELECT 1 FROM department_master.replacement WHERE department_id=p_id AND effective_at<=timezone('Asia/Shanghai',clock_timestamp()))) THEN RETURN jsonb_build_object('owner','department-master','id',p_id,'covered',false,'parts','[]'::jsonb);END IF;
$new$||needle);

 -- A bounded historical hierarchy remains publishable. Its existing exact
 -- attribute/replacement coverage gates still apply; this gate clips lifecycle
 -- intervals without treating a historical withdrawal as current admission.
 body:=pg_get_functiondef('department_master.hierarchy_publish(text,uuid,text,jsonb)'::regprocedure);
 needle:='department_master.lifecycle_state_admission(p_actor,v.department_id,p_valid_from,p_valid_to)';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_LIFECYCLE_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,'(department_master.lifecycle_state_periods(v.department_id,timezone(''Asia/Shanghai'',clock_timestamp())) @> tsrange(p_valid_from,p_valid_to,''[)''))');
 body:=pg_get_functiondef('department_master.hierarchy_publish(text,uuid,text,jsonb)'::regprocedure);
 needle:='owner_id:=(p_payload->>''ownerDepartmentId'')::uuid;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_OWNER_LIFECYCLE_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,needle||$new$
  IF NOT (department_master.lifecycle_state_periods(owner_id,timezone('Asia/Shanghai',clock_timestamp())) @> tsrange(p_valid_from,p_valid_to,'[)')) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
$new$);

 -- The original content maker must also be the candidate maker, and cannot approve.
 body:=pg_get_functiondef('department_master.lifecycle_mutate(text,text)'::regprocedure);
 needle:=' PERFORM governance_catalog.apply_record(a.actor_code,''CHECK_APPROVAL''';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'LIFECYCLE_MAKER_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,$new$
 IF c.maker_identity IS DISTINCT FROM r.identity_code OR a.identity_code=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
$new$||needle);

 -- SPLIT/MERGE also require a legal predecessor; they do not write its attributes.
 body:=pg_get_functiondef('department_master.evolution_mutate(text,text)'::regprocedure);
 needle:='  IF EXISTS(SELECT 1 FROM department_master.replacement WHERE department_id=prior.department_id)';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'EVOLUTION_LIFECYCLE_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,$new$
  IF NOT department_master.lifecycle_state_admission(actor,prior.department_id,at,at+interval '1 microsecond') THEN RAISE EXCEPTION 'UNSUPPORTED_STATE_TRANSITION';END IF;
$new$||needle);

 -- A hospital-wide change can include relationships in different governance scopes.
 -- Authorize each reference in its own scope, while retaining the root's scope too.
 body:=pg_get_functiondef('department_master.campus_relation_impact_references(text,jsonb,text)'::regprocedure);
 needle:='row.relation_id,p_campus,''READ''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'RELATION_SCOPE_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,'row.relation_id,row.governance_scope,''READ''');
 body:=pg_get_functiondef('department_master.impact_reference_access(text,jsonb,text)'::regprocedure);
 needle:='(p_ref->>''id'')::uuid,p_campus,''READ''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'RELATION_SCOPE_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,'(p_ref->>''id'')::uuid,(SELECT governance_scope FROM department_master.campus_relation WHERE id=(p_ref->>''id'')::uuid),''READ''');
 body:=pg_get_functiondef('department_master.impact_case_authorize(text,jsonb,text,text)'::regprocedure);
 needle:='(ref->>''id'')::uuid,p_campus,p_permission';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'RELATION_SCOPE_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,'(ref->>''id'')::uuid,(SELECT governance_scope FROM department_master.campus_relation WHERE id=(ref->>''id'')::uuid),p_permission');
 body:=pg_get_functiondef('department_master.campus_relation_impact_result(text,jsonb,text)'::regprocedure);
 needle:='(p_ref->>''id'')::uuid,p_campus,''READ''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'RELATION_SCOPE_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,'(p_ref->>''id'')::uuid,(SELECT governance_scope FROM department_master.campus_relation WHERE id=(p_ref->>''id'')::uuid),''READ''');

 -- Pre-existing mapping/identifier references can also belong to another scope.
 -- Preserve the complete reverse set and resolve scope from each actual identity.
 body:=pg_get_functiondef('department_master.impact_references(text,jsonb,text)'::regprocedure);
 needle:='IF row.campus<>p_campus THEN RAISE EXCEPTION ''ACCESS_DENIED'';END IF;';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'REFERENCE_SCOPE_PREDECESSOR_MISMATCH';END IF;
 body:=replace(body,needle,'PERFORM department_master.evolution_authorize(p_actor,row.campus,''READ'');');
 body:=replace(body,'row.target_id,p_campus','row.target_id,row.campus');
 body:=replace(body,'latest.target_id,p_campus','latest.target_id,row.campus');
 EXECUTE body;
 body:=pg_get_functiondef('department_master.impact_reference_access(text,jsonb,text)'::regprocedure);
 body:=replace(body,E'\r\n',E'\n');EXECUTE regexp_replace(body,E'BEGIN\n',$new$BEGIN
 PERFORM department_master.evolution_authorize(p_actor,p_campus,'READ');
 IF p_ref->>'owner'='SOURCE_MAPPING' THEN p_campus:=(SELECT campus FROM department_master.organization_mapping WHERE id=(p_ref->>'id')::uuid);END IF;
$new$);
 body:=pg_get_functiondef('department_master.impact_case_authorize(text,jsonb,text,text)'::regprocedure);
 body:=replace(body,E'\r\n',E'\n');EXECUTE regexp_replace(body,E'BEGIN\n',$new$BEGIN
 PERFORM department_master.evolution_authorize(p_actor,p_campus,'READ');
 IF ref->>'owner'='SOURCE_MAPPING' THEN p_campus:=(SELECT campus FROM department_master.organization_mapping WHERE id=(ref->>'id')::uuid);END IF;
$new$);
 body:=pg_get_functiondef('department_master.impact_result(text,jsonb,text)'::regprocedure);
 needle:='IF snapshot->>''campus'' IS DISTINCT FROM p_campus THEN RAISE EXCEPTION ''ACCESS_DENIED'';END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'MAPPING_RESULT_SCOPE_PREDECESSOR_MISMATCH';END IF;
 -- p_campus must keep identifying the original case. The mapping snapshot
 -- authorizes its own identity; add its Department scope check separately.
 EXECUTE replace(body,needle,'PERFORM department_master.evolution_authorize(p_actor,snapshot->>''campus'',''READ'');');
END $closure$;
