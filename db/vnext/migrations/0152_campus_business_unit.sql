SELECT pg_advisory_xact_lock(901002);
CREATE SCHEMA care_organization;
GRANT USAGE ON SCHEMA care_organization TO hdi_prototype;
CREATE TABLE vnext_control.unit_write_authority(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),key_hex text NOT NULL CHECK(key_hex ~ '^[a-f0-9]{64}$'));
CREATE TABLE care_organization.access(actor text NOT NULL REFERENCES vnext_control.actor(code),campus_id uuid NOT NULL REFERENCES organization_master.campus(id),scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')),permission text NOT NULL CHECK(permission IN ('READ','WRITE','REVIEW','VERIFY','READ_RESTRICTED')),PRIMARY KEY(actor,campus_id,scope,permission));
CREATE TABLE care_organization.input(id uuid PRIMARY KEY DEFAULT uuidv7(),revision uuid NOT NULL DEFAULT uuidv7(),job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),job_revision uuid NOT NULL REFERENCES governance_catalog.import_input_revision(id),maker text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),campus_ids uuid[] NOT NULL CHECK(cardinality(campus_ids)>0),scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')),envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(job_id,job_revision));
CREATE TABLE care_organization.verification(id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL REFERENCES care_organization.input(id),number bigint NOT NULL CHECK(number>0),actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL,envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(input_id,number));
CREATE TABLE care_organization.unit(id uuid PRIMARY KEY DEFAULT uuidv7(),department_id uuid NOT NULL REFERENCES department_master.department(id));
CREATE TABLE care_organization.code(code text PRIMARY KEY CHECK(length(code) BETWEEN 1 AND 256 AND code ~ '\S'),unit_id uuid NOT NULL REFERENCES care_organization.unit(id));
CREATE TABLE care_organization.change(id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL UNIQUE REFERENCES care_organization.input(id),candidate_id uuid NOT NULL UNIQUE REFERENCES governance_catalog.apply_candidate(id),digest text NOT NULL,results jsonb NOT NULL,recorded_at timestamp NOT NULL);
CREATE TABLE care_organization.apply_binding(candidate_id uuid PRIMARY KEY REFERENCES governance_catalog.apply_candidate(id),input_id uuid NOT NULL REFERENCES care_organization.input(id),candidate_digest text NOT NULL,writes_digest text NOT NULL,writes_hash text NOT NULL);
CREATE TABLE care_organization.version(id uuid PRIMARY KEY DEFAULT uuidv7(),unit_id uuid NOT NULL REFERENCES care_organization.unit(id),number bigint NOT NULL CHECK(number>0),action text NOT NULL CHECK(action IN ('CREATE','REVISE','REBIND','CLOSE')),valid_from timestamp NOT NULL,valid_to timestamp,facts jsonb NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),change_id uuid NOT NULL REFERENCES care_organization.change(id) DEFERRABLE INITIALLY DEFERRED,recorded_at timestamp NOT NULL,UNIQUE(unit_id,number),CHECK(valid_to IS NULL OR valid_to>valid_from),CHECK(action<>'CLOSE' OR valid_to IS NULL));
CREATE TABLE care_organization.unit_binding(id uuid PRIMARY KEY DEFAULT uuidv7(),unit_id uuid NOT NULL REFERENCES care_organization.unit(id),campus_id uuid NOT NULL REFERENCES organization_master.campus(id),subject_id uuid NOT NULL REFERENCES organization_master.subject(id),scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')));
CREATE TABLE care_organization.binding_version(id uuid PRIMARY KEY DEFAULT uuidv7(),binding_id uuid NOT NULL REFERENCES care_organization.unit_binding(id),number bigint NOT NULL CHECK(number>0),valid_from timestamp NOT NULL,valid_to timestamp,binding jsonb NOT NULL,dependencies jsonb NOT NULL,change_id uuid NOT NULL REFERENCES care_organization.change(id) DEFERRABLE INITIALLY DEFERRED,recorded_at timestamp NOT NULL,UNIQUE(binding_id,number),CHECK(valid_to IS NULL OR valid_to>valid_from));
CREATE INDEX unit_department ON care_organization.unit(department_id);
CREATE INDEX unit_binding_campus ON care_organization.unit_binding(campus_id,unit_id);
CREATE FUNCTION care_organization.authorize(p_actor text,p_campus uuid,p_permission text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;c jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF p_permission NOT IN ('READ','WRITE','REVIEW','VERIFY','READ_RESTRICTED') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC',CASE WHEN p_permission IN ('REVIEW','VERIFY') THEN 'REVIEW' WHEN p_permission='WRITE' THEN 'WRITE' ELSE 'READ' END);
 c:=organization_master.campus_snapshot(p_actor,p_campus);
 IF NOT EXISTS(SELECT 1 FROM care_organization.access WHERE actor=p_actor AND campus_id=p_campus AND scope=c->>'scope' AND permission=p_permission) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;RETURN identity;
END $$;
CREATE FUNCTION care_organization.input_read(p_actor text,p_id uuid,p_permission text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r care_organization.input;v care_organization.verification;campus uuid;BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');SELECT * INTO r FROM care_organization.input WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 FOREACH campus IN ARRAY r.campus_ids LOOP PERFORM care_organization.authorize(p_actor,campus,p_permission);PERFORM care_organization.authorize(p_actor,campus,'READ');END LOOP;
 PERFORM governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));
 IF p_permission='READ_RESTRICTED' THEN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'UNIT_READ_RESTRICTED','ORG07_SOURCE',r.digest);END IF;
 SELECT * INTO v FROM care_organization.verification WHERE input_id=r.id ORDER BY number DESC LIMIT 1;
 RETURN to_jsonb(r)||jsonb_build_object('verification',CASE WHEN v.id IS NULL THEN NULL ELSE to_jsonb(v) END);
