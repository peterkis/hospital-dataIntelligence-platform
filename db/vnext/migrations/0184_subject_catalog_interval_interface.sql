SELECT pg_advisory_xact_lock(901002);

-- Catalog storage stays behind its owned interface. This lookup is internal to
-- the signed approval/reassessment flow, not an additional runtime role grant.
CREATE FUNCTION governance_catalog.subject_code_next_approved_start(p_actor text,p_system uuid,p_after timestamp,p_r timestamp) RETURNS timestamp LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result timestamp;BEGIN
 PERFORM governance_catalog.subject_code_authorize(p_actor,'READ');
 IF p_system IS NULL OR p_after IS NULL OR p_r IS NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 SELECT min(governance_catalog.contract_time(v.metadata->>'validFrom')) INTO result
 FROM governance_catalog.subject_code_version v JOIN governance_catalog.subject_code_approval a ON a.version_id=v.id
 WHERE v.system_id=p_system AND v.recorded_at<=p_r AND a.recorded_at<=p_r AND governance_catalog.contract_time(v.metadata->>'validFrom')>p_after;
 RETURN result;
END $$;

-- Replace only the installed cross-module query; retain all review semantics,
-- replacement-change handling and immutable historical evidence.
DO $interface$ DECLARE body text;needle text:=$old$SELECT min(governance_catalog.contract_time(v.metadata->>'validFrom')) INTO next_start
 FROM governance_catalog.subject_code_version v JOIN governance_catalog.subject_code_approval a ON a.version_id=v.id
 WHERE v.system_id=p_system AND v.recorded_at<=approval_r AND a.recorded_at<=approval_r AND governance_catalog.contract_time(v.metadata->>'validFrom')>released_from;$old$;BEGIN
 body:=pg_get_functiondef('care_organization.subject_reassess_code(text,uuid,uuid)'::regprocedure);
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'SUBJECT_REVIEW_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,$new$next_start:=governance_catalog.subject_code_next_approved_start(p_actor,p_system,released_from,approval_r);$new$);
END $interface$;
REVOKE ALL ON FUNCTION governance_catalog.subject_code_next_approved_start(text,uuid,timestamp,timestamp),care_organization.subject_reassess_code(text,uuid,uuid) FROM PUBLIC,hdi_prototype;
