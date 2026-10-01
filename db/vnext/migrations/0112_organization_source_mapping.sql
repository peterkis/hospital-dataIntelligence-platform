SELECT pg_advisory_xact_lock(901002);

CREATE TABLE department_master.mapping_access(
 actor text NOT NULL REFERENCES vnext_control.actor(code),from_system_id uuid NOT NULL REFERENCES governance_catalog.object(id),
 entity_type text NOT NULL CHECK(length(entity_type) BETWEEN 1 AND 64 AND entity_type=btrim(entity_type)),
 context text NOT NULL CHECK(length(context) BETWEEN 1 AND 256 AND context=btrim(context)),
 campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),
 permission text NOT NULL CHECK(permission IN ('READ','WRITE','VERIFY','REVIEW','READ_RESTRICTED')),
 PRIMARY KEY(actor,from_system_id,entity_type,context,campus,permission)
);
CREATE FUNCTION department_master.mapping_list(p_actor text,p_campus text,p_after uuid,p_limit integer,p_record_at timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 IF p_campus NOT IN ('NORTH','SOUTH') OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM department_master.mapping_access WHERE actor=p_actor AND campus=p_campus AND permission='READ') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 RETURN '[]'::jsonb;
END $$;
ALTER TABLE department_master.mapping_access ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER mapping_access_lock BEFORE INSERT OR UPDATE OR DELETE ON department_master.mapping_access FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER mapping_access_audit AFTER INSERT OR UPDATE OR DELETE ON department_master.mapping_access FOR EACH ROW EXECUTE FUNCTION department_master.audit_access();
REVOKE ALL ON department_master.mapping_access FROM PUBLIC,hdi_prototype;
REVOKE ALL ON FUNCTION department_master.mapping_list(text,text,uuid,integer,timestamp) FROM PUBLIC,hdi_prototype;

CREATE TABLE department_master.mapping_target_access(actor text NOT NULL REFERENCES vnext_control.actor(code),target_type text NOT NULL CHECK(target_type IN ('LEGAL','CAMPUS','ORG')),target_id uuid NOT NULL,campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),PRIMARY KEY(actor,target_type,target_id,campus));
CREATE TABLE department_master.mapping_input(
 id uuid PRIMARY KEY DEFAULT uuidv7(),revision uuid NOT NULL DEFAULT uuidv7(),job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),job_revision uuid NOT NULL REFERENCES governance_catalog.import_input_revision(id),
 maker text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),
 namespaces jsonb NOT NULL CHECK(jsonb_typeof(namespaces)='array' AND jsonb_array_length(namespaces) BETWEEN 1 AND 100),envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(job_id,job_revision)
);
CREATE TABLE department_master.mapping_verification(id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL REFERENCES department_master.mapping_input(id),number bigint NOT NULL CHECK(number>0),actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(input_id,number));
CREATE TABLE department_master.organization_mapping(
 id uuid PRIMARY KEY DEFAULT uuidv7(),from_system_id uuid NOT NULL REFERENCES governance_catalog.object(id),entity_type text NOT NULL CHECK(length(entity_type) BETWEEN 1 AND 64 AND entity_type=btrim(entity_type)),source_code text NOT NULL CHECK(length(source_code) BETWEEN 1 AND 256 AND source_code=btrim(source_code)),context text NOT NULL CHECK(length(context) BETWEEN 1 AND 256 AND context=btrim(context)),campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),
 UNIQUE(from_system_id,entity_type,source_code,context)
);
CREATE TABLE department_master.organization_mapping_version(
 id uuid PRIMARY KEY DEFAULT uuidv7(),mapping_id uuid NOT NULL REFERENCES department_master.organization_mapping(id),number bigint NOT NULL CHECK(number>0),predecessor uuid REFERENCES department_master.organization_mapping_version(id),
 action text NOT NULL CHECK(action IN ('REGISTER','CORRECT','RETRACT')),target_type text NOT NULL CHECK(target_type IN ('LEGAL','CAMPUS','ORG')),target_id uuid NOT NULL,
 valid_from timestamp NOT NULL,valid_to timestamp,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 input_id uuid NOT NULL REFERENCES department_master.mapping_input(id),source_row integer NOT NULL CHECK(source_row BETWEEN 1 AND 1048576),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),facts jsonb NOT NULL,content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
 UNIQUE(mapping_id,number),UNIQUE(input_id,source_row),CHECK(valid_to IS NULL OR valid_to>valid_from),CHECK((number=1 AND action='REGISTER' AND predecessor IS NULL) OR (number>1 AND action<>'REGISTER' AND predecessor IS NOT NULL))
);
CREATE INDEX organization_mapping_version_record ON department_master.organization_mapping_version(mapping_id,number DESC,recorded_at);

