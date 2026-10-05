SELECT pg_advisory_xact_lock(901002);
CREATE TABLE care_organization.subject_access(actor text NOT NULL REFERENCES vnext_control.actor(code),subject_id uuid NOT NULL REFERENCES organization_master.subject(id),campus_id uuid NOT NULL REFERENCES organization_master.campus(id),target_type text NOT NULL CHECK(target_type IN ('LEGAL','ORG','UNIT')),target_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('MAPPING','PERMISSION')),permission text NOT NULL CHECK(permission IN ('READ','WRITE','VERIFY','REVIEW','READ_RESTRICTED')),PRIMARY KEY(actor,subject_id,campus_id,target_type,target_id,kind,permission));
CREATE TABLE care_organization.subject_relation(id uuid PRIMARY KEY DEFAULT uuidv7(),kind text NOT NULL CHECK(kind IN ('MAPPING','PERMISSION')),scope jsonb NOT NULL,source_system_id uuid NOT NULL REFERENCES governance_catalog.object(id),source_alias text NOT NULL,UNIQUE(kind,source_system_id,source_alias));
CREATE TABLE care_organization.subject_relation_version(id uuid PRIMARY KEY DEFAULT uuidv7(),relation_id uuid NOT NULL REFERENCES care_organization.subject_relation(id),number bigint NOT NULL CHECK(number>0),action text NOT NULL CHECK(action IN ('RECORD','REVISE','RETIRE')),valid_from timestamp NOT NULL,valid_to timestamp,facts jsonb NOT NULL,recorded_at timestamp NOT NULL,reason text NOT NULL,UNIQUE(relation_id,number),CHECK(valid_to IS NULL OR valid_to>valid_from));
CREATE FUNCTION care_organization.subject_authorize(p_actor text,p_scope jsonb,p_kind text,p_permission text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;campus jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF p_kind NOT IN ('MAPPING','PERMISSION') OR p_permission NOT IN ('READ','WRITE','VERIFY','REVIEW','READ_RESTRICTED') OR p_scope->'subject'->>'owner' IS DISTINCT FROM 'organization-master' OR p_scope->'campus'->>'owner' IS DISTINCT FROM 'organization-master/campus' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC',CASE WHEN p_permission IN ('VERIFY','REVIEW') THEN 'REVIEW' WHEN p_permission='WRITE' THEN 'WRITE' ELSE 'READ' END);
 IF p_permission IN ('WRITE','VERIFY','REVIEW') AND NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=p_actor AND active AND principal_kind='HUMAN') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF NOT EXISTS(SELECT 1 FROM care_organization.subject_access WHERE actor=p_actor AND subject_id=(p_scope->'subject'->>'id')::uuid AND campus_id=(p_scope->'campus'->>'id')::uuid AND target_type=p_scope->'target'->>'type' AND target_id=(p_scope->'target'->>'id')::uuid AND kind=p_kind AND permission=p_permission) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 campus:=organization_master.campus_snapshot(p_actor,(p_scope->'campus'->>'id')::uuid);PERFORM organization_master.snapshot(p_actor,(p_scope->'subject'->>'id')::uuid,campus->>'scope');
 IF p_scope->'target'->>'type'='UNIT' AND p_scope->'target'->>'owner'='care-organization/unit' THEN PERFORM care_organization.snapshot(p_actor,(p_scope->'target'->>'id')::uuid);
 ELSIF p_scope->'target'->>'type'='ORG' AND p_scope->'target'->>'owner'='department-master' THEN PERFORM department_master.snapshot(p_actor,(p_scope->'target'->>'id')::uuid);
 ELSIF p_scope->'target'->>'type'='LEGAL' AND p_scope->'target'->>'owner'='organization-master' AND p_scope->'target'->>'id'=p_scope->'subject'->>'id' THEN NULL;
 ELSE RAISE EXCEPTION 'REFERENCE_INVALID';END IF;RETURN identity;
