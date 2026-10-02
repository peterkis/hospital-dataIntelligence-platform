SELECT pg_advisory_xact_lock(901002);

CREATE TABLE department_master.evolution_input(
 id uuid PRIMARY KEY DEFAULT uuidv7(),revision uuid NOT NULL DEFAULT uuidv7(),
 job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),job_revision uuid NOT NULL REFERENCES governance_catalog.import_input_revision(id),
 maker text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,
 digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),
 source_system_id uuid NOT NULL,envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 UNIQUE(identity_code,request_id),UNIQUE(job_id,job_revision)
);
CREATE TABLE department_master.evolution_verification(
 id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL REFERENCES department_master.evolution_input(id),number bigint NOT NULL CHECK(number>0),
 actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,
 digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 UNIQUE(identity_code,request_id),UNIQUE(input_id,number)
);
CREATE TABLE department_master.evolution_event(
 id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL UNIQUE REFERENCES department_master.evolution_input(id),
 change_type text NOT NULL CHECK(change_type IN ('RENAME','SPLIT','MERGE')),effective_at timestamp NOT NULL,recorded_at timestamp NOT NULL,
 campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),source_system_id uuid NOT NULL,source_client_key text NOT NULL,source_row integer NOT NULL CHECK(source_row BETWEEN 1 AND 1048576),
 facts jsonb NOT NULL,content_digest text NOT NULL CHECK(content_digest~'^[a-f0-9]{64}$')
);
ALTER TABLE department_master.version ALTER COLUMN input_id DROP NOT NULL;
ALTER TABLE department_master.version ADD COLUMN evolution_event_id uuid REFERENCES department_master.evolution_event(id);
ALTER TABLE department_master.version ADD CONSTRAINT department_version_origin CHECK((input_id IS NULL)<>(evolution_event_id IS NULL));
CREATE UNIQUE INDEX department_version_evolution_origin ON department_master.version(evolution_event_id,department_id) WHERE evolution_event_id IS NOT NULL;
CREATE TABLE department_master.evolution_relation(
 id uuid PRIMARY KEY DEFAULT uuidv7(),event_id uuid NOT NULL REFERENCES department_master.evolution_event(id),source_client_key text NOT NULL,source_to_alias text NOT NULL CHECK(length(btrim(source_to_alias)) BETWEEN 1 AND 64),
 relation_kind text NOT NULL CHECK(relation_kind IN ('SAME_ID_VERSION','SUCCESSION')),
 from_department_id uuid NOT NULL REFERENCES department_master.department(id),from_version_id uuid NOT NULL REFERENCES department_master.version(id),
 to_department_id uuid NOT NULL REFERENCES department_master.department(id),to_version_id uuid NOT NULL REFERENCES department_master.version(id),
 transfer_scope text NOT NULL CHECK(length(btrim(transfer_scope))>0),context_rule text NOT NULL,
 source_row integer NOT NULL CHECK(source_row BETWEEN 1 AND 1048576),source_recorded_at timestamp NOT NULL,recorded_at timestamp NOT NULL,
 CHECK((relation_kind='SAME_ID_VERSION' AND from_department_id=to_department_id AND from_version_id<>to_version_id) OR (relation_kind='SUCCESSION' AND from_department_id<>to_department_id)),
 UNIQUE(event_id,source_client_key),UNIQUE(event_id,from_department_id,to_department_id)
);
CREATE TABLE department_master.replacement(
 department_id uuid PRIMARY KEY REFERENCES department_master.department(id),event_id uuid NOT NULL REFERENCES department_master.evolution_event(id),
 effective_at timestamp NOT NULL,recorded_at timestamp NOT NULL,expected_version_id uuid NOT NULL REFERENCES department_master.version(id)
);

ALTER TABLE department_master.version ADD CONSTRAINT department_version_identity UNIQUE(department_id,id);
ALTER TABLE department_master.evolution_relation ADD CONSTRAINT evolution_from_version_identity FOREIGN KEY(from_department_id,from_version_id) REFERENCES department_master.version(department_id,id);
ALTER TABLE department_master.evolution_relation ADD CONSTRAINT evolution_to_version_identity FOREIGN KEY(to_department_id,to_version_id) REFERENCES department_master.version(department_id,id);
ALTER TABLE department_master.replacement ADD CONSTRAINT replacement_version_identity FOREIGN KEY(department_id,expected_version_id) REFERENCES department_master.version(department_id,id);

