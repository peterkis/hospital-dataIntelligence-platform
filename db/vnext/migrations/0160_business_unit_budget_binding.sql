-- Qualify the expansion-budget column independently of PL/pgSQL's write variable.
DO $budget$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.mutate(text,text)'::regprocedure);
 needle:='sum(1+jsonb_array_length(w->''bindingChanges'')) FROM jsonb_array_elements(t->''writes'') w';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_WRITE_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'sum(1+jsonb_array_length(expanded.entry->''bindingChanges'')) FROM jsonb_array_elements(t->''writes'') AS expanded(entry)');
END $budget$;