END $$;
DO $$ DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['subject_relation','subject_relation_version'] LOOP
 EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON care_organization.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',tab);END LOOP;
 FOREACH tab IN ARRAY ARRAY['subject_access','subject_relation','subject_relation_version'] LOOP EXECUTE format('ALTER TABLE care_organization.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('REVOKE ALL ON care_organization.%I FROM PUBLIC,hdi_prototype',tab);EXECUTE format('GRANT SELECT ON care_organization.%I TO hdi_prototype',tab);END LOOP;END $$;
REVOKE ALL ON FUNCTION care_organization.subject_authorize(text,jsonb,text,text) FROM PUBLIC,hdi_prototype;
CREATE TABLE care_organization.subject_input(id uuid PRIMARY KEY DEFAULT uuidv7(),revision uuid NOT NULL DEFAULT uuidv7(),job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),job_revision uuid NOT NULL REFERENCES governance_catalog.import_input_revision(id),maker text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL,contexts jsonb NOT NULL,scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')),envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(job_id,job_revision));
CREATE TABLE care_organization.subject_verification(id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL REFERENCES care_organization.subject_input(id),number bigint NOT NULL,actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL,envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(input_id,number),UNIQUE(identity_code,request_id));
CREATE TABLE care_organization.subject_apply_binding(candidate_id uuid PRIMARY KEY REFERENCES governance_catalog.apply_candidate(id),input_id uuid NOT NULL REFERENCES care_organization.subject_input(id),candidate_digest text NOT NULL,writes_digest text NOT NULL,writes_hash text NOT NULL);
CREATE TABLE care_organization.subject_change(id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL UNIQUE REFERENCES care_organization.subject_input(id),candidate_id uuid NOT NULL UNIQUE REFERENCES governance_catalog.apply_candidate(id),results jsonb NOT NULL,recorded_at timestamp NOT NULL);
CREATE TABLE care_organization.subject_withdrawal(input_id uuid PRIMARY KEY REFERENCES care_organization.subject_input(id),actor text NOT NULL REFERENCES vnext_control.actor(code),request_id uuid NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()));
ALTER TABLE care_organization.subject_relation_version ADD COLUMN change_id uuid NOT NULL REFERENCES care_organization.subject_change(id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION care_organization.subject_input_read(p_actor text,p_id uuid,p_permission text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r care_organization.subject_input;q care_organization.subject_verification;ctx jsonb;BEGIN
 SELECT * INTO r FROM care_organization.subject_input WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 FOR ctx IN SELECT value FROM jsonb_array_elements(r.contexts) LOOP PERFORM care_organization.subject_authorize(p_actor,ctx->'scope',ctx->>'kind',p_permission);PERFORM care_organization.subject_authorize(p_actor,ctx->'scope',ctx->>'kind','READ');END LOOP;
 PERFORM governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));
 SELECT * INTO q FROM care_organization.subject_verification WHERE input_id=r.id ORDER BY number DESC LIMIT 1;
 IF p_permission='READ_RESTRICTED' THEN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'SUBJECT_READ_RESTRICTED','ORG17_SOURCE',r.digest);END IF;
 RETURN to_jsonb(r)||jsonb_build_object('withdrawn',EXISTS(SELECT 1 FROM care_organization.subject_withdrawal WHERE input_id=r.id),'verification',CASE WHEN q.id IS NULL THEN NULL ELSE to_jsonb(q) END);