CREATE FUNCTION department_master.mapping_authorize(p_actor text,p_source uuid,p_entity text,p_context text,p_campus text,p_permission text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC',CASE WHEN p_permission IN ('REVIEW','VERIFY') THEN 'REVIEW' WHEN p_permission='WRITE' THEN 'WRITE' ELSE 'READ' END);
 IF NOT EXISTS(SELECT 1 FROM department_master.mapping_access WHERE actor=p_actor AND from_system_id=p_source AND entity_type=p_entity AND context=p_context AND campus=p_campus AND permission=p_permission) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 RETURN identity;
END $$;
CREATE FUNCTION department_master.mapping_target_authorize(p_actor text,p_type text,p_id uuid,p_campus text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 IF NOT EXISTS(SELECT 1 FROM department_master.mapping_target_access WHERE actor=p_actor AND target_type=p_type AND target_id=p_id AND campus=p_campus) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
END $$;
CREATE FUNCTION department_master.mapping_source(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_admission boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pin uuid;BEGIN
 PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',p_id);
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=p_id AND kind='SOURCE' AND scope='SYNTHETIC') THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 IF NOT p_admission THEN RETURN jsonb_build_object('sourceId',p_id);END IF;
 pin:=governance_catalog.source_covering_version(p_id,tsrange(p_from,p_to,'[)'));
 RETURN jsonb_build_object('sourceId',p_id,'versionId',pin);
END $$;
CREATE FUNCTION department_master.mapping_input_read(p_actor text,p_id uuid,p_permission text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r department_master.mapping_input;v department_master.mapping_verification;ns jsonb;BEGIN
 SELECT * INTO r FROM department_master.mapping_input WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 FOR ns IN SELECT value FROM jsonb_array_elements(r.namespaces) LOOP
  PERFORM department_master.mapping_authorize(p_actor,(ns->>'source')::uuid,ns->>'entity',ns->>'context',r.campus,p_permission);
  PERFORM department_master.mapping_authorize(p_actor,(ns->>'source')::uuid,ns->>'entity',ns->>'context',r.campus,'READ');
 END LOOP;
 IF p_permission='READ_RESTRICTED' THEN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'ORG_MAPPING_INPUT_READ','RESTRICTED_INPUT',r.digest);END IF;
 SELECT * INTO v FROM department_master.mapping_verification WHERE input_id=r.id ORDER BY number DESC LIMIT 1;
 RETURN to_jsonb(r)||jsonb_build_object('verification',CASE WHEN v.id IS NULL THEN NULL ELSE to_jsonb(v) END);
END $$;
CREATE FUNCTION department_master.mapping_job_read(p_actor text,p_input uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;BEGIN
 r:=department_master.mapping_input_read(p_actor,p_input,'READ_RESTRICTED');
 RETURN governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r->>'job_id'));
END $$;
CREATE FUNCTION department_master.mapping_snapshot(p_actor text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m department_master.organization_mapping;BEGIN
 SELECT * INTO m FROM department_master.organization_mapping WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM department_master.mapping_authorize(p_actor,m.from_system_id,m.entity_type,m.context,m.campus,'READ');
 RETURN to_jsonb(m)||jsonb_build_object('versions',coalesce((SELECT jsonb_agg((to_jsonb(v)-'input_id')||jsonb_build_object('number',v.number::text) ORDER BY number) FROM department_master.organization_mapping_version v WHERE mapping_id=m.id),'[]'));
END $$;
CREATE FUNCTION department_master.mapping_find(p_actor text,p_source uuid,p_entity text,p_code text,p_context text,p_campus text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE id uuid;BEGIN
 PERFORM department_master.mapping_authorize(p_actor,p_source,p_entity,p_context,p_campus,'READ');
 SELECT m.id INTO id FROM department_master.organization_mapping m WHERE from_system_id=p_source AND entity_type=p_entity AND source_code=p_code AND context=p_context;
 IF id IS NULL THEN RETURN NULL;END IF;RETURN department_master.mapping_snapshot(p_actor,id);
END $$;
CREATE FUNCTION department_master.mapping_resolution_required(p_actor text,p_source uuid,p_entity text,p_code text,p_context text,p_campus text,p_type text,p_target uuid,p_from timestamp,p_to timestamp) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM department_master.mapping_authorize(p_actor,p_source,p_entity,p_context,p_campus,'READ');
 RETURN EXISTS(SELECT 1 FROM department_master.organization_mapping m CROSS JOIN LATERAL (SELECT * FROM department_master.organization_mapping_version WHERE mapping_id=m.id ORDER BY number DESC LIMIT 1) v WHERE m.from_system_id=p_source AND m.entity_type=p_entity AND m.source_code=p_code AND m.context<>p_context AND v.action<>'RETRACT' AND (v.target_type<>p_type OR v.target_id<>p_target) AND tsrange(v.valid_from,v.valid_to,'[)')&&tsrange(p_from,p_to,'[)'));
END $$;
CREATE OR REPLACE FUNCTION department_master.mapping_list(p_actor text,p_campus text,p_after uuid,p_limit integer,p_record_at timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 IF p_campus NOT IN ('NORTH','SOUTH') OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM department_master.mapping_access WHERE actor=p_actor AND campus=p_campus AND permission='READ') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 RETURN coalesce((SELECT jsonb_agg(id ORDER BY id) FROM (SELECT m.id FROM department_master.organization_mapping m WHERE m.campus=p_campus AND (p_after IS NULL OR m.id>p_after) AND EXISTS(SELECT 1 FROM department_master.mapping_access a WHERE a.actor=p_actor AND a.campus=m.campus AND a.from_system_id=m.from_system_id AND a.entity_type=m.entity_type AND a.context=m.context AND a.permission='READ') AND EXISTS(SELECT 1 FROM department_master.organization_mapping_version v WHERE v.mapping_id=m.id AND (p_record_at IS NULL OR v.recorded_at<=p_record_at)) ORDER BY m.id LIMIT p_limit) rows),'[]');
END $$;

CREATE FUNCTION department_master.mapping_mutate(p_ticket text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;
 actor text:=t->>'actor';op text:=t->>'operation';identity text;ns jsonb;r department_master.mapping_input;j governance_catalog.import_job;verify department_master.mapping_verification;
 c governance_catalog.apply_candidate;a governance_catalog.apply_approval;m department_master.organization_mapping;v department_master.organization_mapping_version;vid uuid;command jsonb:=t->'command';row jsonb:=command->'row';n bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.department_write_authority WHERE singleton;
 IF secret IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF op='STAGE' THEN
  IF jsonb_typeof(t->'namespaces')<>'array' OR jsonb_array_length(t->'namespaces') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  FOR ns IN SELECT value FROM jsonb_array_elements(t->'namespaces') LOOP
   identity:=department_master.mapping_authorize(actor,(ns->>'source')::uuid,ns->>'entity',ns->>'context',t->>'campus','WRITE');
   PERFORM department_master.mapping_authorize(actor,(ns->>'source')::uuid,ns->>'entity',ns->>'context',t->>'campus','READ_RESTRICTED');
  END LOOP;
  SELECT * INTO r FROM department_master.mapping_input WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF r.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);END IF;
  PERFORM governance_catalog.import_job_read(actor,jsonb_build_object('scope','SYNTHETIC','jobId',t->>'jobId'));
  SELECT * INTO j FROM governance_catalog.import_job WHERE id=(t->>'jobId')::uuid;
  IF j.submitter_identity IS DISTINCT FROM identity OR j.current_revision_id IS DISTINCT FROM (t->>'revisionId')::uuid OR j.contract_snapshot->>'dataset'<>'ORG22' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
  IF EXISTS(SELECT 1 FROM department_master.mapping_input WHERE job_id=j.id AND job_revision=j.current_revision_id) THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
  INSERT INTO department_master.mapping_input(job_id,job_revision,maker,identity_code,request_id,digest,campus,namespaces,envelope) VALUES(j.id,j.current_revision_id,actor,identity,(t->>'requestId')::uuid,t->>'digest',t->>'campus',t->'namespaces',t->'envelope') RETURNING * INTO r;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'ORG_MAPPING_INPUT','ORG22_CORE',r.digest);
  RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);
 END IF;
 r:=jsonb_populate_record(NULL::department_master.mapping_input,department_master.mapping_input_read(actor,(t->>'inputId')::uuid,CASE WHEN op='VERIFY' THEN 'VERIFY' ELSE 'WRITE' END));
 IF r.job_revision IS DISTINCT FROM (SELECT current_revision_id FROM governance_catalog.import_job WHERE id=r.job_id) THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 IF op='VERIFY' THEN
  identity:=vnext_control.authorize(actor,'SYNTHETIC','REVIEW');IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
  IF r.digest IS DISTINCT FROM t->>'inputDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  SELECT * INTO verify FROM department_master.mapping_verification WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF verify.digest IS DISTINCT FROM t->>'digest' OR verify.input_id<>r.id THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('verificationId',verify.id);END IF;
  IF EXISTS(SELECT 1 FROM department_master.organization_mapping_version WHERE input_id=r.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
  INSERT INTO department_master.mapping_verification(input_id,number,actor,identity_code,request_id,digest,envelope) VALUES(r.id,(SELECT coalesce(max(number),0)+1 FROM department_master.mapping_verification WHERE input_id=r.id),actor,identity,(t->>'requestId')::uuid,t->>'digest',t->'envelope') RETURNING * INTO verify;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'ORG_MAPPING_VERIFY','EXACT_CONTEXT_EVIDENCE',verify.digest);
  RETURN jsonb_build_object('verificationId',verify.id);
 END IF;
 IF op<>'APPLY' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 SELECT * INTO c FROM governance_catalog.apply_candidate WHERE id=(t->>'candidateId')::uuid;SELECT * INTO a FROM governance_catalog.apply_approval WHERE candidate_id=c.id;
 IF c.digest IS DISTINCT FROM t->>'digest' OR c.input->>'jobId' IS DISTINCT FROM r.id::text OR c.input->>'revisionId' IS DISTINCT FROM r.revision::text OR a.candidate_id IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 PERFORM governance_catalog.apply_record(a.actor_code,'CHECK_APPROVAL',jsonb_build_object('candidateId',c.id));
 PERFORM department_master.mapping_input_read(a.actor_code,r.id,'REVIEW');
 -- Even non-expansion retains current reference authority. Qualification stays
 -- in the transaction-bound Owner observation; retired references remain closable.
 PERFORM department_master.mapping_target_authorize(actor,row->>'target_type',(row->>'target_id')::uuid,r.campus);
 PERFORM department_master.mapping_target_authorize(a.actor_code,row->>'target_type',(row->>'target_id')::uuid,r.campus);
 PERFORM vnext_control.require_source_access(actor,'SYNTHETIC',(row->>'from_system_id')::uuid);
 PERFORM vnext_control.require_source_access(actor,'SYNTHETIC',(row->>'source_system_id')::uuid);
 PERFORM vnext_control.require_source_access(a.actor_code,'SYNTHETIC',(row->>'from_system_id')::uuid);
 PERFORM vnext_control.require_source_access(a.actor_code,'SYNTHETIC',(row->>'source_system_id')::uuid);
 IF command->>'action' NOT IN ('REGISTER','CORRECT','RETRACT') OR row->>'mapping_relation'<>'EXACT' OR row->>'record_status'<>'ACTIVE' OR nullif(btrim(row->>'approval_ref'),'') IS NULL THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 IF command->>'action'='REGISTER' THEN
  IF command->'mapping'<>'null'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF EXISTS(SELECT 1 FROM department_master.organization_mapping WHERE from_system_id=(row->>'from_system_id')::uuid AND entity_type=row->>'source_entity_type' AND source_code=row->>'source_code' AND context=row->>'source_context') THEN RAISE EXCEPTION 'MAPPING_ALREADY_REGISTERED';END IF;
  INSERT INTO department_master.organization_mapping(from_system_id,entity_type,source_code,context,campus) VALUES((row->>'from_system_id')::uuid,row->>'source_entity_type',row->>'source_code',row->>'source_context',r.campus) RETURNING * INTO m;n:=1;
 ELSE
  SELECT * INTO m FROM department_master.organization_mapping WHERE id=(command->'mapping'->>'id')::uuid;
  IF NOT FOUND OR m.campus<>r.campus OR m.from_system_id<>(row->>'from_system_id')::uuid OR m.entity_type<>row->>'source_entity_type' OR m.source_code<>row->>'source_code' OR m.context<>row->>'source_context' THEN RAISE EXCEPTION 'MAPPING_IDENTITY_IMMUTABLE';END IF;
  SELECT * INTO v FROM department_master.organization_mapping_version WHERE mapping_id=m.id ORDER BY number DESC LIMIT 1;
  IF v.number::text IS DISTINCT FROM command->'mapping'->>'expectedHead' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  IF v.action='RETRACT' THEN RAISE EXCEPTION 'MAPPING_RETRACTED';END IF;n:=v.number+1;
  IF command->>'action'='RETRACT' AND (v.target_id<>(row->>'target_id')::uuid OR v.target_type<>row->>'target_type' OR v.valid_from<>(command->>'validFrom')::timestamp OR v.valid_to IS DISTINCT FROM (command->>'validTo')::timestamp) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 END IF;
 IF (t->>'sourceRow')::integer NOT BETWEEN 1 AND 1048576 OR jsonb_typeof(t->'facts')<>'object' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 INSERT INTO department_master.organization_mapping_version(mapping_id,number,predecessor,action,target_type,target_id,valid_from,valid_to,input_id,source_row,reason,facts,content_digest) VALUES(m.id,n,v.id,command->>'action',row->>'target_type',(row->>'target_id')::uuid,(command->>'validFrom')::timestamp,(command->>'validTo')::timestamp,r.id,(t->>'sourceRow')::integer,command->>'reason',t->'facts',t->>'contentDigest') RETURNING id INTO vid;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,m.id,'ORG_MAPPING_'||(command->>'action'),'EXPLICIT_APPROVED_COMMAND',t->>'contentDigest');
 RETURN jsonb_build_object('owner','department-master/organization-mapping','id',m.id,'version',n::text,'source',jsonb_build_object('dataset','ORG22','row',(t->>'sourceRow')::integer,'step',command->>'action'));
