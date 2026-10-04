SELECT pg_advisory_xact_lock(901002);
-- The historical projection authorizes only bindings visible at the requested R.
DO $historical$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.snapshot(text,uuid)'::regprocedure);
 needle:='care_organization.snapshot(p_actor text, p_id uuid)';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_SNAPSHOT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'care_organization.snapshot_at(p_actor text, p_id uuid, p_asof timestamp)');
 body:=replace(body,'FROM care_organization.unit_binding WHERE unit_id=u.id LOOP','FROM care_organization.unit_binding WHERE unit_id=u.id AND EXISTS(SELECT 1 FROM care_organization.binding_version visible WHERE visible.binding_id=care_organization.unit_binding.id AND visible.recorded_at<=p_asof) LOOP');
 body:=replace(body,'SELECT jsonb_agg(code ORDER BY code) FROM care_organization.code WHERE unit_id=u.id','SELECT jsonb_agg(DISTINCT visible.facts->''unitCode'') FROM care_organization.version visible WHERE visible.unit_id=u.id AND visible.recorded_at<=p_asof');
 body:=replace(body,'WHERE v.unit_id=u.id)','WHERE v.unit_id=u.id AND v.recorded_at<=p_asof)');
 body:=replace(body,'WHERE v.binding_id=b.id)','WHERE v.binding_id=b.id AND v.recorded_at<=p_asof)');
 body:=replace(body,'WHERE b.unit_id=u.id)','WHERE b.unit_id=u.id AND EXISTS(SELECT 1 FROM care_organization.binding_version visible WHERE visible.binding_id=b.id AND visible.recorded_at<=p_asof))');
 EXECUTE body;
END $historical$;
CREATE FUNCTION care_organization.snapshot_version(p_actor text,p_id uuid,p_version text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE at_r timestamp;BEGIN PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');SELECT recorded_at INTO at_r FROM care_organization.version WHERE unit_id=p_id AND number::text=p_version;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;RETURN care_organization.snapshot_at(p_actor,p_id,at_r);END $$;
CREATE FUNCTION department_master.unit_reference_access(p_actor text,p_department uuid,p_relation uuid,p_version text,p_version_id uuid,p_campus uuid,p_subject uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r department_master.campus_relation;BEGIN
 PERFORM department_master.snapshot(p_actor,p_department);SELECT * INTO r FROM department_master.campus_relation WHERE id=p_relation;IF NOT FOUND THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 PERFORM department_master.lifecycle_relation_snapshot(p_actor,p_relation,r.governance_scope,'READ');
 IF r.department_id<>p_department OR r.campus_id<>p_campus OR r.subject_id<>p_subject OR NOT EXISTS(SELECT 1 FROM department_master.campus_relation_version WHERE relation_id=r.id AND id=p_version_id AND number::text=p_version) THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 PERFORM organization_master.campus_snapshot(p_actor,p_campus);PERFORM organization_master.operating_pair(p_actor,p_subject,p_campus,'RELATION');
END $$;
CREATE FUNCTION care_organization.code_conflict(p_actor text,p_code text,p_target uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');RETURN EXISTS(SELECT 1 FROM care_organization.code WHERE code=p_code AND (p_target IS NULL OR unit_id<>p_target));END $$;
-- A REBIND carries an observed attribute snapshot; only CREATE/REVISE assert properties.
-- SQL independently enforces the exact observed properties and full binding coverage.
DO $properties$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.mutate(text,text)'::regprocedure);
 needle:='  IF w->>''action''=''CLOSE'' THEN';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_PROPERTY_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,E'  IF w->>''action''=''REBIND'' THEN\n   SELECT * INTO at_version FROM care_organization.version WHERE unit_id=target AND action IN (''CREATE'',''REVISE'') AND valid_from<=from_at AND (valid_to IS NULL OR from_at<valid_to) ORDER BY number DESC LIMIT 1;\n   IF at_version.id IS NULL OR (w->''facts''-ARRAY[''source'',''contractVersionId'',''receivingBasis'']) IS DISTINCT FROM (at_version.facts-ARRAY[''source'',''contractVersionId'',''receivingBasis'']) THEN RAISE EXCEPTION ''UNIT_REBIND_INVALID'';END IF;\n  END IF;\n'||needle);
 body:=replace(body,'action<>''CLOSE'' AND valid_from<=from_at','action IN (''CREATE'',''REVISE'') AND valid_from<=from_at');EXECUTE body;
 body:=pg_get_functiondef('care_organization.campus_dependencies(text,uuid,timestamp,timestamp,timestamp)'::regprocedure);
 EXECUTE replace(body,'care_organization.snapshot(p_actor,bound.unit_id)','care_organization.snapshot_at(p_actor,bound.unit_id,coalesce(p_asof,timezone(''Asia/Shanghai'',clock_timestamp())))');
END $properties$;
CREATE OR REPLACE FUNCTION care_organization.validate_bindings(p_unit uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a record;b record;property record;closing timestamp;spans tsmultirange;ending timestamp;BEGIN
 SELECT min(valid_from) INTO closing FROM care_organization.version WHERE unit_id=p_unit AND action='CLOSE';
 FOR a IN SELECT DISTINCT ON(binding_id) v.* FROM care_organization.binding_version v JOIN care_organization.unit_binding u ON u.id=v.binding_id WHERE u.unit_id=p_unit ORDER BY binding_id,number DESC LOOP
  FOR b IN SELECT DISTINCT ON(binding_id) v.* FROM care_organization.binding_version v JOIN care_organization.unit_binding u ON u.id=v.binding_id WHERE u.unit_id=p_unit AND binding_id<>a.binding_id ORDER BY binding_id,number DESC LOOP
   IF tsrange(a.valid_from,a.valid_to,'[)')&&tsrange(b.valid_from,b.valid_to,'[)') THEN RAISE EXCEPTION 'UNIT_BINDING_CONFLICT';END IF;
  END LOOP;
 END LOOP;
 SELECT range_agg(tsrange(v.valid_from,v.valid_to,'[)')) INTO spans FROM (SELECT DISTINCT ON(binding_id) bv.* FROM care_organization.binding_version bv JOIN care_organization.unit_binding ub ON ub.id=bv.binding_id WHERE ub.unit_id=p_unit ORDER BY binding_id,number DESC) v;
 FOR property IN SELECT * FROM care_organization.version WHERE unit_id=p_unit AND action IN ('CREATE','REVISE') LOOP
  ending:=least(property.valid_to,closing);IF ending IS NOT NULL AND ending<=property.valid_from THEN CONTINUE;END IF;
  IF NOT coalesce(spans @> tsrange(property.valid_from,ending,'[)'),false) THEN RAISE EXCEPTION 'UNIT_BINDING_REQUIRED';END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION care_organization.snapshot_at(text,uuid,timestamp),care_organization.snapshot_version(text,uuid,text),care_organization.code_conflict(text,text,uuid),department_master.unit_reference_access(text,uuid,uuid,text,uuid,uuid,uuid) FROM PUBLIC,hdi_prototype;
