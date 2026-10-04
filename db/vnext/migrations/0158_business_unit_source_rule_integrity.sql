-- MACHINE evaluates completion of the independent evidence gate. It cannot
-- adopt a different condition under an existing source rule identity.
DO $unit_rules$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('governance_catalog.validation_rules_valid(jsonb,uuid)'::regprocedure);
 needle:='rule->>''version''=''P0_05_SOURCE_V1'' THEN CONTINUE;END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_RULE_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'rule->>''version''=''P0_05_SOURCE_V1'' THEN IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source->''rules'') r WHERE r->>''id''=rule->>''id'' AND r->>''field''=rule->>''field'' AND r->>''text''=rule->>''text'') THEN RETURN false;END IF;CONTINUE;END IF;');
END $unit_rules$;
