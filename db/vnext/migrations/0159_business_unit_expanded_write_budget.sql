DO $budget$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.mutate(text,text)'::regprocedure);needle:='root_id:=uuidv7();';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_WRITE_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'IF (SELECT sum(1+jsonb_array_length(w->''bindingChanges'')) FROM jsonb_array_elements(t->''writes'') w)>100 THEN RAISE EXCEPTION ''PLAN_INPUT_LIMIT'';END IF;'||needle);
END $budget$;