-- Admission is checked at the actual database write as well as public Owner
-- preview. Historical reads and non-expanding END/RETRACT remain available.
CREATE FUNCTION department_master.guard_replaced_department() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid;boundary timestamp;m department_master.organization_identifier;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF TG_TABLE_NAME='version' THEN target:=NEW.department_id;
 ELSIF TG_TABLE_NAME='organization_mapping_version' THEN
  IF NEW.action='RETRACT' OR NEW.target_type<>'ORG' THEN RETURN NEW;END IF;target:=NEW.target_id;
 ELSE
  IF NEW.action IN ('END','RETRACT') THEN RETURN NEW;END IF;
  SELECT * INTO m FROM department_master.organization_identifier WHERE id=NEW.identifier_id;
  IF m.target_type<>'ORG' THEN RETURN NEW;END IF;target:=m.target_id;
 END IF;
 SELECT effective_at INTO boundary FROM department_master.replacement WHERE department_id=target;
 IF boundary IS NOT NULL AND (NEW.valid_to IS NULL OR NEW.valid_to>boundary) THEN RAISE EXCEPTION 'UNSUPPORTED_STATE_TRANSITION';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER replaced_department_admission BEFORE INSERT ON department_master.version FOR EACH ROW EXECUTE FUNCTION department_master.guard_replaced_department();
CREATE TRIGGER replaced_department_admission BEFORE INSERT ON department_master.organization_mapping_version FOR EACH ROW EXECUTE FUNCTION department_master.guard_replaced_department();
CREATE TRIGGER replaced_department_admission BEFORE INSERT ON department_master.organization_identifier_version FOR EACH ROW EXECUTE FUNCTION department_master.guard_replaced_department();
REVOKE ALL ON FUNCTION department_master.guard_replaced_department() FROM PUBLIC,hdi_prototype;

DO $patch$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_publish(text,uuid,text,jsonb)'::regprocedure);
 needle:='        WHERE v.id=(n->>''departmentVersionId'')::uuid AND v.department_id=(n->>''departmentId'')::uuid';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'EVOLUTION_HIERARCHY_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,needle||$guard$
          AND NOT EXISTS(SELECT 1 FROM department_master.replacement exit WHERE exit.department_id=v.department_id AND (p_valid_to IS NULL OR p_valid_to>exit.effective_at))
$guard$);
END $patch$;

CREATE FUNCTION department_master.evolution_authorize(p_actor text,p_campus text,p_permission text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;BEGIN
 IF p_campus IS NULL OR p_campus NOT IN ('NORTH','SOUTH') OR p_permission NOT IN ('READ','READ_RESTRICTED','WRITE','VERIFY','REVIEW') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');
 identity:=department_master.authorize(p_actor,CASE WHEN p_permission IN ('VERIFY','REVIEW') THEN 'HOSPITAL' ELSE p_campus END,p_permission);
 PERFORM department_master.authorize(p_actor,p_campus,'READ');RETURN identity;
END $$;
CREATE FUNCTION department_master.evolution_input_read(p_actor text,p_id uuid,p_permission text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r department_master.evolution_input;v department_master.evolution_verification;BEGIN
 SELECT * INTO r FROM department_master.evolution_input WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM department_master.evolution_authorize(p_actor,r.campus,p_permission);PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',r.source_system_id);
 IF p_permission='READ_RESTRICTED' THEN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'EVOLUTION_INPUT_READ','RESTRICTED_INPUT',r.digest);END IF;
 SELECT * INTO v FROM department_master.evolution_verification WHERE input_id=r.id ORDER BY number DESC LIMIT 1;
 RETURN to_jsonb(r)||jsonb_build_object('verification',CASE WHEN v.id IS NULL THEN NULL ELSE to_jsonb(v) END);
END $$;
CREATE FUNCTION department_master.evolution_source_authorize(p_actor text,p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',p_id);
END $$;
REVOKE ALL ON FUNCTION department_master.evolution_source_authorize(text,uuid) FROM PUBLIC,hdi_prototype;
CREATE FUNCTION department_master.evolution_job_read(p_actor text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;BEGIN
 r:=department_master.evolution_input_read(p_actor,p_id,'READ_RESTRICTED');
 RETURN governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r->>'job_id'));
END $$;
CREATE FUNCTION department_master.replacement_read(p_actor text,p_id uuid,p_record timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');
 RETURN (SELECT to_jsonb(r) FROM department_master.replacement r WHERE r.department_id=p_id AND (p_record IS NULL OR r.recorded_at<=p_record));
END $$;
CREATE FUNCTION department_master.evolution_snapshot(p_actor text,p_id uuid,p_campus text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e department_master.evolution_event;source uuid;material jsonb;BEGIN
 PERFORM department_master.evolution_authorize(p_actor,p_campus,'READ_RESTRICTED');
 SELECT * INTO e FROM department_master.evolution_event WHERE id=p_id AND campus=p_campus;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',e.source_system_id);
 FOR source IN SELECT DISTINCT (v.facts->>'sourceSystemId')::uuid FROM department_master.evolution_relation rel JOIN department_master.version v ON v.id IN (rel.from_version_id,rel.to_version_id) WHERE rel.event_id=e.id LOOP PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',source);END LOOP;
 FOR material IN SELECT value FROM jsonb_array_elements(e.facts->'materials') LOOP PERFORM governance_catalog.registration_evidence_access(p_actor,(material->>'id')::uuid,NULL,p_campus);END LOOP;
 RETURN to_jsonb(e)||jsonb_build_object('relations',coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('fromVersion',f.number::text,'toVersion',t.number::text,'toSourceRow',t.source_row) ORDER BY r.source_row,r.id) FROM department_master.evolution_relation r JOIN department_master.version f ON f.id=r.from_version_id JOIN department_master.version t ON t.id=r.to_version_id WHERE event_id=e.id),'[]'::jsonb));
