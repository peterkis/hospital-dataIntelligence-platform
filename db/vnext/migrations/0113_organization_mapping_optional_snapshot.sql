CREATE FUNCTION department_master.mapping_snapshot_optional(p_actor text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM department_master.organization_mapping WHERE id=p_id) THEN RETURN NULL;END IF;
 RETURN department_master.mapping_snapshot(p_actor,p_id);
END $$;
REVOKE ALL ON FUNCTION department_master.mapping_snapshot_optional(text,uuid) FROM PUBLIC,hdi_prototype;
