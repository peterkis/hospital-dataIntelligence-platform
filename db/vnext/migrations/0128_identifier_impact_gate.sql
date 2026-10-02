SELECT pg_advisory_xact_lock(901002);
DO $$
DECLARE definition text;
 needle text := $old$IF coalesce(NEW.facts->'impactAssessment'->>'id','')=''$old$;
BEGIN
 definition:=pg_get_functiondef('department_master.evolution_impact_guard()'::regprocedure);
 IF position(needle IN definition)=0 OR position($old$IN ('SOURCE_MAPPING','HIERARCHY')$old$ IN definition)=0 THEN RAISE EXCEPTION 'IDENTIFIER_IMPACT_GATE_BASELINE_MISMATCH';END IF;
 definition:=replace(definition,needle,$new$IF (SELECT count(DISTINCT value->>'domain') FROM jsonb_array_elements(NEW.facts->'impacts'))<>9
   OR jsonb_array_length(NEW.facts->'impacts')<>9
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['PERSONNEL','PATIENT','ACCOUNT','INVENTORY','FINANCE','SOURCE_MAPPING','HIERARCHY','CONSUMER','IDENTIFIER']) domain
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.facts->'impacts') declaration WHERE declaration->>'domain'=domain)) THEN RAISE EXCEPTION 'IMPACT_DECLARATION_CONFLICT';END IF;
 IF coalesce(NEW.facts->'impactAssessment'->>'id','')=''$new$);
 EXECUTE replace(definition,$old$IN ('SOURCE_MAPPING','HIERARCHY')$old$,$new$IN ('SOURCE_MAPPING','IDENTIFIER','HIERARCHY')$new$);
END $$;