END $$;

-- Historical outcomes require current access, not a still-live raw payload.
-- Re-observation before a new apply continues to authenticate actual bytes.
CREATE FUNCTION governance_catalog.registration_evidence_access(p_actor text,p_artifact uuid,p_source_version uuid,p_campus text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a governance_catalog.protected_artifact;j governance_catalog.import_job;c governance_catalog.import_contract_version;dataset uuid;source uuid;BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 SELECT * INTO a FROM governance_catalog.protected_artifact WHERE id=p_artifact;
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=a.job_id;SELECT * INTO c FROM governance_catalog.import_contract_version WHERE id=j.contract_version_id;
 SELECT object_id INTO dataset FROM governance_catalog.version WHERE id=c.dataset_version_id;
 IF a.id IS NULL OR a.kind NOT IN ('RAW_CELL','RAW_FILE') OR a.campus IS DISTINCT FROM p_campus OR a.purpose<>'IDENTITY_VERIFY' OR j.scope<>'SYNTHETIC' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF p_source_version IS NOT NULL AND c.definition->>'sourceVersionId' IS DISTINCT FROM p_source_version::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',c.id,'READ');
 SELECT object_id INTO source FROM governance_catalog.version WHERE id=(c.definition->>'sourceVersionId')::uuid;
 PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',source);
 IF NOT EXISTS(SELECT 1 FROM vnext_control.protected_grant WHERE actor_code=p_actor AND dataset_id=dataset AND campus=p_campus AND purpose='IDENTITY_VERIFY' AND permission='READ') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.registration_evidence_access(text,uuid,uuid,text) FROM PUBLIC,hdi_prototype;
CREATE FUNCTION department_master.evolution_list(p_actor text,p_campus text,p_after uuid,p_limit integer,p_record timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e department_master.evolution_event;result jsonb:='[]';BEGIN
 PERFORM department_master.evolution_authorize(p_actor,p_campus,'READ_RESTRICTED');IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR e IN SELECT * FROM department_master.evolution_event WHERE campus=p_campus AND (p_after IS NULL OR id>p_after) AND (p_record IS NULL OR recorded_at<=p_record) ORDER BY id LOOP
  BEGIN PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',e.source_system_id);
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='ACCESS_DENIED' THEN CONTINUE;ELSE RAISE;END IF;END;
  result:=result||jsonb_build_array(e.id);IF jsonb_array_length(result)>=p_limit THEN EXIT;END IF;
 END LOOP;RETURN result;
END $$;
CREATE FUNCTION department_master.evolution_history(p_actor text,p_id uuid,p_campus text,p_after uuid,p_limit integer,p_record timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e department_master.evolution_event;result jsonb:='[]';BEGIN
 PERFORM department_master.evolution_authorize(p_actor,p_campus,'READ_RESTRICTED');
 PERFORM department_master.snapshot(p_actor,p_id);IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR e IN SELECT * FROM department_master.evolution_event event WHERE campus=p_campus AND (p_after IS NULL OR id>p_after) AND (p_record IS NULL OR recorded_at<=p_record) AND EXISTS(SELECT 1 FROM department_master.evolution_relation rel WHERE rel.event_id=event.id AND p_id IN (rel.from_department_id,rel.to_department_id)) ORDER BY id LIMIT p_limit LOOP
  PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',e.source_system_id);result:=result||jsonb_build_array(e.id);
 END LOOP;RETURN result;
END $$;
REVOKE ALL ON FUNCTION department_master.evolution_history(text,uuid,text,uuid,integer,timestamp) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION department_master.evolution_mutate(p_ticket text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;
 actor text:=t->>'actor';op text:=t->>'operation';identity text;r department_master.evolution_input;v department_master.evolution_verification;
 j jsonb;c jsonb;approved_by text;approved_identity text;command jsonb:=t->'command';event jsonb:=command->'event';
 e department_master.evolution_event;prior department_master.version;next_id uuid;vid uuid;n bigint;latest_number bigint;at timestamp;knowledge timestamp;item jsonb;refs jsonb:='{}';from_refs jsonb:='{}';row_value jsonb;prepared jsonb;rel jsonb;rel_index integer:=0;
 BEGIN
 PERFORM pg_advisory_xact_lock(901002);SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.department_write_authority WHERE singleton;
 IF secret IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF op='STAGE' THEN
  identity:=department_master.evolution_authorize(actor,t->>'campus','WRITE');PERFORM department_master.evolution_authorize(actor,t->>'campus','READ_RESTRICTED');
  PERFORM vnext_control.require_source_access(actor,'SYNTHETIC',(t->>'sourceSystemId')::uuid);
  SELECT * INTO r FROM department_master.evolution_input WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF r.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);END IF;
  j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',t->>'jobId'));
  IF j->>'submitterIdentity' IS DISTINCT FROM identity OR j->>'currentRevisionId' IS DISTINCT FROM t->>'revisionId' OR j->'contract'->>'dataset'<>'ORG26' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
  INSERT INTO department_master.evolution_input(job_id,job_revision,maker,identity_code,request_id,digest,campus,source_system_id,envelope) VALUES((j->>'id')::uuid,(j->>'currentRevisionId')::uuid,actor,identity,(t->>'requestId')::uuid,t->>'digest',t->>'campus',(t->>'sourceSystemId')::uuid,t->'envelope') RETURNING * INTO r;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'EVOLUTION_INPUT','ORG_EVOLUTION_CORE',r.digest);
  RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);
 END IF;
 SELECT * INTO r FROM department_master.evolution_input WHERE id=(t->>'inputId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF op='VERIFY' THEN
  identity:=department_master.evolution_authorize(actor,r.campus,'VERIFY');IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
  SELECT * INTO v FROM department_master.evolution_verification WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF v.input_id<>r.id OR v.digest<>t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('verificationId',v.id);END IF;
  IF r.digest IS DISTINCT FROM t->>'inputDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  INSERT INTO department_master.evolution_verification(input_id,number,actor,identity_code,request_id,digest,envelope) VALUES(r.id,coalesce((SELECT max(number)+1 FROM department_master.evolution_verification WHERE input_id=r.id),1),actor,identity,(t->>'requestId')::uuid,t->>'digest',t->'envelope') RETURNING * INTO v;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'EVOLUTION_VERIFICATION','INDEPENDENT_MATERIAL_REVIEW',v.digest);RETURN jsonb_build_object('verificationId',v.id);
 END IF;
 IF op<>'APPLY' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 PERFORM department_master.evolution_input_read(actor,r.id,'WRITE');
 j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));IF r.job_revision::text IS DISTINCT FROM j->>'currentRevisionId' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 c:=governance_catalog.apply_record(actor,'READ_CANDIDATE',jsonb_build_object('candidateId',t->>'candidateId'));
 IF c->>'digest' IS DISTINCT FROM t->>'digest' OR c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR coalesce(c->>'approvedBy','')='' THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 approved_by:=c->>'approvedBy';PERFORM governance_catalog.apply_record(approved_by,'CHECK_APPROVAL',jsonb_build_object('candidateId',t->>'candidateId'));
 approved_identity:=department_master.evolution_authorize(approved_by,r.campus,'REVIEW');IF c->>'makerIdentity' IS DISTINCT FROM r.identity_code OR approved_identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
 PERFORM department_master.evolution_input_read(approved_by,r.id,'REVIEW');
 IF event->>'change_type' NOT IN ('RENAME','SPLIT','MERGE') THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 IF (event->>'change_type'='RENAME' AND (jsonb_array_length(command->'predecessors')<>1 OR jsonb_array_length(command->'relations')<>1 OR jsonb_array_length(command->'successors')<>0 OR jsonb_typeof(command->'rename')<>'object')) OR (event->>'change_type'='SPLIT' AND (jsonb_array_length(command->'predecessors')<>1 OR jsonb_array_length(command->'successors')<2 OR jsonb_array_length(command->'relations')<>jsonb_array_length(command->'successors') OR command->'rename'<>'null'::jsonb)) OR (event->>'change_type'='MERGE' AND (jsonb_array_length(command->'predecessors')<2 OR jsonb_array_length(command->'successors')<>1 OR jsonb_array_length(command->'relations')<>jsonb_array_length(command->'predecessors') OR command->'rename'<>'null'::jsonb)) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF 1+jsonb_array_length(command->'successors')*4+jsonb_array_length(command->'relations')+(CASE WHEN event->>'change_type'='RENAME' THEN 1 ELSE jsonb_array_length(command->'predecessors') END)>100 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;
 at:=governance_catalog.contract_time(event->>'effective_at');knowledge:=timezone('Asia/Shanghai',clock_timestamp());
 FOR item IN SELECT value FROM jsonb_array_elements(command->'predecessors') LOOP
  SELECT max(number) INTO latest_number FROM department_master.version WHERE department_id=(item->>'id')::uuid;
  IF latest_number IS NULL OR latest_number::text IS DISTINCT FROM item->>'expectedVersion' OR item->>'owner'<>'department-master' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  IF latest_number>=9223372036854775807 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  SELECT * INTO prior FROM department_master.version WHERE department_id=(item->>'id')::uuid AND tsrange(valid_from,valid_to,'[)')@>at ORDER BY number DESC LIMIT 1;
  IF prior.id IS NULL THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
  IF EXISTS(SELECT 1 FROM department_master.replacement WHERE department_id=prior.department_id) THEN RAISE EXCEPTION 'UNSUPPORTED_STATE_TRANSITION';END IF;
  IF EXISTS(SELECT 1 FROM department_master.version WHERE department_id=prior.department_id AND valid_from>at) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  from_refs:=from_refs||jsonb_build_object(prior.department_id::text,jsonb_build_object('id',prior.department_id,'versionId',prior.id,'version',prior.number));
 END LOOP;
 INSERT INTO department_master.evolution_event(input_id,change_type,effective_at,recorded_at,campus,source_system_id,source_client_key,source_row,facts,content_digest) VALUES(r.id,event->>'change_type',at,knowledge,r.campus,r.source_system_id,event->>'org_event_id',(command->'sourceRows'->>'event')::integer,t->'facts',t->>'contentDigest') RETURNING * INTO e;
 IF e.change_type='RENAME' THEN
  n:=latest_number+1;
  INSERT INTO department_master.version(department_id,number,valid_from,valid_to,recorded_at,evolution_event_id,source_row,facts,content_digest) VALUES(prior.department_id,n,at,prior.valid_to,knowledge,e.id,(command->'sourceRows'->>'event')::integer,prior.facts||jsonb_build_object('name',command->'rename'->>'name','shortName',nullif(command->'rename'->>'shortName',''),'sourceRecordedAt',event->>'recorded_at','commandDigest',t->>'contentDigest'),t->>'contentDigest') RETURNING id INTO vid;
  refs:=jsonb_build_object(prior.department_id::text,jsonb_build_object('id',prior.department_id,'versionId',vid));
 ELSE
  i:=0;
  FOR item IN SELECT value FROM jsonb_array_elements(command->'successors') LOOP
   row_value:=item->'row';i:=i+1;
   IF item->>'intent'<>'CREATE' OR item->'target'<>'null'::jsonb OR row_value->>'record_status'<>'ACTIVE' OR governance_catalog.contract_time(row_value->>'valid_from')<>at OR coalesce(row_value->>'abolished_on','')<>'' OR row_value->>'org_id'=ANY(ARRAY(SELECT jsonb_object_keys(from_refs))) OR refs ? (row_value->>'org_id') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
   SELECT value INTO prepared FROM jsonb_array_elements(t->'facts'->'successorFacts') WHERE value->>'alias'=row_value->>'org_id';IF prepared IS NULL THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
   IF department_master.code_conflict(actor,row_value->>'org_code',NULL) THEN RAISE EXCEPTION 'IDENTIFIER_CONFLICT';END IF;
   INSERT INTO department_master.department(code) VALUES(row_value->>'org_code') RETURNING id INTO next_id;
   INSERT INTO department_master.version(department_id,number,valid_from,valid_to,recorded_at,evolution_event_id,source_row,facts,content_digest) VALUES(next_id,1,at,CASE WHEN row_value->>'valid_to'='' THEN NULL ELSE governance_catalog.contract_time(row_value->>'valid_to') END,knowledge,e.id,(command->'sourceRows'->'successors'->>(i-1))::integer,prepared->'facts',prepared->>'contentDigest') RETURNING id INTO vid;
   refs:=refs||jsonb_build_object(row_value->>'org_id',jsonb_build_object('id',next_id,'versionId',vid));
  END LOOP;
 END IF;
 FOR rel IN SELECT value FROM jsonb_array_elements(command->'relations') LOOP
  IF rel->>'org_event_id' IS DISTINCT FROM event->>'org_event_id' OR rel->>'from_target_type'<>'ORG' OR rel->>'to_target_type'<>'ORG' OR NOT from_refs ? (rel->>'from_target_id') OR NOT refs ? (rel->>'to_target_id') OR (e.change_type='SPLIT' AND length(btrim(rel->>'context_rule'))=0) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  INSERT INTO department_master.evolution_relation(event_id,source_client_key,source_to_alias,relation_kind,from_department_id,from_version_id,to_department_id,to_version_id,transfer_scope,context_rule,source_row,source_recorded_at,recorded_at) VALUES(e.id,rel->>'succession_id',rel->>'to_target_id',CASE WHEN e.change_type='RENAME' THEN 'SAME_ID_VERSION' ELSE 'SUCCESSION' END,(from_refs->(rel->>'from_target_id')->>'id')::uuid,(from_refs->(rel->>'from_target_id')->>'versionId')::uuid,(refs->(rel->>'to_target_id')->>'id')::uuid,(refs->(rel->>'to_target_id')->>'versionId')::uuid,rel->>'transfer_scope',rel->>'context_rule',(command->'sourceRows'->'relations'->>rel_index)::integer,governance_catalog.contract_time(rel->>'recorded_at'),knowledge);
  rel_index:=rel_index+1;
 END LOOP;
 IF e.change_type<>'RENAME' THEN
  FOR item IN SELECT value FROM jsonb_each(from_refs) LOOP INSERT INTO department_master.replacement(department_id,event_id,effective_at,recorded_at,expected_version_id) VALUES((item->>'id')::uuid,e.id,at,knowledge,(item->>'versionId')::uuid);END LOOP;
 END IF;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,e.id,'EVOLUTION_APPLY','EXPLICIT_APPROVED_EVENT',t->>'contentDigest');
 RETURN jsonb_build_object('owner','department-master/organization-evolution','id',e.id,'version','1','source',jsonb_build_object('dataset','ORG26','row',(command->'sourceRows'->>'event')::integer,'step','EVOLUTION'));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'IDENTIFIER_CONFLICT';
