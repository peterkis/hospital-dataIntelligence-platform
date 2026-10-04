SELECT pg_advisory_xact_lock(901002);

-- Keep expired accepted bindings readable, without treating them as live today.
DO $ended$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_department_references(text,jsonb,text)'::regprocedure);
 needle:='result jsonb:=''[]'';BEGIN';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_REFERENCE_OBSERVATION_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'result jsonb:=''[]'';observed timestamp:=timezone(''Asia/Shanghai'',clock_timestamp());BEGIN');
 needle:='''current'',coalesce(least((last_binding->>''validTo'')::timestamp,ending)>(last_binding->>''validFrom'')::timestamp,true)';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_ENDED_REFERENCE_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'''current'',coalesce(least((last_binding->>''validTo'')::timestamp,ending)>greatest((last_binding->>''validFrom'')::timestamp,observed),true)');
END $ended$;

-- Mirror the Ward-only event-window projection used by the application. A
-- future handoff remains a live obligation before its end, but not afterwards.
CREATE FUNCTION department_master.project_ward_impact_references(p_actor text,p_refs jsonb,p_assessment jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ref jsonb;boundary timestamp;replacement jsonb;active boolean;result jsonb:='[]';BEGIN
 FOR ref IN SELECT value FROM jsonb_array_elements(p_refs) LOOP
  IF ref->>'owner'='WARD' THEN
   boundary:=(p_assessment->>'effectiveAt')::timestamp;
   IF p_assessment->>'changeType' NOT IN ('SPLIT','MERGE','SUSPEND','DEPRECATE') THEN
    replacement:=department_master.replacement_read(p_actor,(ref->>'departmentId')::uuid,NULL);
    boundary:=coalesce((replacement->>'effective_at')::timestamp,boundary);
   END IF;
   active:=(ref->>'current')::boolean AND (ref->>'currentReferencesDepartment')::boolean
    AND ref->>'currentAction' NOT IN ('RETRACT','CLOSED','REVOKED')
    AND ref->>'currentTargetId'=ref->>'departmentId'
    AND ((ref->'currentPeriod'->>'to') IS NULL OR (ref->'currentPeriod'->>'to')::timestamp>greatest((ref->'currentPeriod'->>'from')::timestamp,boundary));
   ref:=jsonb_set(ref,'{current}',to_jsonb(active));
  END IF;
  result:=result||jsonb_build_array(ref);
 END LOOP;RETURN result;END $$;
REVOKE ALL ON FUNCTION department_master.project_ward_impact_references(text,jsonb,jsonb) FROM PUBLIC,hdi_prototype;

DO $guard$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('department_master.evolution_impact_guard()'::regprocedure);
 needle:=' SELECT coalesce(jsonb_agg(value-ARRAY[''change'',''constraint'',''reason'',''affectedSpans'']';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_PROJECTION_GUARD_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,E' actual:=department_master.project_ward_impact_references(reviewer,actual,assessment);\n'||needle);
END $guard$;
