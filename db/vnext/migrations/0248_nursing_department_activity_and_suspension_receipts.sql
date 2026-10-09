SELECT pg_advisory_xact_lock(901002);

-- Department activity is distinct from retained coverage/location occupancy.
-- Preserve every accepted binding while projecting its complete SUSPEND/RESUME
-- activity periods through the existing currentPeriods public contract.
CREATE OR REPLACE FUNCTION care_organization.nursing_department_references(p_actor text,p_departments jsonb,p_scope text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b record;h jsonb;first_v jsonb;latest jsonb;original_binding jsonb;last_binding jsonb;
 core tsmultirange;active tsmultirange;periods jsonb;from_at timestamp;to_at timestamp;result jsonb:='[]';
BEGIN
 IF p_scope NOT IN ('NORTH','SOUTH') OR jsonb_typeof(p_departments)<>'array' OR jsonb_array_length(p_departments) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR b IN SELECT * FROM care_organization.nursing_unit_binding WHERE p_departments ? managing_department_id::text ORDER BY id LOOP
  h:=care_organization.nursing_snapshot(p_actor,b.unit_id);first_v:=h->'versions'->0;latest:=h->'versions'->(jsonb_array_length(h->'versions')-1);
  SELECT x->'versions'->0,x->'versions'->(jsonb_array_length(x->'versions')-1) INTO original_binding,last_binding FROM jsonb_array_elements(h->'bindings') x WHERE x->>'id'=b.id::text;
  SELECT coalesce(range_agg(tsrange((v->>'validFrom')::timestamp,(v->>'validTo')::timestamp,'[)')),'{}'::tsmultirange) INTO core FROM jsonb_array_elements(h->'versions') v WHERE v->>'action' IN ('CREATE','REVISE');
  active:=(core-care_organization.care_unavailable(h))*tsmultirange(tsrange((last_binding->>'validFrom')::timestamp,(last_binding->>'validTo')::timestamp,'[)'));
  SELECT coalesce(jsonb_agg(jsonb_build_object('from',to_char(lower(span),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(upper(span),'YYYY-MM-DD"T"HH24:MI:SS.US')) ORDER BY lower(span)),'[]'),min(lower(span)),CASE WHEN bool_or(upper_inf(span)) THEN NULL ELSE max(upper(span)) END INTO periods,from_at,to_at FROM unnest(active) span;
  IF active='{}'::tsmultirange THEN from_at:=(last_binding->>'validFrom')::timestamp;to_at:=from_at;END IF;
  result:=result||jsonb_build_array(jsonb_build_object(
   'owner','NURSING_UNIT','id',b.unit_id,'versionId',original_binding->>'id','version',original_binding->>'number','referenceRole','OWNER',
   'sourceSystemIds',jsonb_build_array(first_v->'facts'->'source'->>'sourceSystemId'),'departmentId',b.managing_department_id,'departmentVersionId',NULL,
   'acceptedVersions',coalesce(original_binding->'dependencies'->'department'->'parts','[]'),
   'originalPeriod',jsonb_build_object('from',original_binding->>'validFrom','to',original_binding->>'validTo'),
   'originalDigest',encode(sha256(convert_to(original_binding::text,'UTF8')),'hex'),'frozenLabel',first_v->'facts'->>'nursingName',
   'currentVersionId',last_binding->>'id','currentPeriod',jsonb_build_object('from',to_char(from_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(to_at,'YYYY-MM-DD"T"HH24:MI:SS.US')),
   'currentPeriods',periods,'currentAction',latest->>'action','currentTargetId',b.managing_department_id,'currentReferencesDepartment',true,'current',active<>'{}'::tsmultirange));
 END LOOP;
 RETURN result;
END $$;

-- An accurate, still-current SUSPEND receipt closes its original activity
-- window. A later RESUME changes the head and makes that receipt stale; it
-- never asserts that independent coverage or location relations were ended.
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.nursing_impact_result(text,jsonb,text)'::regprocedure);
 needle:='v.action=''CLOSE''';IF position(needle IN body)=0 OR position('care_organization.nursing_current_end(v.unit_id)' IN body)=0 THEN RAISE EXCEPTION 'P3_11_NURSING_ACTIVITY_RECEIPT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'v.action IN (''SUSPEND'',''CLOSE'')');
 body:=replace(body,'care_organization.nursing_current_end(v.unit_id)','v.valid_from');
 EXECUTE body;
END $$;
