SELECT pg_advisory_xact_lock(901002);
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.lifecycle_record(text,text)'::regprocedure);
 needle:=$old$'actor',v.actor,'identity',v.identity_code,'envelope',v.envelope$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_VERIFICATION_RECORD_TIME_BASELINE';END IF;
 EXECUTE replace(body,needle,needle||$new$,'recordedAt',to_char(v.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')$new$);
END $$;
