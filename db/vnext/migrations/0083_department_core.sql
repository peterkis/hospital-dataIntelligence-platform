SELECT pg_advisory_xact_lock(901002);
CREATE SCHEMA department_master;
CREATE TABLE department_master.access(actor text NOT NULL REFERENCES vnext_control.actor(code),scope text NOT NULL CHECK(scope IN ('HOSPITAL','NORTH','SOUTH')),permission text NOT NULL CHECK(permission IN ('READ','WRITE','REVIEW','VERIFY','READ_RESTRICTED')),PRIMARY KEY(actor,scope,permission));
CREATE TABLE vnext_control.department_write_authority(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),key_hex text NOT NULL CHECK(key_hex ~ '^[a-f0-9]{64}$'));
CREATE TABLE department_master.input(id uuid PRIMARY KEY DEFAULT uuidv7(),revision uuid NOT NULL DEFAULT uuidv7(),job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),job_revision uuid NOT NULL REFERENCES governance_catalog.import_input_revision(id),maker text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(job_id,job_revision));
CREATE TABLE department_master.verification(id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL REFERENCES department_master.input(id),number bigint NOT NULL CHECK(number>0),actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL,envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(input_id,number));
CREATE TABLE department_master.department(id uuid PRIMARY KEY DEFAULT uuidv7(),code text NOT NULL UNIQUE CHECK(length(btrim(code))>0));
CREATE TABLE department_master.version(id uuid PRIMARY KEY DEFAULT uuidv7(),department_id uuid NOT NULL REFERENCES department_master.department(id),number bigint NOT NULL CHECK(number>0),valid_from timestamp NOT NULL,valid_to timestamp,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),input_id uuid NOT NULL REFERENCES department_master.input(id),source_row integer NOT NULL CHECK(source_row BETWEEN 1 AND 100),facts jsonb NOT NULL,content_digest text NOT NULL,UNIQUE(department_id,number),UNIQUE(input_id,source_row),CHECK(valid_to IS NULL OR valid_to>valid_from));