END $$;

-- Deferred validation sees the complete event, including every successor,
-- edge and exit. A constraint failure also rolls back the root outcome.
CREATE FUNCTION department_master.check_evolution_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE relations integer;origins integer;destinations integer;exits integer;BEGIN
 SELECT count(*),count(DISTINCT from_department_id),count(DISTINCT to_department_id) INTO relations,origins,destinations FROM department_master.evolution_relation WHERE event_id=NEW.id;
 SELECT count(*) INTO exits FROM department_master.replacement WHERE event_id=NEW.id;
 IF NEW.change_type='RENAME' THEN
  IF relations<>1 OR origins<>1 OR destinations<>1 OR exits<>0 OR EXISTS(SELECT 1 FROM department_master.evolution_relation WHERE event_id=NEW.id AND relation_kind<>'SAME_ID_VERSION') THEN RAISE EXCEPTION 'SUCCESSION_SHAPE';END IF;
 ELSE
  IF (NEW.change_type='SPLIT' AND (origins<>1 OR destinations<2 OR relations<>destinations)) OR (NEW.change_type='MERGE' AND (origins<2 OR destinations<>1 OR relations<>origins)) OR exits<>origins OR EXISTS(SELECT 1 FROM department_master.evolution_relation WHERE event_id=NEW.id AND relation_kind<>'SUCCESSION') THEN RAISE EXCEPTION 'SUCCESSION_SHAPE';END IF;
  IF EXISTS(SELECT 1 FROM department_master.evolution_relation rel JOIN department_master.version v ON v.id=rel.to_version_id WHERE rel.event_id=NEW.id AND (v.number<>1 OR v.evolution_event_id IS DISTINCT FROM NEW.id OR v.valid_from<>NEW.effective_at)) THEN RAISE EXCEPTION 'SUCCESSION_SHAPE';END IF;
  IF EXISTS(WITH RECURSIVE reach(origin,target) AS (SELECT from_department_id,to_department_id FROM department_master.evolution_relation WHERE event_id=NEW.id AND relation_kind='SUCCESSION' UNION SELECT reach.origin,rel.to_department_id FROM reach JOIN department_master.evolution_relation rel ON rel.from_department_id=reach.target AND rel.relation_kind='SUCCESSION') SELECT 1 FROM reach WHERE origin=target) THEN RAISE EXCEPTION 'SUCCESSION_CYCLE';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM department_master.evolution_relation WHERE event_id=NEW.id AND recorded_at<>NEW.recorded_at) OR EXISTS(SELECT 1 FROM department_master.version WHERE evolution_event_id=NEW.id AND recorded_at<>NEW.recorded_at) OR EXISTS(SELECT 1 FROM department_master.replacement WHERE event_id=NEW.id AND (recorded_at<>NEW.recorded_at OR effective_at<>NEW.effective_at)) THEN RAISE EXCEPTION 'SUCCESSION_SHAPE';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER evolution_complete AFTER INSERT ON department_master.evolution_event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION department_master.check_evolution_complete();
