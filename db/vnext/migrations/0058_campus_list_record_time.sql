SELECT pg_advisory_xact_lock(901002);
-- Filter the known identity set before LIMIT. The default preserves existing
-- three-argument callers; explicit historical callers pin the same R as reads.
CREATE FUNCTION organization_master.campus_list(p_actor text,p_after uuid,p_limit integer,p_as_of timestamp DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 IF p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 RETURN coalesce((SELECT jsonb_agg(id ORDER BY id) FROM (
  SELECT c.id FROM organization_master.campus c
  WHERE (p_after IS NULL OR c.id>p_after) AND organization_master.allowed(p_actor,c.id,c.scope,'READ')
   AND EXISTS(SELECT 1 FROM organization_master.campus_event e WHERE e.campus_id=c.id AND e.recorded_at<=coalesce(p_as_of,timezone('Asia/Shanghai',clock_timestamp())))
  ORDER BY c.id LIMIT p_limit
 ) x),'[]');
END $$;
REVOKE ALL ON FUNCTION organization_master.campus_list(text,uuid,integer,timestamp) FROM PUBLIC,hdi_prototype;
-- Carry forward explicit service grants before removing the replaced signature.
DO $$ DECLARE r record;BEGIN
 FOR r IN SELECT DISTINCT roles.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles roles ON roles.oid=a.grantee WHERE p.oid='organization_master.campus_list(text,uuid,integer)'::regprocedure AND a.privilege_type='EXECUTE' LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION organization_master.campus_list(text,uuid,integer,timestamp) TO %I',r.rolname);
 END LOOP;
END $$;
DROP FUNCTION organization_master.campus_list(text,uuid,integer);
