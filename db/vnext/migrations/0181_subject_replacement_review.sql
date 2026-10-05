SELECT pg_advisory_xact_lock(901002);

ALTER TABLE care_organization.subject_review_case DROP CONSTRAINT subject_review_case_reason_check;
ALTER TABLE care_organization.subject_review_case ADD CONSTRAINT subject_review_case_reason_check
 CHECK(reason IN ('TARGET_RETIRED','TARGET_MISSING','TARGET_MEANING_CHANGED','TARGET_LABEL_CHANGED','TARGET_REPLACEMENT_CHANGED'));

-- Replacement is a material part of the accepted code, even if it stays ACTIVE.
-- Patch the installed bodies without changing any accepted pin or historical row.
DO $coverage$ DECLARE body text;needle text:=$old$-ARRAY['name','replacement']$old$;BEGIN
 body:=pg_get_functiondef('governance_catalog.subject_code_coverage(text,jsonb,timestamp,timestamp,timestamp)'::regprocedure);
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>3 THEN RAISE EXCEPTION 'SUBJECT_COVERAGE_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,$new$-'name'$new$);
END $coverage$;

DO $cases$ DECLARE body text;needle text:=$old$WHEN new_code->>'meaning' IS DISTINCT FROM old_code->>'meaning' THEN 'TARGET_MEANING_CHANGED'$old$;BEGIN
 body:=pg_get_functiondef('care_organization.subject_reassess_code(text,uuid,uuid)'::regprocedure);
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'SUBJECT_REVIEW_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,$new$WHEN new_code->'replacement' IS DISTINCT FROM old_code->'replacement' THEN 'TARGET_REPLACEMENT_CHANGED' $new$||needle);
END $cases$;
REVOKE ALL ON FUNCTION governance_catalog.subject_code_coverage(text,jsonb,timestamp,timestamp,timestamp),care_organization.subject_reassess_code(text,uuid,uuid) FROM PUBLIC,hdi_prototype;
