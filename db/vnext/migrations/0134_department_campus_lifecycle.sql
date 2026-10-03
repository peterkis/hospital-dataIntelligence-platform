SELECT pg_advisory_xact_lock(901002);

CREATE TABLE department_master.lifecycle_input(
 id uuid PRIMARY KEY DEFAULT uuidv7(),revision uuid NOT NULL DEFAULT uuidv7(),
 job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),job_revision uuid NOT NULL REFERENCES governance_catalog.import_input_revision(id),
 maker text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,
 digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),
 department_ids jsonb NOT NULL CHECK(jsonb_typeof(department_ids)='array'),envelope jsonb NOT NULL,
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(job_id,job_revision)
);
CREATE TABLE department_master.lifecycle_verification(
 id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL REFERENCES department_master.lifecycle_input(id),number bigint NOT NULL,
 actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL,envelope jsonb NOT NULL,
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(input_id,number)
);
CREATE TABLE department_master.lifecycle_operation(
 id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL UNIQUE REFERENCES department_master.lifecycle_input(id),
 recorded_at timestamp NOT NULL,content_digest text NOT NULL,assessment jsonb NOT NULL,results jsonb NOT NULL
);
CREATE TABLE department_master.lifecycle_version(
 id uuid PRIMARY KEY DEFAULT uuidv7(),department_id uuid NOT NULL REFERENCES department_master.department(id),number bigint NOT NULL,
 action text NOT NULL CHECK(action IN ('SUSPEND','RESUME','DEPRECATE')),effective_at timestamp NOT NULL,recorded_at timestamp NOT NULL,
 operation_id uuid NOT NULL REFERENCES department_master.lifecycle_operation(id) DEFERRABLE INITIALLY DEFERRED,UNIQUE(department_id,number)
);
CREATE TABLE department_master.campus_relation(
 id uuid PRIMARY KEY DEFAULT uuidv7(),department_id uuid NOT NULL REFERENCES department_master.department(id),
 campus_id uuid NOT NULL REFERENCES organization_master.campus(id),subject_id uuid NOT NULL REFERENCES organization_master.subject(id),
 governance_scope text NOT NULL CHECK(governance_scope IN ('NORTH','SOUTH'))
);
CREATE TABLE department_master.campus_relation_version(
 id uuid PRIMARY KEY DEFAULT uuidv7(),relation_id uuid NOT NULL REFERENCES department_master.campus_relation(id),number bigint NOT NULL,
 action text NOT NULL CHECK(action IN ('ASSIGN','REVISE','END','MOVE_SOURCE','MOVE_TARGET')),services jsonb NOT NULL CHECK(jsonb_typeof(services)='array' AND jsonb_array_length(services)>0),
 valid_from timestamp NOT NULL,valid_to timestamp,recorded_at timestamp NOT NULL,operation_id uuid NOT NULL REFERENCES department_master.lifecycle_operation(id) DEFERRABLE INITIALLY DEFERRED,
 dependencies jsonb NOT NULL,UNIQUE(relation_id,number),CHECK(valid_to IS NULL OR valid_to>valid_from)
);
CREATE INDEX campus_relation_department ON department_master.campus_relation(department_id);
CREATE INDEX lifecycle_department_time ON department_master.lifecycle_version(department_id,number);

