-- Forward-only repair for the persistent 0079 installation. 0079 remains
-- immutable; only later operational events may subtract a suspension.
SELECT pg_advisory_xact_lock(901002);
DO $history_repair$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('organization_master.campus_admission(text,uuid,timestamp,timestamp)'::regprocedure);
 needle:=$old$FROM organization_master.campus_event n JOIN organization_master.campus_operation no2 ON no2.event_id=n.id WHERE n.campus_id=p_id AND n.number>e.number)$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAMPUS_HISTORY_REPAIR_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$FROM organization_master.campus_operation no2 JOIN organization_master.campus_event n ON n.id=no2.event_id WHERE n.campus_id=p_id AND n.number>e.number AND n.action IN ('CREATE','ACTIVATE','SUSPEND','RESUME','RETIRE'))$new$);
 EXECUTE body;
END $history_repair$;
