SELECT pg_advisory_xact_lock(901002);

-- The FULL adapter and its source-policy adoption are not ready. Explicit
-- references must never be dropped to turn a FULL request into CORE.
DO $patch$ DECLARE body text; needle text; guard text; BEGIN
 guard:=$guard$
 IF p_payload ? 'profile' AND p_payload->'profile' NOT IN ('"CORE"'::jsonb,'"FULL"'::jsonb) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 IF p_payload ? 'dependencies' AND jsonb_typeof(p_payload->'dependencies') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 IF p_payload->>'profile'='FULL' OR coalesce(jsonb_array_length(p_payload->'dependencies'),0)>0 THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
$guard$;
 body:=pg_get_functiondef('department_master.hierarchy_create_view(text,jsonb)'::regprocedure);
 needle:='  digest:=p_payload->>''viewDigest'';';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_PROFILE_REGISTRATION_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,guard||needle);

 body:=pg_get_functiondef('department_master.hierarchy_assert_candidate_shape(jsonb)'::regprocedure);
 needle:=' IF jsonb_typeof(p_payload->''nodes'')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_PROFILE_CANDIDATE_BASELINE_MISMATCH'; END IF;
 -- Validate optional admission fields, then check the original CORE shape.
 -- This function's local parameter copy does not alter the stored/signed payload.
 EXECUTE replace(body,needle,guard||' p_payload:=p_payload-ARRAY[''profile'',''dependencies''];'||chr(10)||needle);
END $patch$;