END $$;
CREATE FUNCTION care_organization.job_read(p_actor text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;BEGIN r:=care_organization.input_read(p_actor,p_id,'READ_RESTRICTED');RETURN governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r->>'job_id'));END $$;
CREATE FUNCTION care_organization.snapshot(p_actor text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u care_organization.unit;bound care_organization.unit_binding;BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');SELECT * INTO u FROM care_organization.unit WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM department_master.snapshot(p_actor,u.department_id);
 FOR bound IN SELECT * FROM care_organization.unit_binding WHERE unit_id=u.id LOOP PERFORM care_organization.authorize(p_actor,bound.campus_id,'READ');PERFORM organization_master.operating_pair(p_actor,bound.subject_id,bound.campus_id,'RELATION');END LOOP;
 RETURN jsonb_build_object('id',u.id,'departmentId',u.department_id,'codes',coalesce((SELECT jsonb_agg(code ORDER BY code) FROM care_organization.code WHERE unit_id=u.id),'[]'),'versions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'number',v.number::text,'action',v.action,'validFrom',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordedAt',to_char(v.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'facts',v.facts,'reason',v.reason,'changeId',v.change_id) ORDER BY v.number) FROM care_organization.version v WHERE v.unit_id=u.id),'[]'),'bindings',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'campusId',b.campus_id,'subjectId',b.subject_id,'scope',b.scope,'versions',(SELECT jsonb_agg(jsonb_build_object('id',v.id,'number',v.number::text,'validFrom',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordedAt',to_char(v.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'binding',v.binding,'dependencies',v.dependencies,'changeId',v.change_id) ORDER BY v.number) FROM care_organization.binding_version v WHERE v.binding_id=b.id)) ORDER BY b.id) FROM care_organization.unit_binding b WHERE b.unit_id=u.id),'[]'));
END $$;
CREATE FUNCTION care_organization.list(p_actor text,p_scope text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u record;result jsonb:='[]';BEGIN
 IF p_scope NOT IN ('NORTH','SOUTH') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 FOR u IN SELECT DISTINCT unit_id FROM care_organization.unit_binding WHERE scope=p_scope ORDER BY unit_id LOOP result:=result||jsonb_build_array(care_organization.snapshot(p_actor,u.unit_id));END LOOP;RETURN result;
END $$;
CREATE FUNCTION care_organization.local_time(p_value text) RETURNS timestamp LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE result timestamp;BEGIN IF p_value IS NULL OR p_value !~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?$' THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED';END IF;BEGIN result:=p_value::timestamp;EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED';END;RETURN result;END $$;
CREATE FUNCTION care_organization.closed(p_value jsonb,p_keys text[]) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR p_value-p_keys<>'{}'::jsonb OR NOT p_value ?& p_keys THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;END $$;
CREATE FUNCTION care_organization.validate_bindings(p_unit uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a record;b record;BEGIN
 FOR a IN SELECT DISTINCT ON(binding_id) v.* FROM care_organization.binding_version v JOIN care_organization.unit_binding u ON u.id=v.binding_id WHERE u.unit_id=p_unit ORDER BY binding_id,number DESC LOOP
  FOR b IN SELECT DISTINCT ON(binding_id) v.* FROM care_organization.binding_version v JOIN care_organization.unit_binding u ON u.id=v.binding_id WHERE u.unit_id=p_unit AND binding_id<>a.binding_id ORDER BY binding_id,number DESC LOOP
   IF tsrange(a.valid_from,a.valid_to,'[)')&&tsrange(b.valid_from,b.valid_to,'[)') THEN RAISE EXCEPTION 'UNIT_BINDING_CONFLICT';END IF;
  END LOOP;
 END LOOP;
END $$;
CREATE FUNCTION care_organization.mutate(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;actor text:=t->>'actor';op text:=t->>'operation';identity text;r care_organization.input;j jsonb;verify care_organization.verification;c jsonb;approved_by text;frozen care_organization.apply_binding;change care_organization.change;previous care_organization.version;at_version care_organization.version;w jsonb;bc jsonb;target uuid;bid uuid;bp care_organization.binding_version;br care_organization.unit_binding;u care_organization.unit;results jsonb:='[]';from_at timestamp;to_at timestamp;record_at timestamp:=timezone('Asia/Shanghai',clock_timestamp());root_id uuid;campus uuid;campuses uuid[];campus_state jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.unit_write_authority WHERE singleton;
 IF secret IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF op='STAGE' THEN
  PERFORM care_organization.closed(t,ARRAY['operation','actor','transaction','requestId','jobId','revisionId','campus','campusIds','digest','envelope']);
  SELECT array_agg(value::uuid) INTO campuses FROM jsonb_array_elements_text(t->'campusIds');IF cardinality(campuses) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  FOREACH campus IN ARRAY campuses LOOP identity:=care_organization.authorize(actor,campus,'WRITE');PERFORM care_organization.authorize(actor,campus,'READ_RESTRICTED');END LOOP;
  SELECT * INTO r FROM care_organization.input WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF r.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);END IF;
  j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',t->>'jobId'));
  IF j->>'submitterIdentity' IS DISTINCT FROM identity OR j->>'currentRevisionId' IS DISTINCT FROM t->>'revisionId' OR j->'contract'->>'dataset'<>'ORG07' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
  INSERT INTO care_organization.input(job_id,job_revision,maker,identity_code,request_id,digest,campus_ids,scope,envelope) VALUES((j->>'id')::uuid,(j->>'currentRevisionId')::uuid,actor,identity,(t->>'requestId')::uuid,t->>'digest',campuses,t->>'campus',t->'envelope') RETURNING * INTO r;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'UNIT_INPUT','ORG07_CORE',r.digest);RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);
 END IF;
 r:=jsonb_populate_record(NULL::care_organization.input,care_organization.input_read(actor,(t->>'inputId')::uuid,CASE WHEN op='VERIFY' THEN 'VERIFY' ELSE 'WRITE' END));
 IF op='VERIFY' THEN
  PERFORM care_organization.closed(t,ARRAY['operation','actor','transaction','inputId','inputDigest','requestId','digest','envelope']);
  identity:=vnext_control.authorize(actor,'SYNTHETIC','REVIEW');IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;IF r.digest IS DISTINCT FROM t->>'inputDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  SELECT * INTO verify FROM care_organization.verification WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF verify.input_id<>r.id OR verify.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('verificationId',verify.id);END IF;
  IF EXISTS(SELECT 1 FROM care_organization.change WHERE input_id=r.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
  INSERT INTO care_organization.verification(input_id,number,actor,identity_code,request_id,digest,envelope) VALUES(r.id,(SELECT coalesce(max(number),0)+1 FROM care_organization.verification WHERE input_id=r.id),actor,identity,(t->>'requestId')::uuid,t->>'digest',t->'envelope') RETURNING * INTO verify;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'UNIT_VERIFY','RECEIVING_BASIS',verify.digest);RETURN jsonb_build_object('verificationId',verify.id);
 END IF;
 IF op NOT IN ('FREEZE','APPLY') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 c:=governance_catalog.apply_record(actor,'READ_CANDIDATE',jsonb_build_object('candidateId',(t->>'candidateId')::uuid));
 IF c->>'digest' IS DISTINCT FROM t->>'digest' OR c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 IF op='FREEZE' THEN
  PERFORM care_organization.closed(t,ARRAY['operation','actor','transaction','inputId','writes','writesDigest','candidateId','digest']);
  INSERT INTO care_organization.apply_binding VALUES((c->>'id')::uuid,r.id,c->>'digest',t->>'writesDigest',encode(sha256(convert_to((t->'writes')::text,'UTF8')),'hex'));RETURN '{}';
 END IF;
 PERFORM care_organization.closed(t,ARRAY['operation','actor','transaction','inputId','writes','writeIndex','writesDigest','candidateId','digest']);
 approved_by:=c->>'approvedBy';IF approved_by IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;PERFORM governance_catalog.apply_record(approved_by,'CHECK_APPROVAL',jsonb_build_object('candidateId',(c->>'id')::uuid));
 FOREACH campus IN ARRAY r.campus_ids LOOP identity:=care_organization.authorize(approved_by,campus,'REVIEW');IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;END LOOP;
 SELECT * INTO frozen FROM care_organization.apply_binding WHERE candidate_id=(c->>'id')::uuid;
 IF NOT FOUND OR frozen.input_id<>r.id OR frozen.candidate_digest IS DISTINCT FROM t->>'digest' OR frozen.writes_digest IS DISTINCT FROM t->>'writesDigest' OR ((t->>'writeIndex')::integer=1 AND frozen.writes_hash IS DISTINCT FROM encode(sha256(convert_to((t->'writes')::text,'UTF8')),'hex')) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 SELECT * INTO change FROM care_organization.change WHERE input_id=r.id;
 IF FOUND THEN IF change.candidate_id<>(c->>'id')::uuid OR change.digest IS DISTINCT FROM t->>'writesDigest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN change.results->((t->>'writeIndex')::integer-1);END IF;
 j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));IF r.job_revision IS DISTINCT FROM (j->>'currentRevisionId')::uuid THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 IF jsonb_typeof(t->'writes') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'writes') NOT BETWEEN 1 AND 100 OR (t->>'writeIndex')::integer<>1 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;root_id:=uuidv7();
 FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP
  PERFORM care_organization.closed(w,ARRAY['key','targetId','expectedHead','action','validFrom','validTo','facts','binding','bindingChanges','reason','sourceRow','scope']);
  from_at:=care_organization.local_time(w->>'validFrom');to_at:=CASE WHEN w->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(w->>'validTo') END;IF to_at IS NOT NULL AND to_at<=from_at THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
  IF w->>'action'='CREATE' THEN
   IF w->>'targetId' IS NOT NULL OR w->>'expectedHead' IS NOT NULL OR jsonb_array_length(w->'bindingChanges')<>1 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
   INSERT INTO care_organization.unit(department_id) VALUES((w->'binding'->'department'->>'id')::uuid) RETURNING * INTO u;target:=u.id;previous:=NULL;
  ELSE
   target:=(w->>'targetId')::uuid;PERFORM care_organization.snapshot(actor,target);SELECT * INTO u FROM care_organization.unit WHERE id=target;SELECT * INTO previous FROM care_organization.version WHERE unit_id=target ORDER BY number DESC LIMIT 1;
   IF previous.number::text IS DISTINCT FROM w->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;IF EXISTS(SELECT 1 FROM care_organization.version WHERE unit_id=target AND action='CLOSE') THEN RAISE EXCEPTION 'UNIT_CLOSED';END IF;
  END IF;
  IF w->>'action' NOT IN ('CREATE','REVISE','REBIND','CLOSE') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF w->>'action'='CLOSE' THEN
   SELECT * INTO at_version FROM care_organization.version WHERE unit_id=target AND action<>'CLOSE' AND valid_from<=from_at AND (valid_to IS NULL OR from_at<=valid_to) ORDER BY number DESC LIMIT 1;
   IF to_at IS NOT NULL OR at_version.id IS NULL OR (w->'facts'-ARRAY['source','contractVersionId','receivingBasis']) IS DISTINCT FROM (at_version.facts-ARRAY['source','contractVersionId','receivingBasis']) THEN RAISE EXCEPTION 'UNIT_CLOSURE_EXPANSION';END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM care_organization.code WHERE code=w->'facts'->>'unitCode' AND unit_id<>target) THEN RAISE EXCEPTION 'UNIT_CODE_CONFLICT';END IF;
  INSERT INTO care_organization.code VALUES(w->'facts'->>'unitCode',target) ON CONFLICT DO NOTHING;
  FOR bc IN SELECT value FROM jsonb_array_elements(w->'bindingChanges') LOOP
   PERFORM care_organization.closed(bc,ARRAY['id','expectedHead','validFrom','validTo','binding','dependencies']);
   IF bc->'binding'->'department'->>'id' IS DISTINCT FROM u.department_id::text OR bc->'binding'->'department'->>'owner'<>'department-master' OR bc->'binding'->'campus'->>'owner'<>'organization-master/campus' OR bc->'binding'->'subject'->>'owner'<>'organization-master' OR bc->'binding'->'relation'->>'owner'<>'department-master/campus-relation' THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
   campus:=(bc->'binding'->'campus'->>'id')::uuid;PERFORM care_organization.authorize(actor,campus,'WRITE');PERFORM care_organization.authorize(approved_by,campus,'REVIEW');campus_state:=organization_master.campus_snapshot(actor,campus);
   IF bc->>'id' IS NULL THEN
    IF bc->>'expectedHead' IS NOT NULL OR w->>'action' NOT IN ('CREATE','REBIND') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
    INSERT INTO care_organization.unit_binding(unit_id,campus_id,subject_id,scope) VALUES(target,campus,(bc->'binding'->'subject'->>'id')::uuid,campus_state->>'scope') RETURNING * INTO br;bid:=br.id;bp:=NULL;
   ELSE
    bid:=(bc->>'id')::uuid;SELECT * INTO br FROM care_organization.unit_binding WHERE id=bid;SELECT * INTO bp FROM care_organization.binding_version WHERE binding_id=bid ORDER BY number DESC LIMIT 1;
    IF br.unit_id IS DISTINCT FROM target OR br.campus_id IS DISTINCT FROM campus OR br.subject_id::text IS DISTINCT FROM bc->'binding'->'subject'->>'id' OR bp.number::text IS DISTINCT FROM bc->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
    IF w->>'action'='CLOSE' AND (care_organization.local_time(bc->>'validFrom')<>bp.valid_from OR bc->>'validTo' IS NULL OR care_organization.local_time(bc->>'validTo')>coalesce(bp.valid_to,'infinity'::timestamp) OR bc->'binding' IS DISTINCT FROM bp.binding) THEN RAISE EXCEPTION 'UNIT_CLOSURE_EXPANSION';END IF;
   END IF;
   INSERT INTO care_organization.binding_version(binding_id,number,valid_from,valid_to,binding,dependencies,change_id,recorded_at) VALUES(bid,coalesce(bp.number,0)+1,care_organization.local_time(bc->>'validFrom'),CASE WHEN bc->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(bc->>'validTo') END,bc->'binding',bc->'dependencies',root_id,record_at);
  END LOOP;
  INSERT INTO care_organization.version(unit_id,number,action,valid_from,valid_to,facts,reason,change_id,recorded_at) VALUES(target,coalesce(previous.number,0)+1,w->>'action',from_at,to_at,w->'facts',w->>'reason',root_id,record_at);
  PERFORM care_organization.validate_bindings(target);
  results:=results||jsonb_build_array(jsonb_build_object('owner','care-organization/unit','id',target,'version',(coalesce(previous.number,0)+1)::text,'source',jsonb_build_object('dataset','ORG07','row',(w->>'sourceRow')::integer,'step',w->>'action')));
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,target,'UNIT_'||(w->>'action'),'APPROVED_UNIT_COMMAND',t->>'writesDigest');
 END LOOP;
 INSERT INTO care_organization.change VALUES(root_id,r.id,(c->>'id')::uuid,t->>'writesDigest',results,record_at);RETURN results->0;
