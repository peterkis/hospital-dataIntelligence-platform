SELECT pg_advisory_xact_lock(901002);

CREATE TABLE department_master.identifier_access(actor text NOT NULL REFERENCES vnext_control.actor(code),scheme text NOT NULL CHECK(length(scheme) BETWEEN 1 AND 256 AND scheme=btrim(scheme)),campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),permission text NOT NULL CHECK(permission IN ('READ','WRITE','READ_RESTRICTED','VERIFY','REVIEW')),PRIMARY KEY(actor,scheme,campus,permission));
CREATE TABLE department_master.identifier_input(id uuid PRIMARY KEY DEFAULT uuidv7(),revision uuid NOT NULL DEFAULT uuidv7(),job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),job_revision uuid NOT NULL REFERENCES governance_catalog.import_input_revision(id),maker text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),schemes jsonb NOT NULL CHECK(jsonb_typeof(schemes)='array' AND jsonb_array_length(schemes) BETWEEN 1 AND 100),envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(job_id,job_revision));
CREATE TABLE department_master.identifier_verification(id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL REFERENCES department_master.identifier_input(id),number bigint NOT NULL CHECK(number>0),actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(input_id,number));
CREATE TABLE department_master.organization_identifier(id uuid PRIMARY KEY DEFAULT uuidv7(),target_type text NOT NULL CHECK(target_type IN ('LEGAL','CAMPUS','ORG')),target_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('HOSPITAL_CODE','ALIAS','FORMER_NAME','SEARCH_CODE')),scheme text NOT NULL CHECK(length(scheme) BETWEEN 1 AND 256 AND scheme=btrim(scheme)),reserved_value text,CHECK((kind='HOSPITAL_CODE' AND target_type='ORG' AND scheme='SYNTHETIC_DEPARTMENT_CODE' AND length(reserved_value) BETWEEN 1 AND 256 AND reserved_value=btrim(reserved_value)) OR (kind<>'HOSPITAL_CODE' AND reserved_value IS NULL AND scheme<>'SYNTHETIC_DEPARTMENT_CODE')));
CREATE UNIQUE INDEX organization_identifier_permanent_code ON department_master.organization_identifier(scheme,reserved_value) WHERE kind='HOSPITAL_CODE';
CREATE TABLE department_master.organization_identifier_version(id uuid PRIMARY KEY DEFAULT uuidv7(),identifier_id uuid NOT NULL REFERENCES department_master.organization_identifier(id),number bigint NOT NULL CHECK(number>0),predecessor uuid REFERENCES department_master.organization_identifier_version(id),action text NOT NULL CHECK(action IN ('REGISTER','CORRECT','END','RETRACT')),value text NOT NULL CHECK(length(value) BETWEEN 1 AND 256 AND value=btrim(value)),language text NOT NULL CHECK(length(language)<=64),preferred boolean NOT NULL,valid_from timestamp NOT NULL,valid_to timestamp,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',transaction_timestamp()),input_id uuid REFERENCES department_master.identifier_input(id),legacy_version_id uuid REFERENCES department_master.version(id),source_row integer NOT NULL CHECK(source_row BETWEEN 1 AND 1048576),step text NOT NULL CHECK(step IN ('REGISTER','CORRECT','END','RETRACT','CHANGE_END','CHANGE_REGISTER','ORG04_INITIAL')),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),facts jsonb NOT NULL,content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),UNIQUE(identifier_id,number),UNIQUE(input_id,source_row,step),CHECK(valid_to IS NULL OR valid_to>valid_from),CHECK((number=1 AND action='REGISTER' AND predecessor IS NULL) OR (number>1 AND action<>'REGISTER' AND predecessor IS NOT NULL)),CHECK((input_id IS NOT NULL AND legacy_version_id IS NULL) OR (input_id IS NULL AND legacy_version_id IS NOT NULL AND step='ORG04_INITIAL')));
CREATE INDEX organization_identifier_target ON department_master.organization_identifier(target_type,target_id);

CREATE FUNCTION department_master.identifier_authorize(p_actor text,p_scheme text,p_campus text,p_permission text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;BEGIN
 PERFORM pg_advisory_xact_lock(901002);identity:=vnext_control.authorize(p_actor,'SYNTHETIC',CASE WHEN p_permission IN ('VERIFY','REVIEW') THEN 'REVIEW' WHEN p_permission='WRITE' THEN 'WRITE' ELSE 'READ' END);
 IF NOT EXISTS(SELECT 1 FROM department_master.identifier_access WHERE actor=p_actor AND scheme=p_scheme AND campus=p_campus AND permission=p_permission) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;RETURN identity;
END $$;
CREATE FUNCTION department_master.identifier_input_read(p_actor text,p_id uuid,p_permission text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r department_master.identifier_input;v department_master.identifier_verification;scheme jsonb;BEGIN
 SELECT * INTO r FROM department_master.identifier_input WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 FOR scheme IN SELECT value FROM jsonb_array_elements(r.schemes) LOOP PERFORM department_master.identifier_authorize(p_actor,scheme#>>'{}',r.campus,p_permission);PERFORM department_master.identifier_authorize(p_actor,scheme#>>'{}',r.campus,'READ');END LOOP;
 IF p_permission='READ_RESTRICTED' THEN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'ORG_IDENTIFIER_INPUT_READ','RESTRICTED_INPUT',r.digest);END IF;
 SELECT * INTO v FROM department_master.identifier_verification WHERE input_id=r.id ORDER BY number DESC LIMIT 1;RETURN to_jsonb(r)||jsonb_build_object('verification',CASE WHEN v.id IS NULL THEN NULL ELSE to_jsonb(v) END);
END $$;
CREATE FUNCTION department_master.identifier_job_read(p_actor text,p_input uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;BEGIN r:=department_master.identifier_input_read(p_actor,p_input,'READ_RESTRICTED');RETURN governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r->>'job_id'));END $$;
CREATE FUNCTION department_master.identifier_snapshot(p_actor text,p_id uuid,p_campus text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m department_master.organization_identifier;BEGIN
 SELECT * INTO m FROM department_master.organization_identifier WHERE id=p_id;IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM department_master.identifier_authorize(p_actor,m.scheme,p_campus,'READ');PERFORM department_master.mapping_target_authorize(p_actor,m.target_type,m.target_id,p_campus);
 RETURN to_jsonb(m)||jsonb_build_object('versions',coalesce((SELECT jsonb_agg((to_jsonb(v)-ARRAY['input_id','legacy_version_id'])||jsonb_build_object('number',v.number::text) ORDER BY number) FROM department_master.organization_identifier_version v WHERE identifier_id=m.id),'[]'));
END $$;
CREATE FUNCTION department_master.identifier_list(p_actor text,p_campus text,p_after uuid,p_limit integer,p_record_at timestamp,p_type text,p_target uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');IF p_campus NOT IN ('NORTH','SOUTH') OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM department_master.identifier_access WHERE actor=p_actor AND campus=p_campus AND permission='READ') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 RETURN coalesce((SELECT jsonb_agg(id ORDER BY id) FROM (SELECT m.id FROM department_master.organization_identifier m WHERE (p_after IS NULL OR m.id>p_after) AND (p_type IS NULL OR m.target_type=p_type AND m.target_id=p_target) AND EXISTS(SELECT 1 FROM department_master.identifier_access a WHERE a.actor=p_actor AND a.scheme=m.scheme AND a.campus=p_campus AND a.permission='READ') AND EXISTS(SELECT 1 FROM department_master.mapping_target_access a WHERE a.actor=p_actor AND a.target_type=m.target_type AND a.target_id=m.target_id AND a.campus=p_campus) AND EXISTS(SELECT 1 FROM department_master.organization_identifier_version v WHERE v.identifier_id=m.id AND (p_record_at IS NULL OR v.recorded_at<=p_record_at)) ORDER BY m.id LIMIT p_limit) q),'[]');
END $$;
CREATE FUNCTION department_master.identifier_code(p_actor text,p_value text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');RETURN (SELECT to_jsonb(m) FROM department_master.organization_identifier m WHERE m.kind='HOSPITAL_CODE' AND m.reserved_value=p_value AND (p_id IS NULL OR m.target_id=p_id));
END $$;
CREATE OR REPLACE FUNCTION department_master.code_conflict(p_actor text,p_code text,p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');RETURN EXISTS(SELECT 1 FROM department_master.organization_identifier WHERE kind='HOSPITAL_CODE' AND reserved_value=p_code AND target_id IS DISTINCT FROM p_id);
END $$;

-- The initial code is derived from the original ORG04 assertion. Installation
-- records its real new R; historical pre-installation reads use the retained ORG04 evidence.
INSERT INTO department_master.organization_identifier(target_type,target_id,kind,scheme,reserved_value) SELECT 'ORG',id,'HOSPITAL_CODE','SYNTHETIC_DEPARTMENT_CODE',code FROM department_master.department;
INSERT INTO department_master.organization_identifier_version(identifier_id,number,action,value,language,preferred,valid_from,valid_to,legacy_version_id,source_row,step,reason,facts,content_digest)
 SELECT m.id,1,'REGISTER',d.code,'',false,v.valid_from,v.valid_to,v.id,v.source_row,'ORG04_INITIAL','Preserved initial ORG04 code',jsonb_build_object('sourceSystemId',v.facts->>'sourceSystemId','target',jsonb_build_object('owner','department-master','id',d.id,'parts','[]'::jsonb),'issuer','SYNTHETIC_ORGANIZATION_PERSONNEL','origin','ORG04_INITIAL','originalRecordedAt',v.recorded_at),v.content_digest FROM department_master.department d JOIN department_master.organization_identifier m ON m.target_id=d.id AND m.kind='HOSPITAL_CODE' CROSS JOIN LATERAL (SELECT * FROM department_master.version WHERE department_id=d.id ORDER BY number LIMIT 1) v;
CREATE FUNCTION department_master.identifier_initial_code() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m department_master.organization_identifier;d department_master.department;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF TG_TABLE_NAME='department' THEN
  INSERT INTO department_master.organization_identifier(target_type,target_id,kind,scheme,reserved_value) VALUES('ORG',NEW.id,'HOSPITAL_CODE','SYNTHETIC_DEPARTMENT_CODE',NEW.code);RETURN NEW;
 END IF;
 SELECT * INTO d FROM department_master.department WHERE id=NEW.department_id;
 SELECT * INTO m FROM department_master.organization_identifier WHERE target_id=d.id AND kind='HOSPITAL_CODE' AND reserved_value=d.code;
 IF NOT EXISTS(SELECT 1 FROM department_master.organization_identifier_version WHERE identifier_id=m.id) THEN
  INSERT INTO department_master.organization_identifier_version(identifier_id,number,action,value,language,preferred,valid_from,valid_to,recorded_at,legacy_version_id,source_row,step,reason,facts,content_digest) VALUES(m.id,1,'REGISTER',d.code,'',false,NEW.valid_from,NEW.valid_to,NEW.recorded_at,NEW.id,NEW.source_row,'ORG04_INITIAL','Initial approved ORG04 code',jsonb_build_object('sourceSystemId',NEW.facts->>'sourceSystemId','target',jsonb_build_object('owner','department-master','id',d.id,'parts','[]'::jsonb),'issuer','SYNTHETIC_ORGANIZATION_PERSONNEL','origin','ORG04_INITIAL','originalRecordedAt',NEW.recorded_at),NEW.content_digest);
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER identifier_initial_department AFTER INSERT ON department_master.department FOR EACH ROW EXECUTE FUNCTION department_master.identifier_initial_code();
CREATE TRIGGER identifier_initial_version AFTER INSERT ON department_master.version FOR EACH ROW EXECUTE FUNCTION department_master.identifier_initial_code();
CREATE FUNCTION department_master.identifier_assert_timeline() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF EXISTS(WITH heads AS (SELECT DISTINCT ON(identifier_id) * FROM department_master.organization_identifier_version ORDER BY identifier_id,number DESC) SELECT 1 FROM heads a JOIN department_master.organization_identifier x ON x.id=a.identifier_id JOIN heads b ON a.identifier_id<b.identifier_id JOIN department_master.organization_identifier y ON y.id=b.identifier_id WHERE a.action<>'RETRACT' AND b.action<>'RETRACT' AND x.target_type=y.target_type AND x.target_id=y.target_id AND x.scheme=y.scheme AND x.kind=y.kind AND tsrange(a.valid_from,a.valid_to,'[)')&&tsrange(b.valid_from,b.valid_to,'[)') AND (x.kind='HOSPITAL_CODE' OR a.preferred AND b.preferred AND a.language=b.language)) THEN RAISE EXCEPTION 'IDENTIFIER_CONFLICT';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER identifier_timeline AFTER INSERT ON department_master.organization_identifier_version DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION department_master.identifier_assert_timeline();

CREATE FUNCTION department_master.identifier_mutate(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;actor text:=t->>'actor';op text:=t->>'operation';identity text;scheme jsonb;r department_master.identifier_input;j governance_catalog.import_job;verify department_master.identifier_verification;c governance_catalog.apply_candidate;a governance_catalog.apply_approval;m department_master.organization_identifier;v department_master.organization_identifier_version;command jsonb:=t->'command';row jsonb:=command->'row';n bigint;vid uuid;BEGIN
 PERFORM pg_advisory_xact_lock(901002);SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.department_write_authority WHERE singleton;
 IF secret IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF op='STAGE' THEN
  IF jsonb_typeof(t->'schemes')<>'array' OR jsonb_array_length(t->'schemes') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  FOR scheme IN SELECT value FROM jsonb_array_elements(t->'schemes') LOOP identity:=department_master.identifier_authorize(actor,scheme#>>'{}',t->>'campus','WRITE');PERFORM department_master.identifier_authorize(actor,scheme#>>'{}',t->>'campus','READ_RESTRICTED');END LOOP;
  SELECT * INTO r FROM department_master.identifier_input WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;IF FOUND THEN IF r.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);END IF;
  PERFORM governance_catalog.import_job_read(actor,jsonb_build_object('scope','SYNTHETIC','jobId',t->>'jobId'));SELECT * INTO j FROM governance_catalog.import_job WHERE id=(t->>'jobId')::uuid;
  IF j.submitter_identity IS DISTINCT FROM identity OR j.current_revision_id IS DISTINCT FROM (t->>'revisionId')::uuid OR j.contract_snapshot->>'dataset'<>'ORG23' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
  INSERT INTO department_master.identifier_input(job_id,job_revision,maker,identity_code,request_id,digest,campus,schemes,envelope) VALUES(j.id,j.current_revision_id,actor,identity,(t->>'requestId')::uuid,t->>'digest',t->>'campus',t->'schemes',t->'envelope') RETURNING * INTO r;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'ORG_IDENTIFIER_INPUT','ORG23_CORE',r.digest);RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);
 END IF;
 r:=jsonb_populate_record(NULL::department_master.identifier_input,department_master.identifier_input_read(actor,(t->>'inputId')::uuid,CASE WHEN op='VERIFY' THEN 'VERIFY' ELSE 'WRITE' END));
 IF r.job_revision IS DISTINCT FROM (SELECT current_revision_id FROM governance_catalog.import_job WHERE id=r.job_id) THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 IF op='VERIFY' THEN
  identity:=vnext_control.authorize(actor,'SYNTHETIC','REVIEW');IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;IF r.digest IS DISTINCT FROM t->>'inputDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  SELECT * INTO verify FROM department_master.identifier_verification WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;IF FOUND THEN IF verify.digest IS DISTINCT FROM t->>'digest' OR verify.input_id<>r.id THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('verificationId',verify.id);END IF;
  IF EXISTS(SELECT 1 FROM department_master.organization_identifier_version WHERE input_id=r.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
  INSERT INTO department_master.identifier_verification(input_id,number,actor,identity_code,request_id,digest,envelope) VALUES(r.id,(SELECT coalesce(max(number),0)+1 FROM department_master.identifier_verification WHERE input_id=r.id),actor,identity,(t->>'requestId')::uuid,t->>'digest',t->'envelope') RETURNING * INTO verify;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'ORG_IDENTIFIER_VERIFY','PERSONNEL_POLICY_EVIDENCE',verify.digest);RETURN jsonb_build_object('verificationId',verify.id);
 END IF;
 IF op<>'APPLY' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 SELECT * INTO c FROM governance_catalog.apply_candidate WHERE id=(t->>'candidateId')::uuid;SELECT * INTO a FROM governance_catalog.apply_approval WHERE candidate_id=c.id;
 IF c.digest IS DISTINCT FROM t->>'digest' OR c.input->>'jobId' IS DISTINCT FROM r.id::text OR c.input->>'revisionId' IS DISTINCT FROM r.revision::text OR a.candidate_id IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 IF c.maker_identity IS DISTINCT FROM r.identity_code OR a.identity_code=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
 PERFORM governance_catalog.apply_record(a.actor_code,'CHECK_APPROVAL',jsonb_build_object('candidateId',c.id));PERFORM department_master.identifier_input_read(a.actor_code,r.id,'REVIEW');
 PERFORM department_master.mapping_target_authorize(actor,row->>'target_type',(row->>'target_id')::uuid,r.campus);PERFORM department_master.mapping_target_authorize(a.actor_code,row->>'target_type',(row->>'target_id')::uuid,r.campus);
 PERFORM vnext_control.require_source_access(actor,'SYNTHETIC',(row->>'source_system_id')::uuid);PERFORM vnext_control.require_source_access(a.actor_code,'SYNTHETIC',(row->>'source_system_id')::uuid);
 IF command->>'action' NOT IN ('REGISTER','CORRECT','END','RETRACT') OR row->>'record_status'<>'ACTIVE' OR nullif(btrim(row->>'approval_ref'),'') IS NULL THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 IF command->>'action'='REGISTER' THEN
  IF command->'identifier'<>'null'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  INSERT INTO department_master.organization_identifier(target_type,target_id,kind,scheme,reserved_value) VALUES(row->>'target_type',(row->>'target_id')::uuid,row->>'identifier_kind',row->>'identifier_system',CASE WHEN row->>'identifier_kind'='HOSPITAL_CODE' THEN row->>'identifier_value' END) RETURNING * INTO m;n:=1;
 ELSE
  SELECT * INTO m FROM department_master.organization_identifier WHERE id=(command->'identifier'->>'id')::uuid;
  IF NOT FOUND OR m.target_type<>row->>'target_type' OR m.target_id<>(row->>'target_id')::uuid OR m.kind<>row->>'identifier_kind' OR m.scheme<>row->>'identifier_system' THEN RAISE EXCEPTION 'IDENTIFIER_IDENTITY_IMMUTABLE';END IF;
  SELECT * INTO v FROM department_master.organization_identifier_version WHERE identifier_id=m.id ORDER BY number DESC LIMIT 1;
  IF v.number::text IS DISTINCT FROM command->'identifier'->>'expectedHead' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;IF v.action='RETRACT' OR v.action='END' AND command->>'action'<>'RETRACT' THEN RAISE EXCEPTION 'IDENTIFIER_CLOSED';END IF;n:=v.number+1;
  IF m.kind='HOSPITAL_CODE' AND (row->>'identifier_value'<>m.reserved_value OR command->>'action'='CORRECT') THEN RAISE EXCEPTION 'IDENTIFIER_IDENTITY_IMMUTABLE';END IF;
  IF command->>'action' IN ('END','RETRACT') AND (v.value<>row->>'identifier_value' OR v.language<>row->>'language' OR v.preferred IS DISTINCT FROM (row->>'is_preferred'='Y') OR v.valid_from<>(command->>'validFrom')::timestamp OR (command->>'action'='RETRACT' AND v.valid_to IS DISTINCT FROM (command->>'validTo')::timestamp) OR (command->>'action'='END' AND ((command->>'validTo') IS NULL OR v.valid_to IS NOT NULL AND (command->>'validTo')::timestamp>=v.valid_to))) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 END IF;
 INSERT INTO department_master.organization_identifier_version(identifier_id,number,predecessor,action,value,language,preferred,valid_from,valid_to,input_id,source_row,step,reason,facts,content_digest) VALUES(m.id,n,v.id,command->>'action',row->>'identifier_value',row->>'language',row->>'is_preferred'='Y',(command->>'validFrom')::timestamp,(command->>'validTo')::timestamp,r.id,(t->>'sourceRow')::integer,t->>'step',command->>'reason',t->'facts',t->>'contentDigest') RETURNING id INTO vid;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,m.id,'ORG_IDENTIFIER_'||(command->>'action'),'EXPLICIT_APPROVED_COMMAND',t->>'contentDigest');
 RETURN jsonb_build_object('owner','department-master/organization-identifier','id',m.id,'version',n::text,'source',jsonb_build_object('dataset','ORG23','row',(t->>'sourceRow')::integer,'step',t->>'step'));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'IDENTIFIER_CONFLICT';
END $$;
DO $$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['identifier_input','identifier_verification','organization_identifier','organization_identifier_version'] LOOP EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON department_master.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',name);END LOOP;
 FOREACH name IN ARRAY ARRAY['identifier_access','identifier_input','identifier_verification','organization_identifier','organization_identifier_version'] LOOP EXECUTE format('ALTER TABLE department_master.%I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('REVOKE ALL ON department_master.%I FROM PUBLIC,hdi_prototype',name);END LOOP;
END $$;
CREATE TRIGGER identifier_access_lock BEFORE INSERT OR UPDATE OR DELETE ON department_master.identifier_access FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER identifier_access_audit AFTER INSERT OR UPDATE OR DELETE ON department_master.identifier_access FOR EACH ROW EXECUTE FUNCTION department_master.audit_access();
CREATE FUNCTION department_master.identifier_peers(p_actor text,p_type text,p_target uuid,p_scheme text,p_kind text,p_campus text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM department_master.identifier_authorize(p_actor,p_scheme,p_campus,'READ');PERFORM department_master.mapping_target_authorize(p_actor,p_type,p_target,p_campus);
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('versions',jsonb_build_array((to_jsonb(v)-ARRAY['input_id','legacy_version_id'])||jsonb_build_object('number',v.number::text))) ORDER BY m.id) FROM department_master.organization_identifier m CROSS JOIN LATERAL (SELECT * FROM department_master.organization_identifier_version WHERE identifier_id=m.id ORDER BY number DESC LIMIT 1) v WHERE m.target_type=p_type AND m.target_id=p_target AND m.scheme=p_scheme AND m.kind=p_kind),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION department_master.identifier_peers(text,text,uuid,text,text,text) FROM PUBLIC,hdi_prototype;
REVOKE ALL ON FUNCTION department_master.identifier_authorize(text,text,text,text),department_master.identifier_input_read(text,uuid,text),department_master.identifier_job_read(text,uuid),department_master.identifier_snapshot(text,uuid,text),department_master.identifier_list(text,text,uuid,integer,timestamp,text,uuid),department_master.identifier_code(text,text,uuid),department_master.identifier_initial_code(),department_master.identifier_assert_timeline(),department_master.identifier_mutate(text,text) FROM PUBLIC,hdi_prototype;
