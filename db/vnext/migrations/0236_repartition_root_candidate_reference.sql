SELECT pg_advisory_xact_lock(901002);
DO $$DECLARE body text;needle text:='sc.candidate_id=c.id AND sv.recorded_at=record_at';BEGIN
 body:=pg_get_functiondef('care_organization.ward_nursing_mutate_0199(text,text)'::regprocedure);
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_REPARTITION_CANDIDATE_REFERENCE_BASELINE';END IF;
 EXECUTE replace(body,needle,'sc.candidate_id=(c->>''id'')::uuid AND sv.recorded_at=record_at');
END $$;
