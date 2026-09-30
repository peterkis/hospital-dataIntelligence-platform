SELECT pg_advisory_xact_lock(901002);

-- Department revisions append immutable rows. A row's original range alone
-- does not prove that its version still covers a newly published snapshot.
-- Applied historical retries return before this admission check.
DO $patch$ DECLARE body text; needle text; BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_publish(text,uuid,text,jsonb)'::regprocedure);
 needle:='        WHERE v.id=(n->>''departmentVersionId'')::uuid AND v.department_id=(n->>''departmentId'')::uuid';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_DEPARTMENT_PERIOD_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,needle||$guard$
          AND NOT EXISTS (
            SELECT 1 FROM department_master.version later
             WHERE later.department_id=v.department_id AND later.number>v.number
               AND tsrange(later.valid_from,later.valid_to,'[)') && tsrange(p_valid_from,p_valid_to,'[)')
          )
$guard$);
END $patch$;
