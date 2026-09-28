SELECT pg_advisory_xact_lock(901002);
ALTER TABLE organization_master.campus_event DROP CONSTRAINT campus_event_action_check;
ALTER TABLE organization_master.campus_event ADD CONSTRAINT campus_event_action_check CHECK(action IN ('CREATE','REVISE','SCHEDULE_OPENING','CANCEL_OPENING','ACTIVATE','SUSPEND','RESUME'));
DO $extend$
DECLARE body text; needle text;
BEGIN
 body:=pg_get_functiondef('organization_master.campus_write_approved(text,text)'::regprocedure);
 needle:=$n$ IF action IN ('CREATE','ACTIVATE','SUSPEND') THEN$n$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAMPUS_LIFECYCLE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$n$ IF action IN ('CREATE','ACTIVATE','SUSPEND','RESUME') THEN$n$);
 needle:=$n$ IF action='SUSPEND' AND$n$;
 body:=replace(body,needle,$n$ IF action='RESUME' AND NOT (
   coalesce((SELECT range_agg(part) FROM organization_master.campus_event e
   JOIN organization_master.campus_operation op ON op.event_id=e.id
   CROSS JOIN LATERAL unnest(tsmultirange(tsrange(e.valid_from,e.valid_to,'[)')) - coalesce((SELECT range_agg(tsrange(n.valid_from,n.valid_to,'[)')) FROM organization_master.campus_event n JOIN organization_master.campus_operation nop ON nop.event_id=n.id WHERE n.campus_id=s AND n.number>e.number),'{}'::tsmultirange)) part
   WHERE e.campus_id=s AND op.state='SUSPENDED'),'{}'::tsmultirange)
   @> tsrange((p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,'[)')
 ) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 IF action='SUSPEND' AND$n$);
 EXECUTE body;
END $extend$;
