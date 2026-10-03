SELECT pg_advisory_xact_lock(901002);
ALTER TABLE department_master.campus_relation_version DROP CONSTRAINT campus_relation_version_operation_id_fkey;

-- A relation version belongs to exactly one accepted whole root, including its R.
CREATE FUNCTION department_master.campus_relation_root_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r department_master.campus_relation;life department_master.lifecycle_operation;e department_master.evolution_event;
BEGIN
 SELECT * INTO r FROM department_master.campus_relation WHERE id=NEW.relation_id;
 SELECT * INTO life FROM department_master.lifecycle_operation WHERE id=NEW.operation_id;
 SELECT * INTO e FROM department_master.evolution_event WHERE id=NEW.operation_id;
 IF (life.id IS NULL)=(e.id IS NULL) OR NEW.recorded_at IS DISTINCT FROM coalesce(life.recorded_at,e.recorded_at) THEN RAISE EXCEPTION 'RELATION_ROOT_MISMATCH';END IF;
 IF e.id IS NOT NULL AND (e.campus<>r.governance_scope OR NOT EXISTS(SELECT 1 FROM department_master.evolution_relation WHERE event_id=e.id AND r.department_id IN(from_department_id,to_department_id))) THEN RAISE EXCEPTION 'RELATION_ROOT_MISMATCH';END IF;
 IF EXISTS(SELECT 1 FROM department_master.campus_relation a JOIN department_master.campus_relation b ON a.department_id=b.department_id AND a.campus_id=b.campus_id AND a.id<>b.id
 CROSS JOIN LATERAL (SELECT * FROM department_master.campus_relation_version WHERE relation_id=a.id ORDER BY number DESC LIMIT 1) av
 CROSS JOIN LATERAL (SELECT * FROM department_master.campus_relation_version WHERE relation_id=b.id ORDER BY number DESC LIMIT 1) bv
 WHERE a.department_id=r.department_id AND tsrange(av.valid_from,av.valid_to,'[)')&&tsrange(bv.valid_from,bv.valid_to,'[)') AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(av.services) s WHERE bv.services ? s.value)) THEN RAISE EXCEPTION 'IDENTIFIER_CONFLICT';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER campus_relation_root AFTER INSERT ON department_master.campus_relation_version DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION department_master.campus_relation_root_guard();

CREATE FUNCTION department_master.apply_evolution_campus_changes(p_actor text,p_event uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e department_master.evolution_event;w jsonb;r department_master.campus_relation;p department_master.campus_relation_version;did uuid;part jsonb;deps jsonb;
BEGIN
 SELECT * INTO e FROM department_master.evolution_event WHERE id=p_event;
 IF jsonb_typeof(e.facts->'campusChanges') IS DISTINCT FROM 'array' THEN RETURN;END IF;
 FOR w IN SELECT value FROM jsonb_array_elements(e.facts->'campusChanges') LOOP
  IF w->>'action'='END' THEN
   PERFORM department_master.lifecycle_relation_snapshot(p_actor,(w->>'relationId')::uuid,e.campus,'WRITE');
   SELECT * INTO r FROM department_master.campus_relation WHERE id=(w->>'relationId')::uuid;
   SELECT * INTO p FROM department_master.campus_relation_version WHERE relation_id=r.id ORDER BY number DESC LIMIT 1;
   IF p.number::text IS DISTINCT FROM w->>'expectedVersion' OR r.department_id::text IS DISTINCT FROM w->>'departmentId' OR p.action IN('END','MOVE_SOURCE') OR e.effective_at<=p.valid_from OR p.valid_to<=e.effective_at THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
   INSERT INTO department_master.campus_relation_version VALUES(uuidv7(),r.id,p.number+1,'END',p.services,p.valid_from,e.effective_at,e.recorded_at,e.id,p.dependencies);
  ELSIF w->>'action'='ASSIGN' THEN
   IF w->>'departmentAlias' IS NOT NULL THEN SELECT to_department_id INTO did FROM department_master.evolution_relation WHERE event_id=e.id AND source_to_alias=w->>'departmentAlias' LIMIT 1;
   ELSE did:=(w->>'departmentId')::uuid;END IF;
   IF did IS NULL OR NOT EXISTS(SELECT 1 FROM department_master.evolution_relation WHERE event_id=e.id AND to_department_id=did) OR (w->>'validFrom')::timestamp IS DISTINCT FROM e.effective_at THEN RAISE EXCEPTION 'RELATION_ROOT_MISMATCH';END IF;
   SELECT jsonb_build_array(jsonb_build_object('from',w->>'validFrom','to',w->>'validTo','versionId',id,'version',number::text)) INTO part FROM department_master.version WHERE department_id=did AND evolution_event_id=e.id ORDER BY number DESC LIMIT 1;
   deps:=w->'dependencies'||jsonb_build_object('departmentParts',part);
   INSERT INTO department_master.campus_relation(department_id,campus_id,subject_id,governance_scope) VALUES(did,(w->>'campusId')::uuid,(w->>'subjectId')::uuid,e.campus) RETURNING * INTO r;
   INSERT INTO department_master.campus_relation_version VALUES(uuidv7(),r.id,1,'ASSIGN',w->'services',e.effective_at,(w->>'validTo')::timestamp,e.recorded_at,e.id,deps);
  ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 END LOOP;
END $$;

DO $bundle$
DECLARE body text;needle text:=' INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,e.id,''EVOLUTION_APPLY''';
BEGIN
 body:=pg_get_functiondef('department_master.evolution_mutate(text,text)'::regprocedure);
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'EVOLUTION_BUNDLE_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,' PERFORM department_master.apply_evolution_campus_changes(actor,e.id);'||chr(10)||needle);
 body:=pg_get_functiondef('department_master.campus_relation_impact_result(text,jsonb,text)'::regprocedure);
 IF position('fact->>''owner''=''department-master/lifecycle'' AND fact->>''id''=o.id::text' IN body)=0 THEN RAISE EXCEPTION 'RELATION_PROOF_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,'fact->>''owner''=''department-master/lifecycle'' AND fact->>''id''=o.id::text','((fact->>''owner''=''department-master/lifecycle'' AND fact->>''id''=o.id::text) OR (fact->>''owner''=''department-master/organization-evolution'' AND fact->>''id''=v.operation_id::text AND EXISTS(SELECT 1 FROM department_master.evolution_event WHERE id=v.operation_id)))');
END $bundle$;
REVOKE ALL ON FUNCTION department_master.campus_relation_root_guard(),department_master.apply_evolution_campus_changes(text,uuid) FROM PUBLIC,hdi_prototype;
