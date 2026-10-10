SELECT pg_advisory_xact_lock(901002);

-- Mirror the original physical-boundary contributor query in the caller's
-- snapshot, including Source windows read by that native boundary port.
CREATE FUNCTION location_master.care_boundary_source_references(p_actor text,p_id uuid,p_campus uuid,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source uuid;refs jsonb:='[]';BEGIN
 PERFORM location_master.use_location_boundaries(p_actor,p_id,p_campus,p_from,p_to,p_r);
 FOR source IN SELECT DISTINCT (v.facts->'source'->>'sourceSystemId')::uuid FROM location_master.version v JOIN location_master.use_ancestor_windows(p_id,p_from,p_to,p_r) a ON a.version_id=v.id LOOP
  refs:=refs||governance_catalog.care_source_window_references(p_actor,source,p_from,p_to,p_r);
 END LOOP;RETURN refs;
END $$;
REVOKE ALL ON FUNCTION location_master.care_boundary_source_references(text,uuid,uuid,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
