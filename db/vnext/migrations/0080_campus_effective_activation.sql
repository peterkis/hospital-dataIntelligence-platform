-- Preserve installed 0079 checksums. Only effective operational events may
-- supersede suspension; a profile REVISE must never reopen admission.
DO $activation$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('organization_master.campus_write_approved(text,text)'::regprocedure);
 needle:=$old$ IF action IN ('ACTIVATE','SCHEDULE_OPENING') AND EXISTS(SELECT 1 FROM organization_master.campus_event e JOIN organization_master.campus_operation o ON o.event_id=e.id WHERE e.campus_id=s AND o.state='SUSPENDED' AND tsrange(e.valid_from,e.valid_to,'[)') && tsrange((p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,'[)')) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAMPUS_ACTIVATION_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$ IF action IN ('ACTIVATE','SCHEDULE_OPENING') AND EXISTS(
  SELECT 1 FROM organization_master.campus_event e JOIN organization_master.campus_operation o ON o.event_id=e.id
  WHERE e.campus_id=s AND o.state='SUSPENDED' AND
   (tsmultirange(tsrange(e.valid_from,e.valid_to,'[)'))-coalesce((
    SELECT range_agg(tsrange(n.valid_from,n.valid_to,'[)'))
    FROM organization_master.campus_event n JOIN organization_master.campus_operation no2 ON no2.event_id=n.id
    WHERE n.campus_id=s AND n.number>e.number),'{}'::tsmultirange))
   && tsrange((p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,'[)')
 ) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;$new$);
 EXECUTE body;
 body:=pg_get_functiondef('organization_master.workspace_object_context(text,text,uuid)'::regprocedure);
 needle:=$old$NOT EXISTS(SELECT 1 FROM organization_master.campus_event ce WHERE ce.campus_id=node_id AND ce.action='SUSPEND')$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAMPUS_ACTIVATION_CONTEXT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$NOT EXISTS(
  SELECT 1 FROM organization_master.campus_event ce JOIN organization_master.campus_operation co ON co.event_id=ce.id
  WHERE ce.campus_id=node_id AND co.state='SUSPENDED' AND
   (tsmultirange(tsrange(ce.valid_from,ce.valid_to,'[)'))-coalesce((
    SELECT range_agg(tsrange(n.valid_from,n.valid_to,'[)'))
    FROM organization_master.campus_event n JOIN organization_master.campus_operation no2 ON no2.event_id=n.id
    WHERE n.campus_id=node_id AND n.number>ce.number),'{}'::tsmultirange))
   @> timezone('Asia/Shanghai',clock_timestamp())
 )$new$);
 EXECUTE body;
END $activation$;