REVOKE ALL ON FUNCTION department_master.check_evolution_complete() FROM PUBLIC,hdi_prototype;

DO $$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['evolution_input','evolution_verification','evolution_event','evolution_relation','replacement'] LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON department_master.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',name);
  EXECUTE format('ALTER TABLE department_master.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON department_master.%I FROM PUBLIC,hdi_prototype',name);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION department_master.evolution_authorize(text,text,text),department_master.evolution_input_read(text,uuid,text),department_master.evolution_job_read(text,uuid),department_master.replacement_read(text,uuid,timestamp),department_master.evolution_snapshot(text,uuid,text),department_master.evolution_list(text,text,uuid,integer,timestamp),department_master.evolution_mutate(text,text) FROM PUBLIC,hdi_prototype;

DO $contract$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('governance_catalog.validation_rules_valid(jsonb,uuid)'::regprocedure);
 needle:=' FOR rule IN SELECT value FROM jsonb_array_elements(definition->''rules'') LOOP';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'EVOLUTION_RULE_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,needle||$rules$
  IF rule->>'status'='MACHINE' AND rule->>'version'='P0_05_SOURCE_V1' AND ((code='ORG26' AND definition->>'templateVersion'='ORG_EVOLUTION_CORE_V1' AND rule->>'id'='SRC-COND-026') OR (code='ORG27' AND definition->>'templateVersion'='ORG_SUCCESSION_CORE_V1' AND rule->>'id' IN ('SRC-COND-027','SRC-COND-028','SRC-COND-029','SRC-COND-030','SRC-COND-031'))) AND EXISTS(SELECT 1 FROM jsonb_array_elements(source->'rules') original WHERE original->>'id'=rule->>'id' AND original->>'field'=rule->>'field' AND original->>'text'=rule->>'text') THEN CONTINUE;END IF;
