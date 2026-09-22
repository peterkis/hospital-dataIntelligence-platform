SELECT pg_advisory_xact_lock(901002);
-- A recorded suspension is terminal for ACTIVATE in P1-02, even for disjoint
-- backdated intervals. Historical non-overlapping plans remain admissible.
DO $repair$
DECLARE body text;needle text;replacement text;
BEGIN
 body:=pg_get_functiondef('organization_master.campus_write_approved(text,text)'::regprocedure);
 needle:=$before$ IF action IN ('ACTIVATE','SCHEDULE_OPENING') AND EXISTS(SELECT 1 FROM organization_master.campus_event e JOIN organization_master.campus_operation o ON o.event_id=e.id WHERE e.campus_id=s AND o.state='SUSPENDED' AND tsrange(e.valid_from,e.valid_to,'[)') && tsrange((p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,'[)')) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;$before$;
 replacement:=$after$ IF action IN ('ACTIVATE','SCHEDULE_OPENING') AND EXISTS(SELECT 1 FROM organization_master.campus_event e JOIN organization_master.campus_operation o ON o.event_id=e.id WHERE e.campus_id=s AND o.state='SUSPENDED' AND (p_command->>'action'='ACTIVATE' OR tsrange(e.valid_from,e.valid_to,'[)') && tsrange((p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,'[)'))) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;$after$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAMPUS_SUSPENSION_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,replacement);
END $repair$;
