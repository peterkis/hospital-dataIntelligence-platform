-- Current use follows the attribute stream plus permanent closure. Original
-- accepted periods remain unchanged in the impact evidence.
CREATE FUNCTION care_organization.current_end(p_unit uuid) RETURNS timestamp LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ending timestamp;closing timestamp;BEGIN
 SELECT CASE WHEN bool_or(valid_to IS NULL) THEN NULL ELSE max(valid_to) END INTO ending FROM care_organization.version WHERE unit_id=p_unit AND action IN ('CREATE','REVISE');
 SELECT min(valid_from) INTO closing FROM care_organization.version WHERE unit_id=p_unit AND action='CLOSE';RETURN least(ending,closing);
END $$;
REVOKE ALL ON FUNCTION care_organization.current_end(uuid) FROM PUBLIC,hdi_prototype;
DO $unit_period$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.department_references(text,jsonb,text)'::regprocedure);
 needle:='ending:=least((first_v->>''validTo'')::timestamp,closing);';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_PERIOD_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'ending:=care_organization.current_end(ident.id);');
 body:=pg_get_functiondef('care_organization.impact_result(text,jsonb,text)'::regprocedure);
 needle:='ending:=least(ending,(first_v->>''validTo'')::timestamp);';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_PERIOD_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'ending:=care_organization.current_end(v.unit_id);');
 body:=pg_get_functiondef('care_organization.campus_dependencies(text,uuid,timestamp,timestamp,timestamp)'::regprocedure);
 needle:='ending:=least(v.valid_to,close_at,(first_v->>''validTo'')::timestamp);';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_PERIOD_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'ending:=least(v.valid_to,close_at);');
 needle:='outstanding:=ending IS NULL OR ending>greatest(v.valid_from,p_from);outstanding:=outstanding AND tsrange(v.valid_from,ending,''[)'')&&tsrange(p_from,p_to,''[)'');';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_PERIOD_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'IF ending IS NOT NULL AND ending<=v.valid_from THEN outstanding:=false;ELSE outstanding:=tsrange(v.valid_from,ending,''[)'')&&tsrange(p_from,p_to,''[)'');END IF;');
 body:=pg_get_functiondef('care_organization.mutate(text,text)'::regprocedure);
 needle:='    IF w->>''action''=''CLOSE'' AND';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_WRITE_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'    IF w->>''action''=''REVISE'' AND (bc->''binding'' IS DISTINCT FROM bp.binding OR care_organization.local_time(bc->>''validFrom'')<>bp.valid_from) THEN RAISE EXCEPTION ''UNIT_REVISE_INVALID'';END IF;'||E'\n'||needle);
END $unit_period$;