$rules$);
 body:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 needle:='''ORGANIZATION_IDENTIFIER_CORE'')';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'EVOLUTION_REFERENCE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'''ORGANIZATION_IDENTIFIER_CORE'',''ORGANIZATION_EVOLUTION_CORE'')');
 needle:='  IF entry->>''status''=''DECLARED_PARAMETER'' THEN';
 body:=replace(body,needle,$guard$
  IF entry->>'status'='ORGANIZATION_EVOLUTION_CORE' AND (p_profile<>'CORE' OR NOT EXISTS(SELECT 1 FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_dataset_version AND o.scope='SYNTHETIC' AND ((o.code='ORG26' AND p_definition->>'templateVersion'='ORG_EVOLUTION_CORE_V1') OR (o.code='ORG27' AND p_definition->>'templateVersion'='ORG_SUCCESSION_CORE_V1')))) THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
$guard$||needle);
 EXECUTE body;
END $contract$;

-- The three-sheet policy is finite and is executable only through its Owner.
DO $parser$ DECLARE body text;signature text;needle text;BEGIN
 FOREACH signature IN ARRAY ARRAY['governance_catalog.import_job_command(text,jsonb)','governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)','governance_catalog.read_validation(text,uuid)'] LOOP
  body:=pg_get_functiondef(signature::regprocedure);
  needle:='''STRICT_ORGANIZATION_IDENTIFIER_V1'')';
  IF position(needle IN body)=0 THEN RAISE EXCEPTION 'EVOLUTION_PARSER_BASELINE_MISMATCH';END IF;
  body:=replace(body,needle,'''STRICT_ORGANIZATION_IDENTIFIER_V1'',''STRICT_ORGANIZATION_EVOLUTION_V1'')');
  IF signature LIKE '%accept_validation%' THEN
   needle:='OR (p.policy=''STRICT_ORGANIZATION_IDENTIFIER_V1'' AND EXISTS(SELECT 1 FROM department_master.identifier_input WHERE job_revision=p.revision_id))';
   IF position(needle IN body)=0 THEN RAISE EXCEPTION 'EVOLUTION_VALIDATION_BASELINE_MISMATCH';END IF;
   body:=replace(body,needle,needle||' OR (p.policy=''STRICT_ORGANIZATION_EVOLUTION_V1'' AND EXISTS(SELECT 1 FROM department_master.evolution_input WHERE job_revision=p.revision_id))');
  END IF;EXECUTE body;
 END LOOP;