END $$;
DO $$ DECLARE table_name text;BEGIN
 FOREACH table_name IN ARRAY ARRAY['mapping_input','mapping_verification','organization_mapping','organization_mapping_version'] LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON department_master.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',table_name);
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['mapping_target_access','mapping_input','mapping_verification','organization_mapping','organization_mapping_version'] LOOP
  EXECUTE format('ALTER TABLE department_master.%I ENABLE ROW LEVEL SECURITY',table_name);EXECUTE format('REVOKE ALL ON department_master.%I FROM PUBLIC,hdi_prototype',table_name);
 END LOOP;
END $$;
CREATE TRIGGER mapping_target_access_lock BEFORE INSERT OR UPDATE OR DELETE ON department_master.mapping_target_access FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER mapping_target_access_audit AFTER INSERT OR UPDATE OR DELETE ON department_master.mapping_target_access FOR EACH ROW EXECUTE FUNCTION department_master.audit_access();
REVOKE ALL ON FUNCTION department_master.mapping_authorize(text,uuid,text,text,text,text),department_master.mapping_target_authorize(text,text,uuid,text),department_master.mapping_source(text,uuid,timestamp,timestamp,boolean),department_master.mapping_input_read(text,uuid,text),department_master.mapping_job_read(text,uuid),department_master.mapping_snapshot(text,uuid),department_master.mapping_find(text,uuid,text,text,text,text),department_master.mapping_mutate(text,text) FROM PUBLIC,hdi_prototype;
REVOKE ALL ON FUNCTION department_master.mapping_resolution_required(text,uuid,text,text,text,text,text,uuid,timestamp,timestamp) FROM PUBLIC,hdi_prototype;

