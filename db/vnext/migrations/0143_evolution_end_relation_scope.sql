SELECT pg_advisory_xact_lock(901002);
DO $scope$
DECLARE body text;needle text;
BEGIN
 -- A NULL requested scope resolves the relation's own scope; all permissions
 -- and endpoint reads still pass through the same authoritative snapshot.
 body:=pg_get_functiondef('department_master.lifecycle_relation_snapshot(text,uuid,text,text)'::regprocedure);
 needle:='IF r.governance_scope IS DISTINCT FROM p_campus THEN';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'RELATION_SCOPE_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,'p_campus:=coalesce(p_campus,r.governance_scope);'||chr(10)||needle);

 body:=pg_get_functiondef('department_master.apply_evolution_campus_changes(text,uuid)'::regprocedure);
 needle:='(w->>''relationId'')::uuid,e.campus,''WRITE''';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'EVOLUTION_END_SCOPE_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,'(w->>''relationId'')::uuid,NULL,''WRITE''');

 -- Only the exact signed END companion may cross the event's root scope.
 -- Preserve the common R and predecessor/successor membership checks.
 body:=pg_get_functiondef('department_master.campus_relation_root_guard()'::regprocedure);
 needle:='e.campus<>r.governance_scope OR NOT EXISTS';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'RELATION_ROOT_SCOPE_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,'(e.campus<>r.governance_scope AND (NEW.action<>''END'' OR NEW.valid_to IS DISTINCT FROM e.effective_at OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.facts->''campusChanges'') AS item(value) WHERE item.value->>''action''=''END'' AND item.value->>''relationId''=r.id::text AND item.value->>''departmentId''=r.department_id::text AND item.value->>''expectedVersion''=(NEW.number-1)::text))) OR NOT EXISTS');
END $scope$;
