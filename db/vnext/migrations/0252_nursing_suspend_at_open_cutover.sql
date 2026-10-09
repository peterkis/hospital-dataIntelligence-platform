SELECT pg_advisory_xact_lock(901002);
DO $$
DECLARE body text;needle text;replacement text;
BEGIN
 body:=pg_get_functiondef('care_organization.nursing_mutate(text,text)'::regprocedure);
 needle:=$old$IF w->>'action' NOT IN ('RESUME','CLOSE') AND care_organization.care_unavailable(care_organization.nursing_snapshot(actor,target)) && tsmultirange(tsrange(from_at,to_at,'[)')) THEN RAISE EXCEPTION 'NURSING_SUSPENDED';END IF;$old$;
 replacement:=$new$IF w->>'action' NOT IN ('RESUME','CLOSE') AND (CASE WHEN w->>'action'='SUSPEND'
   THEN care_organization.care_unavailable(care_organization.nursing_snapshot(actor,target)) @> from_at
   ELSE care_organization.care_unavailable(care_organization.nursing_snapshot(actor,target)) && tsmultirange(tsrange(from_at,to_at,'[)'))
  END) THEN RAISE EXCEPTION 'NURSING_SUSPENDED';END IF;$new$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_NURSING_SUSPEND_CUTOVER_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,replacement);
END $$;
