SELECT pg_advisory_xact_lock(901002);

ALTER TABLE department_master.hierarchy_view_version
 ADD COLUMN source_record_status text CHECK (source_record_status IN ('ACTIVE'));

-- Populate only the newly added field from one exact applied candidate.
-- Missing or ambiguous historical evidence remains NULL. The runner executes
-- this file atomically; the DDL lock excludes concurrent writes while the
-- immutable trigger is suspended for this narrowly scoped recovery.
ALTER TABLE department_master.hierarchy_view_version DISABLE TRIGGER hierarchy_version_immutable;
WITH evidence AS (
 SELECT view_id,payload->>'validationDigest' AS digest,count(*) AS matches,
        jsonb_agg(payload->'recordStatus')->0 AS record_status
 FROM department_master.hierarchy_candidate WHERE status='APPLIED'
 GROUP BY view_id,payload->>'validationDigest'
)
UPDATE department_master.hierarchy_view_version v SET source_record_status='ACTIVE'
 FROM evidence e WHERE v.view_id=e.view_id AND v.content_digest=e.digest
 AND v.status='PUBLISHED' AND e.matches=1 AND e.record_status='"ACTIVE"'::jsonb;
ALTER TABLE department_master.hierarchy_view_version ENABLE TRIGGER hierarchy_version_immutable;

DO $patch$ DECLARE body text; needle text; BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_publish(text,uuid,text,jsonb)'::regprocedure);
 needle:='status,owner_department_version_id,source_definition_version_id)';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_SOURCE_STATUS_COLUMNS_MISMATCH'; END IF;
 body:=replace(body,needle,'status,owner_department_version_id,source_definition_version_id,source_record_status)');
 needle:='p_payload->>''validationDigest'',''PUBLISHED'',owner_version_id,source_version_id)';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_SOURCE_STATUS_VALUES_MISMATCH'; END IF;
 EXECUTE replace(body,needle,'p_payload->>''validationDigest'',''PUBLISHED'',owner_version_id,source_version_id,p_payload->>''recordStatus'')');
END $patch$;
