CREATE FUNCTION care_organization.list_at(p_actor text,p_scope text,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u record;result jsonb:='[]';BEGIN
 IF p_scope NOT IN ('NORTH','SOUTH') OR p_asof IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 FOR u IN SELECT DISTINCT b.unit_id FROM care_organization.unit_binding b WHERE b.scope=p_scope AND EXISTS(SELECT 1 FROM care_organization.binding_version v WHERE v.binding_id=b.id AND v.recorded_at<=p_asof) ORDER BY b.unit_id LOOP result:=result||jsonb_build_array(care_organization.snapshot_at(p_actor,u.unit_id,p_asof));END LOOP;RETURN result;
END $$;
DO $unit_impact$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.campus_dependencies(text,uuid,timestamp,timestamp,timestamp)'::regprocedure);
 body:=replace(body,'outstanding boolean;result','active boolean;outstanding boolean;r timestamp:=coalesce(p_asof,timezone(''Asia/Shanghai'',clock_timestamp()));result');
 needle:='IF ending IS NOT NULL AND ending<=v.valid_from THEN outstanding:=false;ELSE outstanding:=tsrange(v.valid_from,ending,''[)'')&&tsrange(p_from,p_to,''[)'');END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_IMPACT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF ending IS NOT NULL AND ending<=v.valid_from THEN active:=false;outstanding:=false;ELSE active:=tsrange(v.valid_from,ending,''[)'')&&tsrange(p_from,p_to,''[)'');IF p_to IS NOT NULL AND p_to<=r THEN outstanding:=false;ELSE outstanding:=tsrange(v.valid_from,ending,''[)'')&&tsrange(greatest(p_from,r),p_to,''[)'');END IF;END IF;');
 EXECUTE replace(body,'''active'',outstanding','''active'',active');
END $unit_impact$;
-- Public SQL counterpart of the composition-injected finite Unit reader.
-- Legacy callers explicitly report Unit coverage NOT_EVALUABLE; current runtime
-- reports it evaluated and must provide this exact independently observed result.
CREATE FUNCTION organization_master.campus_impact_with_units(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE report jsonb;BEGIN
 report:=organization_master.campus_impact(p_actor,p_id,p_from,p_to,p_asof);
 report:=jsonb_set(report,'{dependencies}',(report->'dependencies')||care_organization.campus_dependencies(p_actor,p_id,p_from,p_to,p_asof));
 RETURN jsonb_set(report,'{unavailable}',(report->'unavailable')-'BUSINESS_UNIT');
END $$;
DO $campus_unit_gate$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('organization_master.campus_write_approved(text,text)'::regprocedure);
 needle:='organization_master.campus_impact(p_actor,s,(p_command->>''validFrom'')::timestamp,NULL,NULL)';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAMPUS_UNIT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'(CASE WHEN ticket->''lifecycle''->''report''->''unavailable'' ? ''BUSINESS_UNIT'' THEN organization_master.campus_impact(p_actor,s,(p_command->>''validFrom'')::timestamp,NULL,NULL) ELSE organization_master.campus_impact_with_units(p_actor,s,(p_command->>''validFrom'')::timestamp,NULL,NULL) END)');
 needle:='unnest(ARRAY[''BUSINESS_UNIT'',''LOCATION'',''ASSIGNMENT'',''CONSUMPTION'']) owner';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAMPUS_UNIT_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'jsonb_array_elements_text(ticket->''lifecycle''->''report''->''unavailable'') owner');
END $campus_unit_gate$;
REVOKE ALL ON FUNCTION care_organization.list_at(text,text,timestamp),organization_master.campus_impact_with_units(text,uuid,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
