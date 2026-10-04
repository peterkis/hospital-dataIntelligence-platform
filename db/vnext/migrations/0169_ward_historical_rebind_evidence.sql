SELECT pg_advisory_xact_lock(901002);

-- The committed handoff identifies its own immutable source-closing version.
-- A later historical handoff may append another version of the same binding;
-- current remaining-period checks belong to impact recheck, not this proof.
DO $source$ DECLARE body text;needle text;replacement text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_impact_result(text,jsonb,text)'::regprocedure);
 needle:='old_head:=old_binding->''versions''->(jsonb_array_length(old_binding->''versions'')-1);';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WARD_HISTORICAL_RESULT_BASELINE_MISMATCH';END IF;
 replacement:=$version$SELECT x INTO old_head FROM jsonb_array_elements(old_binding->'versions') x WHERE x->>'changeId'=v.change_id::text AND (x->>'validTo')::timestamp IS NOT DISTINCT FROM v.valid_from;$version$;
 EXECUTE replace(body,needle,replacement);
END $source$;
