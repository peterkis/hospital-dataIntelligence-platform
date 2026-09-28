-- Keep the historical activation prohibition unless an explicit approved
-- RESUME covers the requested period. 0080 still rejects effective pauses.
DO $resume_basis$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('organization_master.campus_write_approved(text,text)'::regprocedure);
 needle:=$old$ IF action IN ('ACTIVATE','SCHEDULE_OPENING') AND EXISTS(
$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAMPUS_RESUME_BASIS_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$ IF action='ACTIVATE' AND EXISTS(
  SELECT 1 FROM organization_master.campus_event e JOIN organization_master.campus_operation o ON o.event_id=e.id
  WHERE e.campus_id=s AND o.state='SUSPENDED'
 ) AND NOT (tsmultirange(tsrange((p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,'[)')) <@ coalesce((
  SELECT range_agg(tsrange(e.valid_from,e.valid_to,'[)'))
  FROM organization_master.campus_event e JOIN organization_master.campus_operation o ON o.event_id=e.id
  WHERE e.campus_id=s AND e.action='RESUME' AND o.state IN ('TRIAL_RUNNING','RUNNING')
 ),'{}'::tsmultirange)) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
$new$||needle);
 EXECUTE body;
 body:=pg_get_functiondef('organization_master.workspace_object_context(text,text,uuid)'::regprocedure);
 needle:=$old$'canActivate',p_kind='CAMPUS' AND can_write AND NOT terminal AND NOT EXISTS($old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAMPUS_RESUME_BASIS_CONTEXT_MISMATCH';END IF;
 body:=replace(body,needle,$new$'canActivate',p_kind='CAMPUS' AND can_write AND NOT terminal AND (
  NOT EXISTS(SELECT 1 FROM organization_master.campus_event e WHERE e.campus_id=node_id AND e.action='SUSPEND')
  OR EXISTS(SELECT 1 FROM organization_master.campus_event e JOIN organization_master.campus_operation o ON o.event_id=e.id
   WHERE e.campus_id=node_id AND e.action='RESUME' AND o.state IN ('TRIAL_RUNNING','RUNNING')
    AND tsrange(e.valid_from,e.valid_to,'[)') @> timezone('Asia/Shanghai',clock_timestamp()))
 ) AND NOT EXISTS($new$);
 EXECUTE body;
END $resume_basis$;
