SELECT pg_advisory_xact_lock(901002);

-- Preserve installed history and authority. Overlapping admission declarations
-- must agree on the complete governed sharing boundary, including all declared
-- participants and its business window. Local time precision and list order do
-- not change that boundary; per-span participant coverage remains required.
DO $repair$
DECLARE body text;needle text;replacement text;BEGIN
 body:=pg_get_functiondef('care_organization.unit_ward_group_validate(uuid,timestamp)'::regprocedure);
 needle:=$old$IF rule->>'ruleReference' IS DISTINCT FROM other_rule->>'ruleReference' OR rule->>'ruleVersion' IS DISTINCT FROM other_rule->>'ruleVersion' OR rule->>'evidenceId' IS DISTINCT FROM other_rule->>'evidenceId' THEN RAISE EXCEPTION 'SHARING_POLICY_CONFLICT';END IF;$old$;
 replacement:=$new$IF (rule-ARRAY['participants','validFrom','validTo']) IS DISTINCT FROM (other_rule-ARRAY['participants','validFrom','validTo'])
     OR (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements(rule->'participants')) IS DISTINCT FROM (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements(other_rule->'participants'))
     OR care_organization.unit_ward_local_time(rule->>'validFrom') IS DISTINCT FROM care_organization.unit_ward_local_time(other_rule->>'validFrom')
     OR (CASE WHEN rule->>'validTo' IS NULL THEN NULL ELSE care_organization.unit_ward_local_time(rule->>'validTo') END) IS DISTINCT FROM (CASE WHEN other_rule->>'validTo' IS NULL THEN NULL ELSE care_organization.unit_ward_local_time(other_rule->>'validTo') END)
    THEN RAISE EXCEPTION 'SHARING_POLICY_CONFLICT';END IF;$new$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_WARD_SHARING_REPAIR_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,replacement);
END $repair$;