END $$;
CREATE FUNCTION care_organization.audit_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(coalesce(NEW.actor,OLD.actor),coalesce(NEW.campus_id,OLD.campus_id),'UNIT_AUTHORIZATION',TG_OP,encode(sha256(convert_to(coalesce(to_jsonb(NEW),to_jsonb(OLD))::text,'UTF8')),'hex'));RETURN coalesce(NEW,OLD);END $$;
CREATE TRIGGER access_lock BEFORE INSERT OR UPDATE OR DELETE ON care_organization.access FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER access_audit AFTER INSERT OR UPDATE OR DELETE ON care_organization.access FOR EACH ROW EXECUTE FUNCTION care_organization.audit_access();
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['input','verification','unit','code','change','version','unit_binding','binding_version','apply_binding'] LOOP EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON care_organization.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',tab);END LOOP;
 FOREACH tab IN ARRAY ARRAY['access','input','verification','unit','code','change','version','unit_binding','binding_version','apply_binding'] LOOP EXECUTE format('ALTER TABLE care_organization.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('REVOKE ALL ON care_organization.%I FROM PUBLIC,hdi_prototype',tab);END LOOP;
END $$;
REVOKE ALL ON vnext_control.unit_write_authority FROM PUBLIC,hdi_prototype;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA care_organization FROM PUBLIC,hdi_prototype;
