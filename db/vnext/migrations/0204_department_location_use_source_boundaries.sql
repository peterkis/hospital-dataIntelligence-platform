SELECT pg_advisory_xact_lock(901002);

-- Department property intervals retain their established finite-successor
-- semantics. Authorize only sources contributing to the requested B/R window;
-- boundary reads must still describe lifecycle gaps without requiring coverage.
CREATE OR REPLACE FUNCTION department_master.use_department_boundaries(
 p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_r timestamp
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE points jsonb;active tsmultirange;contribution record;part jsonb;
BEGIN
 PERFORM department_master.use_department_reference(p_actor,p_id);
 IF p_from IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 active:=department_master.lifecycle_state_periods(p_id,p_r);

 SELECT coalesce(jsonb_agg(to_char(t,'YYYY-MM-DD"T"HH24:MI:SS.US') ORDER BY t),'[]')
 INTO points
 FROM(
  SELECT DISTINCT t FROM(
   SELECT valid_from t FROM department_master.version
    WHERE department_id=p_id AND recorded_at<=p_r
   UNION SELECT valid_to FROM department_master.version
    WHERE department_id=p_id AND recorded_at<=p_r
   UNION SELECT effective_at FROM department_master.lifecycle_version
    WHERE department_id=p_id AND recorded_at<=p_r
   UNION SELECT effective_at FROM department_master.replacement
    WHERE department_id=p_id AND recorded_at<=p_r
  ) known_boundaries
  WHERE t>=p_from AND (p_to IS NULL OR t<=p_to)
 ) requested_boundaries;

 -- Match nursing_management_coverage's Department assertion selection rather
 -- than Nursing's permanent later-start mask. A finite successor masks only
 -- its actual interval, so an older property/source can contribute afterwards.
 FOR contribution IN
  WITH assertions AS(
   SELECT (property_version.facts->>'sourceSystemId')::uuid source_id,
    tsmultirange(tsrange(property_version.valid_from,property_version.valid_to,'[)'))
    -coalesce((
     SELECT range_agg(tsrange(later_version.valid_from,later_version.valid_to,'[)'))
     FROM department_master.version later_version
     WHERE later_version.department_id=p_id
      AND later_version.number>property_version.number
      AND later_version.recorded_at<=p_r
    ),'{}'::tsmultirange) periods
   FROM department_master.version property_version
   WHERE property_version.department_id=p_id AND property_version.recorded_at<=p_r
  ),pieces AS(
   SELECT source_id,
    unnest(periods*active*tsmultirange(tsrange(p_from,p_to,'[)'))) period
   FROM assertions
  )
  SELECT DISTINCT source_id,lower(period) valid_from,upper(period) valid_to
  FROM pieces WHERE NOT isempty(period)
  ORDER BY source_id,valid_from
 LOOP
  FOR part IN
   SELECT value FROM jsonb_array_elements(governance_catalog.use_source_windows(
    p_actor,contribution.source_id,contribution.valid_from,contribution.valid_to,p_r
   ))
  LOOP
   points:=points||jsonb_build_array(part->>'from');
   IF part->>'to' IS NOT NULL THEN points:=points||jsonb_build_array(part->>'to');END IF;
  END LOOP;
 END LOOP;
 RETURN points;
END $$;
REVOKE ALL ON FUNCTION department_master.use_department_boundaries(text,uuid,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
