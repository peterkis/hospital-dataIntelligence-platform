-- Read accepted handover successors by exact source provenance, across campus
-- rebinding. Existing snapshots enforce current source and successor authority.
CREATE FUNCTION care_organization.ward_nursing_handover_successors_at(p_actor text,p_source uuid,p_r timestamp)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source jsonb; successor record; result jsonb:='[]';
BEGIN
 IF p_r IS NULL THEN RAISE EXCEPTION 'RECORD_AS_OF_REQUIRED'; END IF;
 source:=care_organization.ward_nursing_snapshot_at(p_actor,p_source,p_r);
 IF jsonb_array_length(source->'versions')=0 THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 FOR successor IN
  SELECT DISTINCT v.ward_nursing_id
  FROM care_organization.ward_nursing_version ending
  JOIN LATERAL (
   SELECT previous.number FROM care_organization.ward_nursing_version previous
   WHERE previous.ward_nursing_id=p_source AND previous.number<ending.number AND previous.recorded_at<=p_r
   ORDER BY previous.number DESC LIMIT 1
  ) head ON true
  JOIN care_organization.ward_nursing_version v ON v.change_id=ending.change_id
  JOIN care_organization.ward_nursing target ON target.id=v.ward_nursing_id
  WHERE ending.ward_nursing_id=p_source AND ending.action='END' AND ending.recorded_at<=p_r
   AND v.action='CREATE' AND v.recorded_at<=p_r AND v.valid_from=ending.valid_from
   AND target.ward_id=(source->'applicability'->'ward'->>'id')::uuid
   AND v.facts#>>'{handover,kind}'='CONFIRMED_HANDOVER'
   AND v.facts#>>'{handover,confirmed}'='true'
   AND v.facts#>>'{handover,source,owner}'='care-organization/ward-nursing-coverage'
   AND v.facts#>>'{handover,source,id}'=p_source::text
   AND v.facts#>>'{handover,source,expectedHead}'=head.number::text
   AND (v.facts#>>'{handover,cutover}')::timestamp=ending.valid_from
  ORDER BY v.ward_nursing_id
 LOOP
  result:=result||jsonb_build_array(care_organization.ward_nursing_snapshot_at(p_actor,successor.ward_nursing_id,p_r));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION care_organization.ward_nursing_handover_successors_at(text,uuid,timestamp) FROM PUBLIC;