CREATE FUNCTION department_master.authorize(p_actor text,p_scope text,p_permission text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text; BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC',CASE WHEN p_permission IN ('REVIEW','VERIFY') THEN 'REVIEW' WHEN p_permission='WRITE' THEN 'WRITE' ELSE 'READ' END);
 IF NOT EXISTS(SELECT 1 FROM department_master.access WHERE actor=p_actor AND scope IN (p_scope,'HOSPITAL') AND permission=p_permission) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 RETURN identity;
END $$;
CREATE FUNCTION department_master.input_read(p_actor text,p_id uuid,p_permission text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r department_master.input;v department_master.verification; BEGIN
 SELECT * INTO r FROM department_master.input WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM department_master.authorize(p_actor,CASE WHEN p_permission IN ('REVIEW','VERIFY') THEN 'HOSPITAL' ELSE r.campus END,p_permission);
 PERFORM department_master.authorize(p_actor,r.campus,'READ');
 IF p_permission='READ_RESTRICTED' THEN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'DEPARTMENT_READ_RESTRICTED','ORG04_SOURCE',r.digest);END IF;
 SELECT * INTO v FROM department_master.verification WHERE input_id=r.id ORDER BY number DESC LIMIT 1;
 RETURN to_jsonb(r)||jsonb_build_object('verification',CASE WHEN v.id IS NULL THEN NULL ELSE to_jsonb(v) END);
END $$;
CREATE FUNCTION department_master.snapshot(p_actor text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d department_master.department; BEGIN
 PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');
 SELECT * INTO d FROM department_master.department WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 RETURN jsonb_build_object('id',d.id,'code',d.code,'versions',coalesce((SELECT jsonb_agg((to_jsonb(v)-'input_id')||jsonb_build_object('number',v.number::text) ORDER BY number) FROM department_master.version v WHERE department_id=d.id),'[]'));
END $$;
CREATE FUNCTION department_master.job_read(p_actor text,p_input uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;j governance_catalog.import_job;BEGIN
 r:=department_master.input_read(p_actor,p_input,'READ_RESTRICTED');
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=(r->>'job_id')::uuid;
 PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',j.contract_version_id,'READ');
 RETURN jsonb_build_object('id',j.id,'contract',j.contract_snapshot,'profile',j.profile,'status',j.status,'currentRevisionId',j.current_revision_id);
END $$;
CREATE FUNCTION department_master.list(p_actor text,p_after uuid,p_limit integer,p_record_at timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 RETURN coalesce((SELECT jsonb_agg(id ORDER BY id) FROM (SELECT d.id FROM department_master.department d WHERE (p_after IS NULL OR d.id>p_after) AND EXISTS(SELECT 1 FROM department_master.version v WHERE v.department_id=d.id AND (p_record_at IS NULL OR v.recorded_at<=p_record_at)) ORDER BY d.id LIMIT p_limit) x),'[]');
END $$;
CREATE FUNCTION department_master.code_conflict(p_actor text,p_code text,p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');RETURN EXISTS(SELECT 1 FROM department_master.department WHERE code=p_code AND id IS DISTINCT FROM p_id);
END $$;
CREATE FUNCTION department_master.evidence(p_actor text,p_id uuid,p_source uuid,p_version uuid,p_scope text,p_from timestamp,p_to timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM department_master.authorize(p_actor,p_scope,'READ_RESTRICTED');
 RETURN organization_master.evidence(p_actor,p_id,p_source,p_version,p_scope,p_from,p_to);
END $$;

-- Only the application authority can sign a mutation; service SQL has neither the key nor a signing oracle.
CREATE FUNCTION department_master.mutate(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;
 actor text:=t->>'actor';op text:=t->>'operation';identity text;r department_master.input;v department_master.verification;j governance_catalog.import_job;
 c governance_catalog.apply_candidate;a governance_catalog.apply_approval;command jsonb:=t->'command';target uuid;n bigint;vid uuid;prior text;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.department_write_authority WHERE singleton;
 IF secret IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF op='STAGE' THEN
  identity:=department_master.authorize(actor,t->>'campus','WRITE');PERFORM department_master.authorize(actor,t->>'campus','READ_RESTRICTED');
  SELECT * INTO r FROM department_master.input WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF r.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);END IF;
  SELECT * INTO j FROM governance_catalog.import_job WHERE id=(t->>'jobId')::uuid;
  IF j.submitter_identity IS DISTINCT FROM identity OR j.current_revision_id IS DISTINCT FROM (t->>'revisionId')::uuid THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
  PERFORM governance_catalog.import_job_read(actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));
  IF EXISTS(SELECT 1 FROM department_master.input WHERE job_id=j.id AND job_revision=j.current_revision_id) THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
  INSERT INTO department_master.input(job_id,job_revision,maker,identity_code,request_id,digest,campus,envelope) VALUES(j.id,j.current_revision_id,actor,identity,(t->>'requestId')::uuid,t->>'digest',t->>'campus',t->'envelope') RETURNING * INTO r;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'DEPARTMENT_INPUT','ORG04_CORE',r.digest);
  RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);
 END IF;
 SELECT * INTO r FROM department_master.input WHERE id=(t->>'inputId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF r.job_revision IS DISTINCT FROM (SELECT current_revision_id FROM governance_catalog.import_job WHERE id=r.job_id) THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 IF op='VERIFY' THEN
  identity:=department_master.authorize(actor,'HOSPITAL','VERIFY');PERFORM department_master.authorize(actor,r.campus,'READ_RESTRICTED');
  IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
  IF r.digest IS DISTINCT FROM t->>'inputDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  SELECT * INTO v FROM department_master.verification WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF v.digest IS DISTINCT FROM t->>'digest' OR v.input_id<>r.id THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('verificationId',v.id);END IF;
  IF EXISTS(SELECT 1 FROM department_master.version WHERE input_id=r.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
  INSERT INTO department_master.verification(input_id,number,actor,identity_code,request_id,digest,envelope) VALUES(r.id,(SELECT coalesce(max(number),0)+1 FROM department_master.verification WHERE input_id=r.id),actor,identity,(t->>'requestId')::uuid,t->>'digest',t->'envelope') RETURNING * INTO v;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'DEPARTMENT_VERIFY','ORG04_SEMANTIC_REVIEW',v.digest);
  RETURN jsonb_build_object('verificationId',v.id);
 END IF;
 IF op<>'APPLY' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 SELECT * INTO c FROM governance_catalog.apply_candidate WHERE id=(t->>'candidateId')::uuid;
 SELECT * INTO a FROM governance_catalog.apply_approval WHERE candidate_id=c.id;
 IF c.digest IS DISTINCT FROM t->>'digest' OR c.input->>'jobId' IS DISTINCT FROM r.id::text OR c.input->>'revisionId' IS DISTINCT FROM r.revision::text OR a.candidate_id IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 PERFORM governance_catalog.apply_record(a.actor_code,'CHECK_APPROVAL',jsonb_build_object('candidateId',c.id));
 PERFORM department_master.authorize(a.actor_code,'HOSPITAL','REVIEW');PERFORM department_master.authorize(actor,r.campus,'WRITE');
 IF command->'row'->>'record_status' IS DISTINCT FROM 'ACTIVE' OR nullif(btrim(command->'row'->>'approval_ref'),'') IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 IF nullif(command->'row'->>'abolished_on','') IS NOT NULL THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 target:=(command->'target'->>'id')::uuid;
 IF command->>'intent'='CREATE' THEN
  IF target IS NOT NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF EXISTS(SELECT 1 FROM department_master.department WHERE code=command->'row'->>'org_code') THEN RAISE EXCEPTION 'IDENTIFIER_CONFLICT';END IF;
  INSERT INTO department_master.department(code) VALUES(command->'row'->>'org_code') RETURNING id INTO target;n:=1;
 ELSIF command->>'intent'='REVISE' THEN
  SELECT code INTO prior FROM department_master.department WHERE id=target;
  IF prior IS DISTINCT FROM command->'row'->>'org_code' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
  SELECT max(number)+1 INTO n FROM department_master.version WHERE department_id=target;
  IF n IS NULL OR (n-1)::text IS DISTINCT FROM command->'target'->>'expectedVersion' OR command->'target'->>'owner' IS DISTINCT FROM 'department-master' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 INSERT INTO department_master.version(department_id,number,valid_from,valid_to,input_id,source_row,facts,content_digest) VALUES(target,n,(command->>'validFrom')::timestamp,(command->>'validTo')::timestamp,r.id,(t->>'row')::integer,t->'facts',t->>'contentDigest') RETURNING id INTO vid;
 RETURN jsonb_build_object('owner','department-master','id',target,'version',n::text,'source',jsonb_build_object('dataset','ORG04','row',(t->>'row')::integer,'step','DEPARTMENT'));
END $$;

DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['input','verification','department','version'] LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON department_master.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['access','input','verification','department','version'] LOOP
  EXECUTE format('ALTER TABLE department_master.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
END $$;
CREATE TRIGGER access_lock BEFORE INSERT OR UPDATE OR DELETE ON department_master.access FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE FUNCTION department_master.audit_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES('VNEXT_GRANT_CONTROL','00000000-0000-0000-0000-000000000000','DEPARTMENT_GRANT_'||TG_OP,'CONTROLLED_AUTHORIZATION',encode(sha256(convert_to(jsonb_build_object('before',to_jsonb(OLD),'after',to_jsonb(NEW))::text,'UTF8')),'hex'));RETURN NULL;
END $$;
CREATE TRIGGER access_audit AFTER INSERT OR UPDATE OR DELETE ON department_master.access FOR EACH ROW EXECUTE FUNCTION department_master.audit_access();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON vnext_control.department_write_authority FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
ALTER TABLE vnext_control.department_write_authority ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA department_master FROM PUBLIC,hdi_prototype;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA department_master FROM PUBLIC,hdi_prototype;
REVOKE ALL ON vnext_control.department_write_authority FROM PUBLIC,hdi_prototype;
GRANT USAGE ON SCHEMA department_master TO hdi_prototype;
GRANT SELECT ON ALL TABLES IN SCHEMA department_master TO hdi_prototype;

DO $patch$ DECLARE body text;needle text; BEGIN
 body:=pg_get_functiondef('governance_catalog.validation_rules_valid(jsonb,uuid)'::regprocedure);
 needle:='OR (code=''ORG03'' AND definition->>''templateVersion''=''ORG03_MANUAL_CORE_V1''';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'DEPARTMENT_RULE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'OR (code=''ORG04'' AND definition->>''templateVersion''=''ORG04_CORE_V1'' AND rule->>''id'' IN (''SRC-COND-008'',''SRC-COND-009'')) '||needle);
 needle:=' FOR rule IN SELECT value FROM jsonb_array_elements(definition->''rules'') LOOP';
 EXECUTE replace(body,needle,needle||$rule$
  IF code='ORG04' AND definition->>'templateVersion'='ORG04_CORE_V1' AND rule->>'id'='DEPARTMENT_APPROVAL_V1' AND rule->>'field'='approval_ref' AND rule->>'version'='P2_01_V1' AND rule->>'status'='MACHINE' AND rule->>'text'='Source approval never replaces platform approval.' THEN CONTINUE;END IF;
$rule$);
 body:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 needle:='NOT IN (''BLOCKED_DEPENDENCY'',''DECLARED_PARAMETER'',''ADOPTED_CODESET'',''ORG_BUNDLE'')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'DEPARTMENT_REFERENCE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'NOT IN (''BLOCKED_DEPENDENCY'',''DECLARED_PARAMETER'',''ADOPTED_CODESET'',''ORG_BUNDLE'',''DEPARTMENT_CORE'')');
 needle:='  IF entry->>''status''=''DECLARED_PARAMETER'' THEN';
 body:=replace(body,needle,$guard$
  IF entry->>'status'='DEPARTMENT_CORE' AND (p_profile<>'CORE' OR p_definition->>'templateVersion'<>'ORG04_CORE_V1' OR NOT EXISTS(SELECT 1 FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_dataset_version AND o.code='ORG04' AND o.scope='SYNTHETIC')) THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
$guard$||needle);
 needle:=' IF p_profile=''FULL''';
 EXECUTE replace(body,needle,$fields$
 IF p_definition->>'templateVersion'='ORG04_CORE_V1' AND (p_profile<>'CORE' OR jsonb_array_length(p_definition->'fields')<>18 OR jsonb_array_length(dataset->'fields')<>18) THEN RAISE EXCEPTION 'FULL_FIELD_OMISSION';END IF;
$fields$||needle);
END $patch$;

-- Finite ORG04 parser: original offset-bearing source rows are retained.
DO $patch$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('governance_catalog.import_job_command(text,jsonb)'::regprocedure);
 needle:='IN (''STRICT_V1'',''STRICT_V2'')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'DEPARTMENT_PARSER_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'IN (''STRICT_V1'',''STRICT_V2'',''STRICT_DEPARTMENT_V1'')');
END $patch$;
ALTER TABLE governance_catalog.import_input_revision DROP CONSTRAINT import_input_revision_metadata_shape_check;
ALTER TABLE governance_catalog.import_input_revision ADD CONSTRAINT import_input_revision_metadata_shape_check CHECK(
 ((metadata->>'kind'='FILE' AND metadata->>'format' IN ('CSV','JSON','XLSX') AND metadata->>'parserPolicy' IN ('STRICT_V1','STRICT_V2','STRICT_DEPARTMENT_V1') AND metadata-ARRAY['kind','format','parserPolicy']='{}'::jsonb)
 OR (metadata->>'kind'='FILE' AND metadata->>'format'='XLSX' AND metadata->>'parserPolicy'='STRICT_ORG_BUNDLE_V1' AND metadata->>'manifestDigest' ~ '^[a-f0-9]{64}$' AND metadata->>'contractsDigest' ~ '^[a-f0-9]{64}$' AND metadata-ARRAY['kind','format','parserPolicy','manifestDigest','contractsDigest']='{}'::jsonb)
 OR (metadata->>'kind'='METADATA_ONLY' AND metadata->>'declaredSha256' ~ '^[a-f0-9]{64}$' AND metadata-ARRAY['kind','declaredSha256']='{}'::jsonb)) IS TRUE);
ALTER TABLE governance_catalog.parse_provenance DROP CONSTRAINT parse_provenance_policy_check;
ALTER TABLE governance_catalog.parse_provenance ADD CONSTRAINT parse_provenance_policy_check CHECK(policy IN ('STRICT_V1','STRICT_V2','STRICT_ORG_BUNDLE_V1','STRICT_DEPARTMENT_V1'));
DO $patch$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)'::regprocedure);
 body:=replace(body,'p.policy=''STRICT_ORG_BUNDLE_V1'' AND p_decision=''FAIL''','p.policy IN (''STRICT_ORG_BUNDLE_V1'',''STRICT_DEPARTMENT_V1'') AND p_decision=''FAIL''');
 needle:='IF p_decision=''PASS'' AND (p.policy<>''STRICT_ORG_BUNDLE_V1'' OR NOT EXISTS(SELECT 1 FROM organization_master.bundle_revision WHERE revision_id=p.revision_id))';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'DEPARTMENT_VALIDATION_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF p_decision=''PASS'' AND NOT ((p.policy=''STRICT_ORG_BUNDLE_V1'' AND EXISTS(SELECT 1 FROM organization_master.bundle_revision WHERE revision_id=p.revision_id)) OR (p.policy=''STRICT_DEPARTMENT_V1'' AND EXISTS(SELECT 1 FROM department_master.input WHERE job_revision=p.revision_id)))');
 EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.read_validation(text,uuid)'::regprocedure);
 EXECUTE replace(body,'CASE WHEN p.policy=''STRICT_ORG_BUNDLE_V1'' THEN ''READY''','CASE WHEN p.policy IN (''STRICT_ORG_BUNDLE_V1'',''STRICT_DEPARTMENT_V1'') THEN ''READY''');
END $patch$;