END $$;
CREATE FUNCTION care_organization.subject_job_read(p_actor text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;BEGIN r:=care_organization.subject_input_read(p_actor,p_id,'READ_RESTRICTED');RETURN governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r->>'job_id'));END $$;
CREATE FUNCTION care_organization.subject_record_time() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE point text;k bytea;ip bytea:=decode(repeat('36',64),'hex');op bytea:=decode(repeat('5c',64),'hex');i integer;BEGIN
 SELECT decode(key_hex,'hex') INTO k FROM vnext_control.subject_write_authority;IF k IS NULL THEN RAISE EXCEPTION 'SUBJECT_OWNER_NOT_PROVISIONED';END IF;
 FOR i IN 0..31 LOOP ip:=set_byte(ip,i,get_byte(ip,i)#get_byte(k,i));op:=set_byte(op,i,get_byte(op,i)#get_byte(k,i));END LOOP;
 point:=to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US');RETURN jsonb_build_object('recordAt',point,'recordAtProof',encode(sha256(op||sha256(ip||convert_to('SUBJECT_TRANSACTION_R_V1|'||pg_current_xact_id()::text||'|'||point,'UTF8'))),'hex'));
END $$;
CREATE FUNCTION organization_master.subject_profile_coverage(p_actor text,p_scope jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reg jsonb;campus jsonb;v jsonb;spans tsmultirange;cuts tsmultirange;pieces tsmultirange:='{}';BEGIN
 reg:=organization_master.qualification_snapshot(p_actor,(p_scope->'subject'->>'id')::uuid);campus:=organization_master.campus_snapshot(p_actor,(p_scope->'campus'->>'id')::uuid);
 FOR v IN SELECT value FROM jsonb_array_elements(reg->'versions') WHERE (value->>'recorded_at')::timestamp<=p_r LOOP
 SELECT coalesce(range_agg(tsrange((value->>'valid_from')::timestamp,(value->>'valid_to')::timestamp,'[)')),'{}') INTO cuts FROM jsonb_array_elements(reg->'versions') WHERE (value->>'number')::bigint>(v->>'number')::bigint AND (value->>'recorded_at')::timestamp<=p_r;
 pieces:=pieces+(tsmultirange(tsrange((v->>'valid_from')::timestamp,(v->>'valid_to')::timestamp,'[)'))-cuts);END LOOP;
 IF NOT pieces @> tsrange(p_from,p_to,'[)') THEN RAISE EXCEPTION 'SUBJECT_TARGET_PERIOD_NOT_COVERED';END IF;spans:=pieces;pieces:='{}';
 FOR v IN SELECT value FROM jsonb_array_elements(campus->'events') WHERE value->'facts'<>'null'::jsonb AND (value->>'recorded_at')::timestamp<=p_r LOOP
 SELECT coalesce(range_agg(tsrange((value->>'valid_from')::timestamp,(value->>'valid_to')::timestamp,'[)')),'{}') INTO cuts FROM jsonb_array_elements(campus->'events') WHERE value->'facts'<>'null'::jsonb AND (value->>'number')::bigint>(v->>'number')::bigint AND (value->>'recorded_at')::timestamp<=p_r;
 pieces:=pieces+(tsmultirange(tsrange((v->>'valid_from')::timestamp,(v->>'valid_to')::timestamp,'[)'))-cuts);END LOOP;
 IF NOT pieces @> tsrange(p_from,p_to,'[)') THEN RAISE EXCEPTION 'SUBJECT_TARGET_PERIOD_NOT_COVERED';END IF;
 RETURN jsonb_build_object('subject',p_scope->'subject','campus',p_scope->'campus','from',to_char(p_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(p_to,'YYYY-MM-DD"T"HH24:MI:SS.US'));
END $$;
CREATE FUNCTION organization_master.subject_license_coverage(p_actor text,p_scope jsonb,p_operating jsonb,p_license jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE code text;spans tsmultirange;BEGIN
 PERFORM organization_master.capability_operating_guard(p_actor,p_scope,jsonb_build_object('unit',jsonb_build_object('current',jsonb_build_array(jsonb_build_object('from',to_char(p_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(p_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'dependencies',jsonb_build_object('operating',p_operating))))),p_from,p_to,p_r);
 IF p_license->>'owner' IS DISTINCT FROM 'organization-master/license' THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 FOR code IN SELECT value FROM jsonb_array_elements_text(p_scope->'services') LOOP
  SELECT coalesce(range_agg(tsrange((segment->>'from')::timestamp,(segment->>'to')::timestamp,'[)')),'{}') INTO spans
  FROM jsonb_array_elements(p_operating->'services') service CROSS JOIN LATERAL jsonb_array_elements(service->'segments') segment WHERE service->>'code'=code AND segment->'license'=p_license;
  IF NOT spans @> tsrange(p_from,p_to,'[)') THEN RAISE EXCEPTION 'LICENSE_PERIOD_NOT_COVERED';END IF;
 END LOOP;
END $$;
CREATE FUNCTION care_organization.subject_target_coverage(p_actor text,p_scope jsonb,p_context jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;part jsonb;BEGIN
 IF p_scope->'target'->>'type'='UNIT' THEN
  result:=care_organization.ward_management_coverage(p_actor,(p_scope->'target'->>'id')::uuid,(p_scope->'campus'->>'id')::uuid,p_from,p_to,p_r);
  FOR part IN SELECT value FROM jsonb_array_elements(result->'parts') LOOP IF part->'binding'->'subject' IS DISTINCT FROM p_scope->'subject' OR NOT (part->'binding'->'services') @> (p_scope->'services') THEN RAISE EXCEPTION 'SUBJECT_SCOPE_MISMATCH';END IF;END LOOP;RETURN result;
 ELSIF p_scope->'target'->>'type'='ORG' THEN
  IF p_context->'departmentRelation'->>'owner' IS DISTINCT FROM 'department-master/campus-relation' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
  RETURN department_master.unit_binding_coverage(p_actor,(p_scope->'target'->>'id')::uuid,(p_context->'departmentRelation'->>'id')::uuid,p_context->'departmentRelation'->>'version',(p_context->'departmentRelation'->>'versionId')::uuid,(p_scope->'campus'->>'id')::uuid,(p_scope->'subject'->>'id')::uuid,p_scope->'services',p_from,p_to,p_r);
 ELSE RETURN organization_master.subject_profile_coverage(p_actor,p_scope,p_from,p_to,p_r);END IF;
END $$;
CREATE FUNCTION care_organization.subject_admission(p_actor text,p_scope jsonb,p_facts jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source jsonb;code jsonb;target jsonb;adopted jsonb;BEGIN
 adopted:=governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',p_facts->'adoption'->>'systemId','versionId',p_facts->'adoption'->>'versionId'))->0;
 IF adopted IS NULL OR p_facts->'source'->>'codeSystemId' IS DISTINCT FROM adopted->'reference'->>'sourceAlias' OR p_facts->'source'->>'codeSystemVersion' IS DISTINCT FROM adopted->>'codeSystemVersion' THEN RAISE EXCEPTION 'SUBJECT_SCOPE_MISMATCH';END IF;
 source:=governance_catalog.capability_source_coverage(p_actor,(p_facts->'source'->>'sourceSystemId')::uuid,p_from,p_to,p_r);
 code:=governance_catalog.subject_code_coverage(p_actor,p_facts->'adoption',p_from,p_to,p_r);
 target:=care_organization.subject_target_coverage(p_actor,p_scope,p_facts->'context',p_from,p_to,p_r);
 IF p_facts->'license' IS NOT NULL AND p_facts->'license'<>'null'::jsonb THEN PERFORM organization_master.subject_license_coverage(p_actor,p_scope,p_facts->'dependencies'->'operating',p_facts->'license',p_from,p_to,p_r);END IF;
 RETURN jsonb_build_object('source',source,'code',code,'target',target);
END $$;
CREATE FUNCTION care_organization.subject_snapshot(p_actor text,p_id uuid,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r care_organization.subject_relation;v care_organization.subject_relation_version;result jsonb:='[]';BEGIN
 SELECT * INTO r FROM care_organization.subject_relation WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;PERFORM care_organization.subject_authorize(p_actor,r.scope,r.kind,'READ');
 FOR v IN SELECT * FROM care_organization.subject_relation_version WHERE relation_id=r.id AND recorded_at<=coalesce(p_r,timezone('Asia/Shanghai',clock_timestamp())) ORDER BY number LOOP
  PERFORM governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',v.facts->'adoption'->>'systemId','versionId',v.facts->'adoption'->>'versionId'));
  result:=result||jsonb_build_array(jsonb_build_object('id',v.id,'number',v.number::text,'action',v.action,'validFrom',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordedAt',to_char(v.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'facts',v.facts,'reason',v.reason,'changeId',v.change_id));
 END LOOP;RETURN jsonb_build_object('id',r.id,'kind',r.kind,'scope',r.scope,'versions',result);
END $$;
CREATE FUNCTION care_organization.subject_snapshot_version(p_actor text,p_id uuid,p_version text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r timestamp;BEGIN SELECT recorded_at INTO r FROM care_organization.subject_relation_version WHERE relation_id=p_id AND number::text=p_version;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;RETURN care_organization.subject_snapshot(p_actor,p_id,r);END $$;
CREATE FUNCTION care_organization.subject_scope_histories(p_actor text,p_scope jsonb,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE relation record;result jsonb:='[]';BEGIN
 PERFORM care_organization.subject_authorize(p_actor,p_scope,'PERMISSION','READ');
 FOR relation IN SELECT * FROM care_organization.subject_relation WHERE kind='PERMISSION' AND scope->'target'=p_scope->'target' AND scope->'subject'=p_scope->'subject' AND scope->'campus'=p_scope->'campus' LOOP result:=result||jsonb_build_array(care_organization.subject_snapshot(p_actor,relation.id,p_r));END LOOP;RETURN result;
END $$;
CREATE FUNCTION care_organization.subject_source_conflict(p_actor text,p_kind text,p_source uuid,p_alias text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');RETURN EXISTS(SELECT 1 FROM care_organization.subject_relation WHERE kind=p_kind AND source_system_id=p_source AND source_alias=p_alias);END $$;
CREATE FUNCTION care_organization.subject_mutate(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb;actor text;operation text;identity text;r care_organization.subject_input;q care_organization.subject_verification;ctx jsonb;j jsonb;c jsonb;frozen care_organization.subject_apply_binding;change care_organization.subject_change;relation care_organization.subject_relation;previous care_organization.subject_relation_version;declaration care_organization.subject_relation_version;w jsonb;target uuid;vid uuid;next_number bigint;root_id uuid;results jsonb:='[]';point timestamp;k bytea;ip bytea:=decode(repeat('36',64),'hex');op bytea:=decode(repeat('5c',64),'hex');i integer;before_at timestamp;after_at timestamp;current_basis jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(901002);t:=governance_catalog.subject_attest(p_ticket,p_signature);actor:=t->>'actor';operation:=t->>'operation';
 IF operation='STAGE' THEN
  PERFORM care_organization.closed(t,ARRAY['operation','actor','transaction','requestId','jobId','revisionId','campus','contexts','digest','envelope']);
  IF jsonb_typeof(t->'contexts') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'contexts') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  FOR ctx IN SELECT value FROM jsonb_array_elements(t->'contexts') LOOP identity:=care_organization.subject_authorize(actor,ctx->'scope',ctx->>'kind','WRITE');PERFORM care_organization.subject_authorize(actor,ctx->'scope',ctx->>'kind','READ_RESTRICTED');IF organization_master.campus_snapshot(actor,(ctx->'scope'->'campus'->>'id')::uuid)->>'scope' IS DISTINCT FROM t->>'campus' THEN RAISE EXCEPTION 'SUBJECT_SCOPE_MISMATCH';END IF;END LOOP;
  SELECT * INTO r FROM care_organization.subject_input WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF r.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);END IF;
  j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',t->>'jobId'));
  IF j->>'submitterIdentity' IS DISTINCT FROM identity OR j->>'currentRevisionId' IS DISTINCT FROM t->>'revisionId' OR j->'contract'->>'dataset' IS DISTINCT FROM 'ORG17' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
  INSERT INTO care_organization.subject_input(job_id,job_revision,maker,identity_code,request_id,digest,contexts,scope,envelope) VALUES((j->>'id')::uuid,(j->>'currentRevisionId')::uuid,actor,identity,(t->>'requestId')::uuid,t->>'digest',t->'contexts',t->>'campus',t->'envelope') RETURNING * INTO r;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'SUBJECT_INPUT','ORG17_CORE',r.digest);RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);
 END IF;
 r:=jsonb_populate_record(NULL::care_organization.subject_input,care_organization.subject_input_read(actor,(t->>'inputId')::uuid,CASE WHEN operation='VERIFY' THEN 'VERIFY' ELSE 'WRITE' END));
 IF operation<>'WITHDRAW' AND EXISTS(SELECT 1 FROM care_organization.subject_withdrawal WHERE input_id=r.id) THEN RAISE EXCEPTION 'INPUT_WITHDRAWN';END IF;
 IF operation='VERIFY' THEN
  PERFORM care_organization.closed(t,ARRAY['operation','actor','transaction','inputId','inputDigest','requestId','digest','envelope']);identity:=vnext_control.authorize(actor,'SYNTHETIC','REVIEW');
  IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;IF r.digest IS DISTINCT FROM t->>'inputDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  SELECT * INTO q FROM care_organization.subject_verification WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;IF FOUND THEN IF q.input_id<>r.id OR q.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('verificationId',q.id);END IF;
  IF EXISTS(SELECT 1 FROM care_organization.subject_change WHERE input_id=r.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
  INSERT INTO care_organization.subject_verification(input_id,number,actor,identity_code,request_id,digest,envelope) VALUES(r.id,(SELECT coalesce(max(number),0)+1 FROM care_organization.subject_verification WHERE input_id=r.id),actor,identity,(t->>'requestId')::uuid,t->>'digest',t->'envelope') RETURNING * INTO q;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'SUBJECT_VERIFY','LICENSE_SCOPE_BASIS',q.digest);RETURN jsonb_build_object('verificationId',q.id);
 END IF;
 IF operation='WITHDRAW' THEN
  PERFORM care_organization.closed(t,ARRAY['operation','actor','transaction','inputId','requestId']);IF r.identity_code IS DISTINCT FROM vnext_control.authorize(actor,'SYNTHETIC','WRITE') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  IF EXISTS(SELECT 1 FROM care_organization.subject_change WHERE input_id=r.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
  IF EXISTS(SELECT 1 FROM care_organization.subject_withdrawal WHERE input_id=r.id) THEN IF NOT EXISTS(SELECT 1 FROM care_organization.subject_withdrawal WHERE input_id=r.id AND request_id=(t->>'requestId')::uuid) THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('inputId',r.id,'status','WITHDRAWN');END IF;
  INSERT INTO care_organization.subject_withdrawal(input_id,actor,request_id) VALUES(r.id,actor,(t->>'requestId')::uuid);INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'SUBJECT_WITHDRAW','EXPLICIT_WITHDRAWAL',r.digest);RETURN jsonb_build_object('inputId',r.id,'status','WITHDRAWN');
 END IF;
 IF operation NOT IN ('FREEZE','APPLY') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 c:=governance_catalog.apply_record(actor,'READ_CANDIDATE',jsonb_build_object('candidateId',t->>'candidateId'));
 IF c->>'digest' IS DISTINCT FROM t->>'digest' OR c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 IF operation='FREEZE' THEN PERFORM care_organization.closed(t,ARRAY['operation','actor','transaction','inputId','writes','writesDigest','candidateId','digest']);INSERT INTO care_organization.subject_apply_binding VALUES((c->>'id')::uuid,r.id,c->>'digest',t->>'writesDigest',encode(sha256(convert_to((t->'writes')::text,'UTF8')),'hex'));RETURN '{}';END IF;
 PERFORM care_organization.closed(t,ARRAY['operation','actor','transaction','inputId','writes','writesDigest','writeIndex','candidateId','digest','recordAt','recordAtProof']);
 point:=governance_catalog.contract_time(t->>'recordAt');SELECT decode(key_hex,'hex') INTO k FROM vnext_control.subject_write_authority;FOR i IN 0..31 LOOP ip:=set_byte(ip,i,get_byte(ip,i)#get_byte(k,i));op:=set_byte(op,i,get_byte(op,i)#get_byte(k,i));END LOOP;
 IF t->>'recordAtProof' IS DISTINCT FROM encode(sha256(op||sha256(ip||convert_to('SUBJECT_TRANSACTION_R_V1|'||pg_current_xact_id()::text||'|'||(t->>'recordAt'),'UTF8'))),'hex') THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
 SELECT * INTO change FROM care_organization.subject_change WHERE input_id=r.id;IF FOUND THEN IF change.candidate_id::text IS DISTINCT FROM t->>'candidateId' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN change.results->((t->>'writeIndex')::int-1);END IF;
 SELECT * INTO frozen FROM care_organization.subject_apply_binding WHERE candidate_id=(t->>'candidateId')::uuid;
 IF c->>'approvedBy' IS NULL OR frozen.candidate_digest IS DISTINCT FROM c->>'digest' OR frozen.writes_digest IS DISTINCT FROM t->>'writesDigest' OR frozen.writes_hash IS DISTINCT FROM encode(sha256(convert_to((t->'writes')::text,'UTF8')),'hex') OR (t->>'writeIndex')::int<>1 THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 identity:=vnext_control.authorize(c->>'approvedBy','SYNTHETIC','REVIEW');IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
 SELECT * INTO q FROM care_organization.subject_verification WHERE input_id=r.id ORDER BY number DESC LIMIT 1;IF NOT FOUND THEN RAISE EXCEPTION 'LEGAL_REVIEW_REQUIRED';END IF;
 j:=care_organization.subject_job_read(actor,r.id);root_id:=uuidv7();
 FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP
  PERFORM care_organization.subject_authorize(actor,w->'scope',w->>'kind','WRITE');PERFORM care_organization.subject_authorize(c->>'approvedBy',w->'scope',w->>'kind','REVIEW');IF care_organization.subject_authorize(q.actor,w->'scope',w->>'kind','VERIFY') IS DISTINCT FROM q.identity_code THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  IF q.identity_code=r.identity_code OR w->'facts'->'verificationBasis'->>'id' IS DISTINCT FROM q.id::text OR w->'facts'->'verificationBasis'->>'digest' IS DISTINCT FROM q.digest OR w->'facts'->>'contractVersionId' IS DISTINCT FROM j->'contract'->>'versionId' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  before_at:=governance_catalog.contract_time(w->>'validFrom');after_at:=CASE WHEN w->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(w->>'validTo') END;
  target:=CASE WHEN w->>'targetId' IS NULL THEN NULL ELSE (w->>'targetId')::uuid END;
  IF target IS NULL THEN
   IF w->>'action' IS DISTINCT FROM 'RECORD' OR w->>'expectedHead' IS NOT NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
   INSERT INTO care_organization.subject_relation(kind,scope,source_system_id,source_alias) VALUES(w->>'kind',w->'scope',(w->'facts'->'source'->>'sourceSystemId')::uuid,w->'facts'->'source'->>'sourceAlias') RETURNING id INTO target;next_number:=1;
  ELSE
   SELECT * INTO relation FROM care_organization.subject_relation WHERE id=target;
   SELECT * INTO previous FROM care_organization.subject_relation_version WHERE relation_id=target ORDER BY number DESC LIMIT 1;
   SELECT * INTO declaration FROM care_organization.subject_relation_version WHERE relation_id=target AND action IN ('RECORD','REVISE') ORDER BY number DESC LIMIT 1;
   IF relation.id IS NULL OR previous.number::text IS DISTINCT FROM w->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
   IF relation.kind IS DISTINCT FROM w->>'kind' OR relation.scope IS DISTINCT FROM w->'scope' OR relation.source_system_id::text IS DISTINCT FROM w->'facts'->'source'->>'sourceSystemId' OR relation.source_alias IS DISTINCT FROM w->'facts'->'source'->>'sourceAlias' THEN RAISE EXCEPTION 'SUBJECT_IDENTITY_IMMUTABLE';END IF;
   IF EXISTS(SELECT 1 FROM care_organization.subject_relation_version WHERE relation_id=target AND action='RETIRE' AND (w->>'action'<>'RETIRE' OR valid_from<before_at)) THEN RAISE EXCEPTION 'SUBJECT_PERMISSION_RETIRED';END IF;
   IF w->>'action'='RETIRE' THEN
    IF after_at IS NOT NULL OR w->'facts'->'adoption' IS DISTINCT FROM declaration.facts->'adoption' OR w->'facts'->'license' IS DISTINCT FROM declaration.facts->'license' OR w->'facts'->'semantic' IS DISTINCT FROM declaration.facts->'semantic' OR w->'facts'->'limitations' IS DISTINCT FROM declaration.facts->'limitations' THEN RAISE EXCEPTION 'SUBJECT_RETIREMENT_EXPANSION';END IF;
   ELSIF w->>'action' IS DISTINCT FROM 'REVISE' OR before_at<>declaration.valid_from THEN RAISE EXCEPTION 'SUBJECT_IDENTITY_IMMUTABLE';END IF;next_number:=previous.number+1;
  END IF;
  IF w->>'action'<>'RETIRE' THEN
   current_basis:=care_organization.subject_admission(actor,w->'scope',w->'facts',before_at,after_at,point);
   PERFORM care_organization.subject_admission(c->>'approvedBy',w->'scope',w->'facts',before_at,after_at,point);
   IF current_basis IS DISTINCT FROM ((w->'facts'->'dependencies')-'operating') THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  END IF;
  INSERT INTO care_organization.subject_relation_version(relation_id,number,action,valid_from,valid_to,facts,recorded_at,reason,change_id) VALUES(target,next_number,w->>'action',before_at,after_at,w->'facts',point,w->>'reason',root_id) RETURNING id INTO vid;
  results:=results||jsonb_build_array(jsonb_build_object('owner',CASE w->>'kind' WHEN 'MAPPING' THEN 'care-organization/subject-mapping' ELSE 'care-organization/subject-permission' END,'id',target,'version',next_number::text,'source',jsonb_build_object('dataset','ORG17','row',(w->>'sourceRow')::int,'step',w->>'action')));
 END LOOP;
 INSERT INTO care_organization.subject_change(id,input_id,candidate_id,results,recorded_at) VALUES(root_id,r.id,(c->>'id')::uuid,results,point);INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,root_id,'SUBJECT_APPLY','ORG17_ATOMIC_OWNER',r.digest);RETURN results->0;
END $$;
DO $$ DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['subject_input','subject_verification','subject_apply_binding','subject_change','subject_withdrawal'] LOOP
 EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON care_organization.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',tab);EXECUTE format('ALTER TABLE care_organization.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('REVOKE ALL ON care_organization.%I FROM PUBLIC,hdi_prototype',tab);EXECUTE format('GRANT SELECT ON care_organization.%I TO hdi_prototype',tab);END LOOP;END $$;
REVOKE ALL ON FUNCTION care_organization.subject_input_read(text,uuid,text),care_organization.subject_job_read(text,uuid),care_organization.subject_record_time(),care_organization.subject_target_coverage(text,jsonb,jsonb,timestamp,timestamp,timestamp),care_organization.subject_admission(text,jsonb,jsonb,timestamp,timestamp,timestamp),care_organization.subject_snapshot(text,uuid,timestamp),care_organization.subject_snapshot_version(text,uuid,text),care_organization.subject_scope_histories(text,jsonb,timestamp),care_organization.subject_source_conflict(text,text,uuid,text),care_organization.subject_mutate(text,text),organization_master.subject_profile_coverage(text,jsonb,timestamp,timestamp,timestamp),organization_master.subject_license_coverage(text,jsonb,jsonb,jsonb,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
CREATE TABLE care_organization.subject_review_case(id uuid PRIMARY KEY DEFAULT uuidv7(),relation_id uuid NOT NULL REFERENCES care_organization.subject_relation(id),accepted_version_id uuid NOT NULL REFERENCES care_organization.subject_relation_version(id),code_version_id uuid NOT NULL REFERENCES governance_catalog.subject_code_version(id),reason text NOT NULL CHECK(reason IN ('TARGET_RETIRED','TARGET_MISSING','TARGET_MEANING_CHANGED','TARGET_LABEL_CHANGED')),blocking boolean NOT NULL,valid_from timestamp NOT NULL,valid_to timestamp,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(relation_id,accepted_version_id,code_version_id),CHECK(valid_to IS NULL OR valid_to>valid_from));
CREATE TABLE care_organization.subject_review_resolution(case_id uuid PRIMARY KEY REFERENCES care_organization.subject_review_case(id),relation_version_id uuid NOT NULL REFERENCES care_organization.subject_relation_version(id),recorded_at timestamp NOT NULL);
CREATE FUNCTION care_organization.subject_reassess_code(p_actor text,p_system uuid,p_version uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE released jsonb;old jsonb;old_code jsonb;new_code jsonb;relation care_organization.subject_relation;version care_organization.subject_relation_version;reason text;blocking boolean;affected tsrange;ending timestamp;BEGIN
 released:=governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',p_system,'versionId',p_version))->0;IF released->>'status' IS DISTINCT FROM 'APPROVED' THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 FOR relation IN SELECT * FROM care_organization.subject_relation LOOP
  SELECT * INTO version FROM care_organization.subject_relation_version WHERE relation_id=relation.id AND action IN ('RECORD','REVISE') ORDER BY number DESC LIMIT 1;
  IF version.id IS NULL OR version.facts->'adoption'->>'systemId'<>p_system::text THEN CONTINUE;END IF;
  SELECT min(valid_from) INTO ending FROM care_organization.subject_relation_version WHERE relation_id=relation.id AND action='RETIRE';ending:=least(ending,version.valid_to);
  IF ending IS NOT NULL AND ending<=version.valid_from THEN CONTINUE;END IF;
  affected:=tsrange(version.valid_from,ending,'[)')*tsrange(governance_catalog.contract_time(released->>'validFrom'),CASE WHEN released->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(released->>'validTo') END,'[)');IF isempty(affected) THEN CONTINUE;END IF;
  old:=governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',p_system,'versionId',version.facts->'adoption'->>'versionId'))->0;
  SELECT value INTO old_code FROM jsonb_array_elements(old->'codes') WHERE value->>'code'=version.facts->'adoption'->>'code';SELECT value INTO new_code FROM jsonb_array_elements(released->'codes') WHERE value->>'code'=version.facts->'adoption'->>'code';
  reason:=CASE WHEN new_code IS NULL THEN 'TARGET_MISSING' WHEN new_code->>'status'<>'ACTIVE' THEN 'TARGET_RETIRED' WHEN new_code->>'meaning' IS DISTINCT FROM old_code->>'meaning' THEN 'TARGET_MEANING_CHANGED' WHEN new_code->>'name' IS DISTINCT FROM old_code->>'name' THEN 'TARGET_LABEL_CHANGED' ELSE NULL END;
  IF reason IS NULL THEN CONTINUE;END IF;blocking:=reason<>'TARGET_LABEL_CHANGED';
  INSERT INTO care_organization.subject_review_case(relation_id,accepted_version_id,code_version_id,reason,blocking,valid_from,valid_to) VALUES(relation.id,version.id,p_version,reason,blocking,lower(affected),upper(affected)) ON CONFLICT DO NOTHING;
 END LOOP;
END $$;
CREATE FUNCTION care_organization.subject_review_cases(p_actor text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h jsonb;result jsonb;BEGIN h:=care_organization.subject_snapshot(p_actor,p_id,NULL);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'acceptedVersionId',c.accepted_version_id,'codeVersionId',c.code_version_id,'reason',c.reason,'blocking',c.blocking,'validFrom',to_char(c.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(c.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordedAt',to_char(c.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'status',CASE WHEN r.case_id IS NULL THEN 'OPEN' ELSE 'RESOLVED' END,'resolutionVersionId',r.relation_version_id) ORDER BY c.recorded_at,c.id),'[]') INTO result FROM care_organization.subject_review_case c LEFT JOIN care_organization.subject_review_resolution r ON r.case_id=c.id WHERE c.relation_id=p_id;RETURN result;
END $$;
DO $$ DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['subject_review_case','subject_review_resolution'] LOOP
 EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON care_organization.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',tab);EXECUTE format('ALTER TABLE care_organization.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('REVOKE ALL ON care_organization.%I FROM PUBLIC,hdi_prototype',tab);EXECUTE format('GRANT SELECT ON care_organization.%I TO hdi_prototype',tab);END LOOP;END $$;
REVOKE ALL ON FUNCTION care_organization.subject_reassess_code(text,uuid,uuid),care_organization.subject_review_cases(text,uuid) FROM PUBLIC,hdi_prototype;
DO $resolve$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.subject_mutate(text,text)'::regprocedure);needle:='RETURNING id INTO vid;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'SUBJECT_REVIEW_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,needle||E'\n IF w->>''action''=''REVISE'' THEN INSERT INTO care_organization.subject_review_resolution(case_id,relation_version_id,recorded_at) SELECT x.id,vid,point FROM care_organization.subject_review_case x WHERE x.relation_id=target AND NOT EXISTS(SELECT 1 FROM care_organization.subject_review_resolution y WHERE y.case_id=x.id);END IF;');EXECUTE body;
END $resolve$;

CREATE FUNCTION care_organization.subject_audit_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(coalesce(NEW.actor,OLD.actor),coalesce(NEW.campus_id,OLD.campus_id),'SUBJECT_PERMISSION_AUTHORIZATION',TG_OP,encode(sha256(convert_to(coalesce(to_jsonb(NEW),to_jsonb(OLD))::text,'UTF8')),'hex'));RETURN coalesce(NEW,OLD);END $$;
CREATE TRIGGER subject_access_lock BEFORE INSERT OR UPDATE OR DELETE ON care_organization.subject_access FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER subject_access_audit AFTER INSERT OR UPDATE OR DELETE ON care_organization.subject_access FOR EACH ROW EXECUTE FUNCTION care_organization.subject_audit_access();
REVOKE ALL ON FUNCTION care_organization.subject_audit_access() FROM PUBLIC,hdi_prototype;

CREATE FUNCTION care_organization.subject_review_gate(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM care_organization.subject_snapshot(p_actor,p_id,p_r);
 IF EXISTS(SELECT 1 FROM care_organization.subject_review_case c WHERE c.relation_id=p_id AND c.blocking AND c.recorded_at<=p_r AND tsrange(c.valid_from,c.valid_to,'[)')&&tsrange(p_from,p_to,'[)') AND NOT EXISTS(SELECT 1 FROM care_organization.subject_review_resolution r WHERE r.case_id=c.id AND r.recorded_at<=p_r)) THEN RAISE EXCEPTION 'SUBJECT_CODE_REVIEW_REQUIRED';END IF;
END $$;
REVOKE ALL ON FUNCTION care_organization.subject_review_gate(text,uuid,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
CREATE FUNCTION care_organization.subject_review_spans(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;BEGIN PERFORM care_organization.subject_snapshot(p_actor,p_id,p_r);
 SELECT coalesce(jsonb_agg(jsonb_build_object('from',to_char(greatest(c.valid_from,p_from),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(least(c.valid_to,p_to),'YYYY-MM-DD"T"HH24:MI:SS.US')) ORDER BY c.valid_from,c.valid_to,c.id),'[]') INTO result
 FROM care_organization.subject_review_case c WHERE c.relation_id=p_id AND c.blocking AND c.recorded_at<=p_r AND tsrange(c.valid_from,c.valid_to,'[)')&&tsrange(p_from,p_to,'[)') AND NOT EXISTS(SELECT 1 FROM care_organization.subject_review_resolution r WHERE r.case_id=c.id AND r.recorded_at<=p_r);RETURN result;
END $$;
REVOKE ALL ON FUNCTION care_organization.subject_review_spans(text,uuid,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
