SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION department_master.lifecycle_state_admission(p_actor text,p_id uuid,p_from timestamp,p_to timestamp) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE now_at timestamp:=timezone('Asia/Shanghai',clock_timestamp());
BEGIN
 PERFORM department_master.snapshot(p_actor,p_id);
 RETURN department_master.lifecycle_state_periods(p_id,now_at) @> tsrange(p_from,p_to,'[)') AND NOT EXISTS(SELECT 1 FROM department_master.lifecycle_version WHERE department_id=p_id AND action='DEPRECATE' AND effective_at<=now_at) AND NOT EXISTS(SELECT 1 FROM department_master.replacement WHERE department_id=p_id AND effective_at<=now_at);
END $$;

CREATE FUNCTION department_master.lifecycle_relation_snapshot(p_actor text,p_id uuid,p_campus text,p_permission text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r department_master.campus_relation;versions jsonb;
BEGIN
 SELECT * INTO r FROM department_master.campus_relation WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF r.governance_scope IS DISTINCT FROM p_campus THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM department_master.lifecycle_authorize(p_actor,p_campus,p_permission);PERFORM department_master.snapshot(p_actor,r.department_id);
 PERFORM organization_master.campus_snapshot(p_actor,r.campus_id);PERFORM organization_master.operating_pair(p_actor,r.subject_id,r.campus_id,'RELATION');
 SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('number',v.number::text) ORDER BY number),'[]'::jsonb) INTO versions FROM department_master.campus_relation_version v WHERE relation_id=r.id;
 RETURN to_jsonb(r)||jsonb_build_object('versions',versions);
END $$;

DO $hierarchy$
DECLARE body text;needle text:='AND NOT EXISTS(SELECT 1 FROM department_master.replacement exit WHERE exit.department_id=v.department_id AND (p_valid_to IS NULL OR p_valid_to>exit.effective_at))';
BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_publish(text,uuid,text,jsonb)'::regprocedure);
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'LIFECYCLE_HIERARCHY_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,needle||' AND department_master.lifecycle_state_admission(p_actor,v.department_id,p_valid_from,p_valid_to)');
END $hierarchy$;
REVOKE ALL ON FUNCTION department_master.lifecycle_state_admission(text,uuid,timestamp,timestamp),department_master.lifecycle_relation_snapshot(text,uuid,text,text) FROM PUBLIC,hdi_prototype;
