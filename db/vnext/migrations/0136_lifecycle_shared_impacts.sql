SELECT pg_advisory_xact_lock(901002);

-- The existing bounded Catalog ledger now accepts either implemented Department
-- change Owner. Deferred guards preserve exact references without a second ledger.
ALTER TABLE governance_catalog.department_impact_assessment DROP CONSTRAINT department_impact_assessment_input_id_fkey;
ALTER TABLE governance_catalog.department_impact_case DROP CONSTRAINT department_impact_case_event_id_fkey;

CREATE FUNCTION department_master.impact_change_context(p_actor text,p_id uuid,p_kind text,p_campus text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE input uuid;campus text;
BEGIN
 IF p_kind='INPUT' THEN
  IF EXISTS(SELECT 1 FROM department_master.lifecycle_input WHERE id=p_id) THEN PERFORM department_master.lifecycle_input_read(p_actor,p_id,'READ');RETURN jsonb_build_object('owner','department-master/lifecycle','input_id',p_id);END IF;
  PERFORM department_master.evolution_input_read(p_actor,p_id,'READ_RESTRICTED');RETURN jsonb_build_object('owner','department-master/organization-evolution','input_id',p_id);
 ELSIF p_kind='EVENT' THEN
  SELECT input_id INTO input FROM department_master.lifecycle_operation WHERE id=p_id;
  IF FOUND THEN SELECT li.campus INTO campus FROM department_master.lifecycle_input li WHERE id=input;IF campus IS DISTINCT FROM p_campus THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;PERFORM department_master.lifecycle_input_read(p_actor,input,'READ');RETURN jsonb_build_object('owner','department-master/lifecycle','input_id',input);END IF;
  RETURN jsonb_build_object('owner','department-master/organization-evolution','input_id',department_master.evolution_snapshot(p_actor,p_id,p_campus)->>'input_id');
 ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
END $$;

CREATE FUNCTION department_master.impact_change_input_read(p_actor text,p_id uuid,p_permission text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM department_master.lifecycle_input WHERE id=p_id) THEN RETURN department_master.lifecycle_input_read(p_actor,p_id,p_permission);END IF;
 RETURN department_master.evolution_input_read(p_actor,p_id,p_permission);
END $$;
CREATE FUNCTION department_master.impact_change_snapshot(p_actor text,p_id uuid,p_campus text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op department_master.lifecycle_operation;r jsonb;
BEGIN
 SELECT * INTO op FROM department_master.lifecycle_operation WHERE id=p_id;
 IF NOT FOUND THEN RETURN department_master.evolution_snapshot(p_actor,p_id,p_campus);END IF;
 r:=department_master.lifecycle_input_read(p_actor,op.input_id,'READ');IF r->>'campus' IS DISTINCT FROM p_campus THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 RETURN jsonb_build_object('owner','department-master/lifecycle','id',op.id,'input_id',op.input_id,'campus',r->>'campus','recorded_at',op.recorded_at,'effective_at',op.assessment->'content'->>'effectiveAt','facts',op.assessment->'binding');
END $$;
CREATE FUNCTION governance_catalog.guard_department_change_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='department_impact_assessment' THEN
  IF NOT EXISTS(SELECT 1 FROM department_master.evolution_input WHERE id=NEW.input_id) AND NOT EXISTS(SELECT 1 FROM department_master.lifecycle_input WHERE id=NEW.input_id) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM department_master.evolution_event WHERE id=NEW.event_id) AND NOT EXISTS(SELECT 1 FROM department_master.lifecycle_operation WHERE id=NEW.event_id) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER exact_change_reference AFTER INSERT ON governance_catalog.department_impact_assessment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION governance_catalog.guard_department_change_reference();
CREATE CONSTRAINT TRIGGER exact_change_reference AFTER INSERT ON governance_catalog.department_impact_case DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION governance_catalog.guard_department_change_reference();

CREATE FUNCTION governance_catalog.department_lifecycle_assessment(p_ticket text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=department_master.impact_ticket_authorize(p_ticket,p_signature);input jsonb;r governance_catalog.department_impact_assessment;
BEGIN
 IF t->>'operation'<>'LIFECYCLE_ASSESS' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 input:=department_master.lifecycle_input_read(t->>'actor',(t->'assessment'->>'inputId')::uuid,'READ');
 IF input->>'digest' IS DISTINCT FROM t->'assessment'->>'inputDigest' OR input->>'campus' IS DISTINCT FROM t->>'campus' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 IF jsonb_array_length(t->'assessment'->'references')>2000 OR octet_length((t->'assessment')::text)>524288 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;
 SELECT * INTO r FROM governance_catalog.department_impact_assessment WHERE input_id=(input->>'id')::uuid AND target_kind='INPUT' AND content->>'dependencyDigest'=t->'assessment'->>'dependencyDigest' ORDER BY recorded_at LIMIT 1;
 IF NOT FOUND THEN
  INSERT INTO governance_catalog.department_impact_assessment(actor_identity,request_id,request_digest,input_id,target_kind,target_id,campus,content)
  VALUES(t->>'identity',uuidv7(),t->'assessment'->>'dependencyDigest',(input->>'id')::uuid,'INPUT',(input->>'id')::uuid,t->>'campus',t->'assessment') RETURNING * INTO r;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(t->>'actor',r.id,'DEPARTMENT_IMPACT_ASSESSED','LIFECYCLE_OWNER',r.content->>'dependencyDigest');
 END IF;
 RETURN jsonb_build_object('id',r.id,'digest',r.content->>'dependencyDigest');
END $$;

CREATE FUNCTION department_master.record_lifecycle_impacts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r department_master.lifecycle_input;assessment jsonb;
BEGIN
 SELECT * INTO r FROM department_master.lifecycle_input WHERE id=NEW.input_id;
 assessment:=governance_catalog.department_impact_binding((NEW.assessment->'reference'->>'id')::uuid,r.id,NEW.assessment->'reference'->>'digest');
 IF assessment IS DISTINCT FROM NEW.assessment->'content' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 PERFORM governance_catalog.open_department_impacts(NEW.id,(NEW.assessment->'reference'->>'id')::uuid,r.campus,NEW.recorded_at,NEW.assessment->'binding'->'impacts');
 RETURN NEW;
END $$;
CREATE TRIGGER record_lifecycle_impacts AFTER INSERT ON department_master.lifecycle_operation FOR EACH ROW EXECUTE FUNCTION department_master.record_lifecycle_impacts();

-- Reuse exact replay, terminal-state and responsibility logic. Only reference
-- dispatch changes; the accepted evolution path remains the same path.
DO $dispatch$
DECLARE signature text;body text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['governance_catalog.department_impact_record(text,text)','governance_catalog.department_impact_command(jsonb)','governance_catalog.department_impact_receipt(jsonb)','department_master.impact_successors(text,uuid,text)'] LOOP
  body:=pg_get_functiondef(signature::regprocedure);
  body:=replace(body,'department_master.evolution_snapshot(','department_master.impact_change_snapshot(');
  body:=replace(body,'department_master.evolution_input_read(','department_master.impact_change_input_read(');
  EXECUTE body;
 END LOOP;
END $dispatch$;
REVOKE ALL ON FUNCTION department_master.impact_change_context(text,uuid,text,text),department_master.impact_change_input_read(text,uuid,text),department_master.impact_change_snapshot(text,uuid,text),department_master.record_lifecycle_impacts(),governance_catalog.department_lifecycle_assessment(text,text),governance_catalog.guard_department_change_reference() FROM PUBLIC,hdi_prototype;
