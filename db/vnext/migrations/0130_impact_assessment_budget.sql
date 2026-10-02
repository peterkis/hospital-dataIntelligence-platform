SELECT pg_advisory_xact_lock(901002);
DO $$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('governance_catalog.department_impact_record(text,text)'::regprocedure);
 needle:=$old$INSERT INTO governance_catalog.department_impact_assessment(actor_identity,request_id,request_digest,input_id,target_kind,target_id,campus,content)$old$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'IMPACT_BYTE_BUDGET_BASELINE_MISMATCH';END IF;
 EXECUTE replace(definition,needle,$new$IF jsonb_array_length(t->'assessment'->'references')>2000 THEN
   RAISE EXCEPTION USING MESSAGE='PLAN_INPUT_LIMIT',DETAIL=jsonb_build_object('kind','REFERENCE_COUNT','observed',jsonb_array_length(t->'assessment'->'references'),'limit',2000)::text;
  END IF;
  IF octet_length((t->'assessment')::text)>524288 THEN
   RAISE EXCEPTION USING MESSAGE='PLAN_INPUT_LIMIT',DETAIL=jsonb_build_object('kind','ASSESSMENT_BYTES','observed',octet_length((t->'assessment')::text),'limit',524288)::text;
  END IF;
  $new$||needle);
 definition:=pg_get_functiondef('department_master.impact_references(text,jsonb,text)'::regprocedure);
 needle:=$old$IF jsonb_array_length(result)>2000 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;$old$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>4 THEN RAISE EXCEPTION 'IMPACT_COUNT_BUDGET_BASELINE_MISMATCH';END IF;
 EXECUTE replace(definition,needle,$new$IF jsonb_array_length(result)>2000 THEN
  RAISE EXCEPTION USING MESSAGE='PLAN_INPUT_LIMIT',DETAIL=jsonb_build_object('kind','REFERENCE_COUNT','observed',jsonb_array_length(result),'limit',2000)::text;
 END IF;$new$);
END $$;