CREATE FUNCTION department_master.lifecycle_authorize(p_actor text,p_scope text,p_permission text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 RETURN department_master.authorize(p_actor,CASE WHEN p_permission IN ('REVIEW','VERIFY') THEN 'HOSPITAL' ELSE p_scope END,p_permission);
END $$;

CREATE FUNCTION department_master.lifecycle_input_read(p_actor text,p_id uuid,p_permission text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r department_master.lifecycle_input;v department_master.lifecycle_verification;d jsonb;
BEGIN
 SELECT * INTO r FROM department_master.lifecycle_input WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM department_master.lifecycle_authorize(p_actor,r.campus,p_permission);
 PERFORM department_master.authorize(p_actor,r.campus,'READ_RESTRICTED');
 FOR d IN SELECT value FROM jsonb_array_elements(r.department_ids) LOOP PERFORM department_master.snapshot(p_actor,(d#>>'{}')::uuid);END LOOP;
 PERFORM governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));
 SELECT * INTO v FROM department_master.lifecycle_verification WHERE input_id=r.id ORDER BY number DESC LIMIT 1;
 RETURN to_jsonb(r)||jsonb_build_object('verification',CASE WHEN v.id IS NULL THEN NULL ELSE to_jsonb(v) END);
END $$;

CREATE FUNCTION department_master.lifecycle_state_periods(p_id uuid,p_asof timestamp) RETURNS tsmultirange
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE active tsmultirange:=tsmultirange(tsrange(NULL,NULL,'[)'));v department_master.lifecycle_version;r department_master.replacement;
BEGIN
 FOR v IN SELECT * FROM department_master.lifecycle_version WHERE department_id=p_id AND recorded_at<=p_asof ORDER BY number LOOP
  IF v.action='RESUME' THEN active:=active+tsmultirange(tsrange(v.effective_at,NULL,'[)'));
  ELSE active:=active-tsmultirange(tsrange(v.effective_at,NULL,'[)'));END IF;
 END LOOP;
 FOR v IN SELECT * FROM department_master.lifecycle_version WHERE department_id=p_id AND recorded_at<=p_asof AND action='DEPRECATE' LOOP active:=active-tsmultirange(tsrange(v.effective_at,NULL,'[)'));END LOOP;
 SELECT * INTO r FROM department_master.replacement WHERE department_id=p_id AND recorded_at<=p_asof;
 IF FOUND THEN active:=active-tsmultirange(tsrange(r.effective_at,NULL,'[)'));END IF;
 RETURN active;
END $$;

CREATE FUNCTION department_master.lifecycle_active_periods(p_id uuid,p_asof timestamp) RETURNS tsmultirange
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(range_agg(tsrange(valid_from,valid_to,'[)')),'{}'::tsmultirange)*department_master.lifecycle_state_periods(p_id,p_asof)
 FROM department_master.version WHERE department_id=p_id AND recorded_at<=p_asof
$$;

CREATE FUNCTION department_master.lifecycle_snapshot(p_actor text,p_id uuid,p_asof timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE asof timestamp:=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));h jsonb;events jsonb;relations jsonb;
BEGIN
 h:=department_master.snapshot(p_actor,p_id);
 SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('number',v.number::text) ORDER BY number),'[]'::jsonb) INTO events FROM department_master.lifecycle_version v WHERE department_id=p_id AND recorded_at<=asof;
 SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('versions',(SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('number',v.number::text) ORDER BY number),'[]'::jsonb) FROM department_master.campus_relation_version v WHERE v.relation_id=r.id AND v.recorded_at<=asof)) ORDER BY r.id),'[]'::jsonb) INTO relations
 FROM department_master.campus_relation r WHERE department_id=p_id AND EXISTS(SELECT 1 FROM department_master.campus_relation_version v WHERE relation_id=r.id AND recorded_at<=asof);
 RETURN jsonb_build_object('department',h,'lifecycle',events,'relations',relations,'replacement',department_master.replacement_read(p_actor,p_id,asof));
END $$;