END $parser$;
ALTER TABLE governance_catalog.import_input_revision DROP CONSTRAINT import_input_revision_metadata_shape_check;
ALTER TABLE governance_catalog.import_input_revision ADD CONSTRAINT import_input_revision_metadata_shape_check CHECK(
 ((metadata->>'kind'='FILE' AND metadata->>'format' IN ('CSV','JSON','XLSX') AND metadata->>'parserPolicy' IN ('STRICT_V1','STRICT_V2','STRICT_DEPARTMENT_V1','STRICT_ORGANIZATION_MAPPING_V1','STRICT_ORGANIZATION_IDENTIFIER_V1') AND metadata-ARRAY['kind','format','parserPolicy']='{}'::jsonb)
 OR (metadata->>'kind'='FILE' AND metadata->>'format'='XLSX' AND metadata->>'parserPolicy'='STRICT_ORGANIZATION_EVOLUTION_V1' AND metadata-ARRAY['kind','format','parserPolicy']='{}'::jsonb)
 OR (metadata->>'kind'='FILE' AND metadata->>'format'='XLSX' AND metadata->>'parserPolicy'='STRICT_ORG_BUNDLE_V1' AND metadata->>'manifestDigest' ~ '^[a-f0-9]{64}$' AND metadata->>'contractsDigest' ~ '^[a-f0-9]{64}$' AND metadata-ARRAY['kind','format','parserPolicy','manifestDigest','contractsDigest']='{}'::jsonb)
 OR (metadata->>'kind'='METADATA_ONLY' AND metadata->>'declaredSha256' ~ '^[a-f0-9]{64}$' AND metadata-ARRAY['kind','declaredSha256']='{}'::jsonb)) IS TRUE);
ALTER TABLE governance_catalog.parse_provenance DROP CONSTRAINT parse_provenance_policy_check;
ALTER TABLE governance_catalog.parse_provenance ADD CONSTRAINT parse_provenance_policy_check CHECK(policy IN ('STRICT_V1','STRICT_V2','STRICT_ORG_BUNDLE_V1','STRICT_DEPARTMENT_V1','STRICT_ORGANIZATION_MAPPING_V1','STRICT_ORGANIZATION_IDENTIFIER_V1','STRICT_ORGANIZATION_EVOLUTION_V1'));