DO $patch$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('governance_catalog.validation_rules_valid(jsonb,uuid)'::regprocedure);
 needle:='OR (code=''ORG04'' AND definition->>''templateVersion''=''ORG04_CORE_V1''';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ORG_MAPPING_RULE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'OR (code=''ORG22'' AND definition->>''templateVersion''=''ORG22_CORE_V1'' AND rule->>''id''=''SRC-COND-023'') '||needle);
 needle:=' FOR rule IN SELECT value FROM jsonb_array_elements(definition->''rules'') LOOP';
 EXECUTE replace(body,needle,needle||$rule$
  IF code='ORG22' AND definition->>'templateVersion'='ORG22_CORE_V1' AND rule->>'id'='ORG_MAPPING_APPROVAL_V1' AND rule->>'field'='approval_ref' AND rule->>'version'='P2_03_V1' AND rule->>'status'='MACHINE' AND rule->>'text'='Source approval never replaces platform approval.' THEN CONTINUE;END IF;
$rule$);
 body:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 needle:='NOT IN (''BLOCKED_DEPENDENCY'',''DECLARED_PARAMETER'',''ADOPTED_CODESET'',''ORG_BUNDLE'',''DEPARTMENT_CORE'')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ORG_MAPPING_REFERENCE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'NOT IN (''BLOCKED_DEPENDENCY'',''DECLARED_PARAMETER'',''ADOPTED_CODESET'',''ORG_BUNDLE'',''DEPARTMENT_CORE'',''ORGANIZATION_MAPPING_CORE'')');
 needle:='  IF entry->>''status''=''DECLARED_PARAMETER'' THEN';
 body:=replace(body,needle,$guard$
  IF entry->>'status'='ORGANIZATION_MAPPING_CORE' AND (p_profile<>'CORE' OR p_definition->>'templateVersion'<>'ORG22_CORE_V1' OR NOT EXISTS(SELECT 1 FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_dataset_version AND o.code='ORG22' AND o.scope='SYNTHETIC')) THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
$guard$||needle);
 needle:=' IF p_profile=''FULL''';
 EXECUTE replace(body,needle,$fields$
 IF p_definition->>'templateVersion'='ORG22_CORE_V1' AND (p_profile<>'CORE' OR jsonb_array_length(p_definition->'fields')<>19 OR jsonb_array_length(dataset->'fields')<>19) THEN RAISE EXCEPTION 'FULL_FIELD_OMISSION';END IF;
$fields$||needle);
END $patch$;

