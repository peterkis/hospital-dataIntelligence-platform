SELECT pg_advisory_xact_lock(901002);
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.nursing_partial_plan(jsonb,jsonb)'::regprocedure);
 needle:='care_organization.nursing_closed(plan,ARRAY[''sourceCoverage'',''successors'',''repartition''])';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_PARTIAL_OPTIONAL_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'care_organization.nursing_closed(plan-''repartition'',ARRAY[''sourceCoverage'',''successors''])');EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.apply_record(text,text,jsonb)'::regprocedure);
 needle:='result:=jsonb_build_object(''status'',''COMMITTED'',''candidateId'',c.id,''requestId'',req,''facts'',p_input->''facts'',''recordedAt'',to_char(timezone(''Asia/Shanghai'',clock_timestamp()),''YYYY-MM-DD"T"HH24:MI:SS.US''));';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_OUTCOME_TIME_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$result:=jsonb_build_object('status','COMMITTED','candidateId',c.id,'requestId',req,'facts',p_input->'facts','recordedAt',coalesce(care_organization.lifecycle_context(p_actor)->>'recordAt',to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US')));$new$);EXECUTE body;
END $$;
CREATE FUNCTION care_organization.lifecycle_record_time_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE frame jsonb;t jsonb;point timestamp;BEGIN
 IF coalesce(current_setting('hdi.care_lifecycle',true),'')='' THEN RETURN NEW;END IF;
 frame:=current_setting('hdi.care_lifecycle')::jsonb;t:=care_organization.lifecycle_attest(frame->>'ticket',frame->>'signature');
 IF (t->>'operation'='CONTEXT' AND t->>'phase'='APPLY') OR t->>'operation'='COMMIT_CHECK' THEN
  point:=care_organization.local_time(t->>'recordAt');IF point IS NULL THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;NEW.recorded_at:=point;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER care_lifecycle_time BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION care_organization.lifecycle_record_time_guard();
CREATE TRIGGER care_lifecycle_time BEFORE INSERT ON vnext_control.outcome FOR EACH ROW EXECUTE FUNCTION care_organization.lifecycle_record_time_guard();
REVOKE ALL ON FUNCTION care_organization.lifecycle_record_time_guard() FROM PUBLIC,hdi_prototype;
