SELECT pg_advisory_xact_lock(901002);

-- A finite Department scope selects its Ward bindings before object authorization.
-- Installed 0166/0167 and their original accepted facts remain immutable.
DO $scope$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_department_references(text,jsonb,text)'::regprocedure);
 needle:='WHERE p_departments ? u.department_id::text ORDER BY wb.id';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_SCOPE_REPAIR_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'WHERE wb.scope=p_scope AND p_departments ? u.department_id::text ORDER BY wb.id');
END $scope$;

-- An immutable committed handoff is evidence even after a later property revision.
DO $result$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_impact_result(text,jsonb,text)'::regprocedure);
 needle:='IF NOT FOUND OR v.number::text IS DISTINCT FROM h->''versions''->(jsonb_array_length(h->''versions'')-1)->>''number'' THEN';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_RESULT_REPAIR_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'IF NOT FOUND OR v.action NOT IN (''CLOSE'',''REBIND'') THEN');
END $result$;

-- Department owns this exact version evidence in the accepted Unit relation.
-- It is distinct from the current lifecycle coverage intervals.
DO $accepted$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_management_coverage(text,uuid,uuid,timestamp,timestamp,timestamp)'::regprocedure);
 needle:='dept_parts:=dept_parts||coalesce(dep->''parts'',''[]'')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_ACCEPTED_REPAIR_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'dept_parts:=dept_parts||coalesce(dep->''accepted''->''departmentParts'',''[]'')');
END $accepted$;

-- Pre-repair Ward bindings already contain the exact immutable Unit relation
-- evidence inside each admitted piece. Expose those versions without backfilling
-- or changing the original binding, its digest, or frozen impact case facts.
DO $history$ DECLARE body text;needle text;replacement text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_department_references(text,jsonb,text)'::regprocedure);
 needle:='coalesce(original_binding->''dependencies''->''department''->''parts'',''[]'')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_HISTORY_REPAIR_BASELINE_MISMATCH';END IF;
 replacement:=$projection$CASE WHEN jsonb_array_length(coalesce(original_binding->'dependencies'->'department'->'parts','[]'))>0 THEN original_binding->'dependencies'->'department'->'parts' ELSE coalesce((SELECT jsonb_agg(DISTINCT department_part.value) FROM jsonb_array_elements(coalesce(original_binding->'dependencies'->'parts','[]')) source_piece CROSS JOIN LATERAL jsonb_array_elements(coalesce(source_piece.value->'department'->'accepted'->'departmentParts','[]')) department_part),'[]'::jsonb) END$projection$;
 EXECUTE replace(body,needle,replacement);
END $history$;
