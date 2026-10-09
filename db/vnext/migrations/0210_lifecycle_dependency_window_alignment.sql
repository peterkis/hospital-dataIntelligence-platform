SELECT pg_advisory_xact_lock(901002);
CREATE OR REPLACE FUNCTION care_organization.nursing_current_end(p_unit uuid) RETURNS timestamp LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ending timestamp;closing timestamp;BEGIN
 SELECT CASE WHEN bool_or(valid_to IS NULL) THEN NULL ELSE max(valid_to) END INTO ending FROM care_organization.nursing_version WHERE unit_id=p_unit AND action IN ('CREATE','REVISE');
 SELECT min(valid_from) INTO closing FROM care_organization.nursing_version WHERE unit_id=p_unit AND action='CLOSE';
 RETURN least(ending,closing);
END $$;
CREATE OR REPLACE FUNCTION care_organization.nursing_validate_bindings(p_unit uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE a record;b record;property record;history jsonb;missing tsmultirange;piece tsrange;closing timestamp;spans tsmultirange;ending timestamp;BEGIN
 SELECT jsonb_build_object('versions',jsonb_agg(jsonb_build_object('number',number::text,'action',action,'validFrom',to_char(valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US')) ORDER BY number)) INTO history FROM care_organization.nursing_version WHERE unit_id=p_unit;
 FOR a IN SELECT DISTINCT ON(binding_id) v.* FROM care_organization.nursing_binding_version v JOIN care_organization.nursing_unit_binding u ON u.id=v.binding_id WHERE u.unit_id=p_unit ORDER BY binding_id,number DESC LOOP
  FOR b IN SELECT DISTINCT ON(binding_id) v.* FROM care_organization.nursing_binding_version v JOIN care_organization.nursing_unit_binding u ON u.id=v.binding_id WHERE u.unit_id=p_unit AND binding_id<>a.binding_id ORDER BY binding_id,number DESC LOOP
   IF tsrange(a.valid_from,a.valid_to,'[)')&&tsrange(b.valid_from,b.valid_to,'[)') THEN RAISE EXCEPTION 'NURSING_BINDING_CONFLICT';END IF;
  END LOOP;
 END LOOP;
 SELECT range_agg(tsrange(v.valid_from,v.valid_to,'[)')) INTO spans FROM (SELECT DISTINCT ON(binding_id) bv.* FROM care_organization.nursing_binding_version bv JOIN care_organization.nursing_unit_binding ub ON ub.id=bv.binding_id WHERE ub.unit_id=p_unit ORDER BY binding_id,number DESC) v;
 FOR property IN SELECT * FROM care_organization.nursing_version WHERE unit_id=p_unit AND action IN ('CREATE','REVISE') LOOP
  missing:=tsmultirange(tsrange(property.valid_from,property.valid_to,'[)'))-care_organization.care_unavailable(history);
  FOR piece IN SELECT unnest(missing) LOOP IF NOT coalesce(spans @> piece,false) THEN RAISE EXCEPTION 'NURSING_BINDING_REQUIRED';END IF;END LOOP;
 END LOOP;
END $function$
;
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.unit_ward_participant_campus_guard(text,jsonb,jsonb,timestamp,timestamp,timestamp)'::regprocedure);
 needle:='AND value->>''action''<>''REBIND''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_PARTICIPANT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'AND value->>''action'' IN (''CREATE'',''REVISE'')');
 body:=replace(body,'core:=core+spans;','core:=core+(spans-care_organization.care_unavailable(h));');EXECUTE body;
 body:=pg_get_functiondef('care_organization.nursing_campus_dependencies(text,uuid,timestamp,timestamp,timestamp)'::regprocedure);
 needle:='WHERE x->>''action''=''SUSPEND''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_RETAINED_DEPENDENCY_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'WHERE x->>''action''=''CLOSE''');
 body:=pg_get_functiondef('care_organization.nursing_impact_result(text,jsonb,text)'::regprocedure);
 body:=replace(body,'v.action=''SUSPEND''','v.action=''CLOSE''');EXECUTE body;
 body:=pg_get_functiondef('care_organization.nursing_mutate(text,text)'::regprocedure);
 needle:='PERFORM care_organization.nursing_admission(actor,w->''binding'',from_at,to_at,record_at);';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_RESUME_BINDING_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF w->>''action''=''RESUME'' AND NOT EXISTS(SELECT 1 FROM care_organization.nursing_unit_binding nb JOIN LATERAL (SELECT * FROM care_organization.nursing_binding_version bv WHERE bv.binding_id=nb.id ORDER BY number DESC LIMIT 1) bv ON true WHERE nb.unit_id=target AND bv.binding=w->''binding'' AND tsrange(bv.valid_from,bv.valid_to,''[)'') @> tsrange(from_at,to_at,''[)'')) THEN RAISE EXCEPTION ''NURSING_BINDING_REQUIRED'';END IF;'||needle);EXECUTE body;
 body:=pg_get_functiondef('care_organization.ward_nursing_endpoint_impacts(text,text,uuid,timestamp,timestamp,timestamp)'::regprocedure);
 needle:='''to'',NULL) ORDER BY';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_ENDPOINT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'''to'',value->>''validTo'') ORDER BY');body:=replace(body,'IN (''SUSPEND'',''CLOSE'')','IN (''SUSPEND'',''RESUME'',''CLOSE'')');
 needle:='FOR stop IN SELECT value FROM jsonb_array_elements(lifecycles) LOOP';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_ENDPOINT_GAP_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'FOR stop IN SELECT jsonb_build_object(''from'',to_char(lower(span),''YYYY-MM-DD"T"HH24:MI:SS.US''),''to'',to_char(upper(span),''YYYY-MM-DD"T"HH24:MI:SS.US'')) FROM unnest(care_organization.care_unavailable(endpoint)) span LOOP');
 body:=replace(body,'tsrange((stop->>''from'')::timestamp,NULL,''[)'')','tsrange((stop->>''from'')::timestamp,(stop->>''to'')::timestamp,''[)'')');EXECUTE body;
END $$;