CREATE FUNCTION department_master.lifecycle_admission(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE active tsmultirange;requested tsrange:=tsrange(p_from,p_to,'[)');parts jsonb;
BEGIN
 PERFORM department_master.snapshot(p_actor,p_id);
 IF p_from IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 active:=department_master.lifecycle_active_periods(p_id,coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp())))*tsmultirange(requested);
 SELECT coalesce(jsonb_agg(jsonb_build_object('from',to_char(lower(r),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',CASE WHEN upper_inf(r) THEN NULL ELSE to_char(upper(r),'YYYY-MM-DD"T"HH24:MI:SS.US') END) ORDER BY lower(r)),'[]'::jsonb) INTO parts FROM unnest(active) r;
 RETURN jsonb_build_object('owner','department-master','id',p_id,'covered',active @> requested,'parts',parts);
END $$;

CREATE FUNCTION department_master.lifecycle_mutate(p_ticket text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;
 actor text:=t->>'actor';op text:=t->>'operation';identity text;r department_master.lifecycle_input;j governance_catalog.import_job;
 verify department_master.lifecycle_verification;c governance_catalog.apply_candidate;a governance_catalog.apply_approval;
 operation_id uuid;now_at timestamp:=timezone('Asia/Shanghai',clock_timestamp());w jsonb;n bigint;rid uuid;vid uuid;result jsonb:='[]'::jsonb;
 relation department_master.campus_relation;previous department_master.campus_relation_version;other department_master.campus_relation_version;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.department_write_authority WHERE singleton;
 IF secret IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF op='STAGE' THEN
  identity:=department_master.lifecycle_authorize(actor,t->>'campus','WRITE');PERFORM department_master.authorize(actor,t->>'campus','READ_RESTRICTED');
  SELECT * INTO r FROM department_master.lifecycle_input WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF r.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);END IF;
  PERFORM governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',t->>'jobId'));SELECT * INTO j FROM governance_catalog.import_job WHERE id=(t->>'jobId')::uuid;
  IF j.submitter_identity IS DISTINCT FROM identity OR j.current_revision_id IS DISTINCT FROM (t->>'revisionId')::uuid OR j.contract_snapshot->>'dataset'<>'ORG04' OR j.profile<>'CORE' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
  INSERT INTO department_master.lifecycle_input(job_id,job_revision,maker,identity_code,request_id,digest,campus,department_ids,envelope)
  VALUES(j.id,j.current_revision_id,actor,identity,(t->>'requestId')::uuid,t->>'digest',t->>'campus',t->'departmentIds',t->'envelope') RETURNING * INTO r;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'DEPARTMENT_LIFECYCLE_INPUT','TEST_POLICY_ONLY',r.digest);
  RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);
 END IF;
 r:=jsonb_populate_record(NULL::department_master.lifecycle_input,department_master.lifecycle_input_read(actor,(t->>'inputId')::uuid,CASE WHEN op='VERIFY' THEN 'VERIFY' ELSE 'WRITE' END));
 IF op='VERIFY' THEN
  identity:=department_master.lifecycle_authorize(actor,r.campus,'VERIFY');IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
  IF r.digest IS DISTINCT FROM t->>'inputDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  SELECT * INTO verify FROM department_master.lifecycle_verification WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF verify.digest IS DISTINCT FROM t->>'digest' OR verify.input_id<>r.id THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('verificationId',verify.id);END IF;
  SELECT coalesce(max(number),0)+1 INTO n FROM department_master.lifecycle_verification WHERE input_id=r.id;
  INSERT INTO department_master.lifecycle_verification(input_id,number,actor,identity_code,request_id,digest,envelope) VALUES(r.id,n,actor,identity,(t->>'requestId')::uuid,t->>'digest',t->'envelope') RETURNING * INTO verify;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'DEPARTMENT_LIFECYCLE_VERIFY','INDEPENDENT_REVIEW',verify.digest);
  RETURN jsonb_build_object('verificationId',verify.id);
 END IF;
 IF op<>'APPLY' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF r.job_revision IS DISTINCT FROM (SELECT current_revision_id FROM governance_catalog.import_job WHERE id=r.job_id) THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 SELECT * INTO c FROM governance_catalog.apply_candidate WHERE id=(t->>'candidateId')::uuid;SELECT * INTO a FROM governance_catalog.apply_approval WHERE candidate_id=c.id;
 IF c.digest IS DISTINCT FROM t->>'digest' OR c.input->>'jobId' IS DISTINCT FROM r.id::text OR c.input->>'revisionId' IS DISTINCT FROM r.revision::text OR a.candidate_id IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 PERFORM governance_catalog.apply_record(a.actor_code,'CHECK_APPROVAL',jsonb_build_object('candidateId',c.id));PERFORM department_master.lifecycle_input_read(a.actor_code,r.id,'REVIEW');
 IF jsonb_array_length(t->'writes') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;
 operation_id:=uuidv7();
 FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP
  IF w->>'kind'='LIFECYCLE' THEN
   SELECT coalesce(max(number),0)+1 INTO n FROM department_master.lifecycle_version WHERE department_id=(w->>'departmentId')::uuid;
   IF EXISTS(SELECT 1 FROM department_master.lifecycle_version WHERE department_id=(w->>'departmentId')::uuid AND action='DEPRECATE' AND (effective_at<=now_at OR effective_at<=(w->>'effectiveAt')::timestamp)) OR EXISTS(SELECT 1 FROM department_master.replacement WHERE department_id=(w->>'departmentId')::uuid AND (effective_at<=now_at OR effective_at<=(w->>'effectiveAt')::timestamp)) THEN RAISE EXCEPTION 'UNSUPPORTED_STATE_TRANSITION';END IF;
   INSERT INTO department_master.lifecycle_version VALUES(uuidv7(),(w->>'departmentId')::uuid,n,w->>'action',(w->>'effectiveAt')::timestamp,now_at,operation_id);
   result:=result||jsonb_build_array(jsonb_build_object('kind','LIFECYCLE','id',w->>'departmentId','version',n::text));
  ELSE
   IF w->>'relationId' IS NULL THEN
    INSERT INTO department_master.campus_relation(department_id,campus_id,subject_id,governance_scope) VALUES((w->>'departmentId')::uuid,(w->>'campusId')::uuid,(w->>'subjectId')::uuid,r.campus) RETURNING * INTO relation;n:=1;
   ELSE
    SELECT * INTO relation FROM department_master.campus_relation WHERE id=(w->>'relationId')::uuid;
    IF relation.id IS NULL OR relation.governance_scope<>r.campus OR relation.department_id<>(w->>'departmentId')::uuid THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
    SELECT * INTO previous FROM department_master.campus_relation_version WHERE relation_id=relation.id ORDER BY number DESC LIMIT 1;
    IF previous.number::text IS DISTINCT FROM w->>'expectedVersion' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;n:=previous.number+1;
   END IF;
   rid:=relation.id;vid:=uuidv7();
   INSERT INTO department_master.campus_relation_version VALUES(vid,rid,n,w->>'action',w->'services',(w->>'validFrom')::timestamp,(w->>'validTo')::timestamp,now_at,operation_id,w->'dependencies');
   result:=result||jsonb_build_array(jsonb_build_object('kind','RELATION','id',rid,'version',n::text,'versionId',vid));
  END IF;
 END LOOP;
 -- Compare the final whole-period versions, including writes earlier in this root operation.
 FOR relation IN SELECT * FROM department_master.campus_relation WHERE department_id IN(SELECT (value#>>'{}')::uuid FROM jsonb_array_elements(r.department_ids)) LOOP
  SELECT * INTO previous FROM department_master.campus_relation_version WHERE relation_id=relation.id ORDER BY number DESC LIMIT 1;
  FOR other IN SELECT DISTINCT ON(v.relation_id) v.* FROM department_master.campus_relation_version v JOIN department_master.campus_relation cr ON cr.id=v.relation_id WHERE cr.department_id=relation.department_id AND cr.campus_id=relation.campus_id AND cr.id<>relation.id ORDER BY v.relation_id,v.number DESC LOOP
   IF tsrange(previous.valid_from,previous.valid_to,'[)')&&tsrange(other.valid_from,other.valid_to,'[)') AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(previous.services) s JOIN jsonb_array_elements_text(other.services) o ON s.value=o.value) THEN RAISE EXCEPTION 'IDENTIFIER_CONFLICT';END IF;
  END LOOP;
 END LOOP;
 INSERT INTO department_master.lifecycle_operation VALUES(operation_id,r.id,now_at,t->>'contentDigest',t->'assessment',result);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,operation_id,'DEPARTMENT_LIFECYCLE_APPLY','APPROVED_ATOMIC_UNIT',t->>'contentDigest');
 RETURN jsonb_build_object('owner','department-master/lifecycle','id',operation_id,'version','1');
END $$;

DO $$ DECLARE name text; BEGIN
 FOR name IN SELECT unnest(ARRAY['lifecycle_input','lifecycle_verification','lifecycle_operation','lifecycle_version','campus_relation','campus_relation_version']) LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON department_master.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',name);
 END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA department_master FROM PUBLIC,hdi_prototype;
REVOKE ALL ON FUNCTION department_master.lifecycle_authorize(text,text,text),department_master.lifecycle_input_read(text,uuid,text),department_master.lifecycle_active_periods(uuid,timestamp),department_master.lifecycle_snapshot(text,uuid,timestamp),department_master.lifecycle_admission(text,uuid,timestamp,timestamp,timestamp),department_master.lifecycle_mutate(text,text) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION department_master.lifecycle_result_exists(p_actor text,p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i uuid;BEGIN SELECT input_id INTO i FROM department_master.lifecycle_operation WHERE id=p_id;IF i IS NULL THEN RETURN false;END IF;PERFORM department_master.lifecycle_input_read(p_actor,i,'READ');RETURN true;END $$;
REVOKE ALL ON FUNCTION department_master.lifecycle_result_exists(text,uuid) FROM PUBLIC,hdi_prototype;

-- Reuse the existing Owner guard so ordinary revisions, mappings and identifiers
-- cannot open a path around lifecycle admission. Earlier explicit shrink exits remain.
DO $repair$
DECLARE body text;needle text:=' SELECT effective_at INTO boundary FROM department_master.replacement WHERE department_id=target;';
BEGIN
 body:=pg_get_functiondef('department_master.guard_replaced_department()'::regprocedure);
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'LIFECYCLE_GUARD_PREDECESSOR_MISMATCH';END IF;
 body:=replace(body,needle,$insert$
 IF NOT (department_master.lifecycle_state_periods(target,timezone('Asia/Shanghai',clock_timestamp())) @> tsrange(NEW.valid_from,NEW.valid_to,'[)')) OR EXISTS(SELECT 1 FROM department_master.lifecycle_version WHERE department_id=target AND action='DEPRECATE' AND effective_at<=timezone('Asia/Shanghai',clock_timestamp())) THEN RAISE EXCEPTION 'UNSUPPORTED_STATE_TRANSITION';END IF;
$insert$||needle);
 EXECUTE body;
END $repair$;

CREATE FUNCTION department_master.lifecycle_relation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r department_master.campus_relation;p department_master.campus_relation_version;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);SELECT * INTO r FROM department_master.campus_relation WHERE id=NEW.relation_id;
 SELECT * INTO p FROM department_master.campus_relation_version WHERE relation_id=r.id ORDER BY number DESC LIMIT 1;
 IF p.id IS NOT NULL AND NEW.valid_from>=p.valid_from AND (p.valid_to IS NULL OR NEW.valid_to IS NOT NULL AND NEW.valid_to<=p.valid_to) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.services) s WHERE NOT p.services ? s.value) THEN RETURN NEW;END IF;
 IF NOT (department_master.lifecycle_active_periods(r.department_id,timezone('Asia/Shanghai',clock_timestamp())) @> tsrange(NEW.valid_from,NEW.valid_to,'[)')) OR EXISTS(SELECT 1 FROM department_master.lifecycle_version WHERE department_id=r.department_id AND action='DEPRECATE' AND effective_at<=timezone('Asia/Shanghai',clock_timestamp())) THEN RAISE EXCEPTION 'UNSUPPORTED_STATE_TRANSITION';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_admission BEFORE INSERT ON department_master.campus_relation_version FOR EACH ROW EXECUTE FUNCTION department_master.lifecycle_relation_guard();
REVOKE ALL ON FUNCTION department_master.lifecycle_state_periods(uuid,timestamp),department_master.lifecycle_relation_guard() FROM PUBLIC,hdi_prototype;