DO $parser$ DECLARE body text;BEGIN
 body:=pg_get_functiondef('governance_catalog.import_job_command(text,jsonb)'::regprocedure);
 IF position('''STRICT_DEPARTMENT_V1''' IN body)=0 THEN RAISE EXCEPTION 'ORG_MAPPING_PARSER_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,'''STRICT_DEPARTMENT_V1''','''STRICT_DEPARTMENT_V1'',''STRICT_ORGANIZATION_MAPPING_V1''');
 body:=pg_get_functiondef('governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)'::regprocedure);
 body:=replace(body,'p.policy IN (''STRICT_ORG_BUNDLE_V1'',''STRICT_DEPARTMENT_V1'')','p.policy IN (''STRICT_ORG_BUNDLE_V1'',''STRICT_DEPARTMENT_V1'',''STRICT_ORGANIZATION_MAPPING_V1'')');
 body:=replace(body,'OR (p.policy=''STRICT_DEPARTMENT_V1'' AND EXISTS(SELECT 1 FROM department_master.input WHERE job_revision=p.revision_id))','OR (p.policy=''STRICT_DEPARTMENT_V1'' AND EXISTS(SELECT 1 FROM department_master.input WHERE job_revision=p.revision_id)) OR (p.policy=''STRICT_ORGANIZATION_MAPPING_V1'' AND EXISTS(SELECT 1 FROM department_master.mapping_input WHERE job_revision=p.revision_id))');
 EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.read_validation(text,uuid)'::regprocedure);
 EXECUTE replace(body,'p.policy IN (''STRICT_ORG_BUNDLE_V1'',''STRICT_DEPARTMENT_V1'')','p.policy IN (''STRICT_ORG_BUNDLE_V1'',''STRICT_DEPARTMENT_V1'',''STRICT_ORGANIZATION_MAPPING_V1'')');
END $parser$;
ALTER TABLE governance_catalog.import_input_revision DROP CONSTRAINT import_input_revision_metadata_shape_check;
ALTER TABLE governance_catalog.import_input_revision ADD CONSTRAINT import_input_revision_metadata_shape_check CHECK(
 ((metadata->>'kind'='FILE' AND metadata->>'format' IN ('CSV','JSON','XLSX') AND metadata->>'parserPolicy' IN ('STRICT_V1','STRICT_V2','STRICT_DEPARTMENT_V1','STRICT_ORGANIZATION_MAPPING_V1') AND metadata-ARRAY['kind','format','parserPolicy']='{}'::jsonb)
 OR (metadata->>'kind'='FILE' AND metadata->>'format'='XLSX' AND metadata->>'parserPolicy'='STRICT_ORG_BUNDLE_V1' AND metadata->>'manifestDigest' ~ '^[a-f0-9]{64}$' AND metadata->>'contractsDigest' ~ '^[a-f0-9]{64}$' AND metadata-ARRAY['kind','format','parserPolicy','manifestDigest','contractsDigest']='{}'::jsonb)
 OR (metadata->>'kind'='METADATA_ONLY' AND metadata->>'declaredSha256' ~ '^[a-f0-9]{64}$' AND metadata-ARRAY['kind','declaredSha256']='{}'::jsonb)) IS TRUE);
ALTER TABLE governance_catalog.parse_provenance DROP CONSTRAINT parse_provenance_policy_check;
ALTER TABLE governance_catalog.parse_provenance ADD CONSTRAINT parse_provenance_policy_check CHECK(policy IN ('STRICT_V1','STRICT_V2','STRICT_ORG_BUNDLE_V1','STRICT_DEPARTMENT_V1','STRICT_ORGANIZATION_MAPPING_V1'));
