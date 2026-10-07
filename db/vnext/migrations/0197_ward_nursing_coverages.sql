SELECT pg_advisory_xact_lock(901002);
CREATE TABLE vnext_control.ward_nursing_write_authority(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),key_hex text NOT NULL CHECK(key_hex ~ '^[a-f0-9]{64}$'));
CREATE TABLE care_organization.ward_nursing_access(actor text NOT NULL REFERENCES vnext_control.actor(code),campus_id uuid NOT NULL REFERENCES organization_master.campus(id),scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')),permission text NOT NULL CHECK(permission IN ('READ','WRITE','REVIEW','VERIFY','READ_RESTRICTED')),PRIMARY KEY(actor,campus_id,scope,permission));
CREATE TABLE care_organization.ward_nursing_input(id uuid PRIMARY KEY DEFAULT uuidv7(),revision uuid NOT NULL DEFAULT uuidv7(),job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),job_revision uuid NOT NULL REFERENCES governance_catalog.import_input_revision(id),maker text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),campus_ids uuid[] NOT NULL CHECK(cardinality(campus_ids)>0),scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')),envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(job_id,job_revision));
CREATE TABLE care_organization.ward_nursing_verification(id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL REFERENCES care_organization.ward_nursing_input(id),number bigint NOT NULL CHECK(number>0),actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL,envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(input_id,number));
CREATE TABLE care_organization.ward_nursing(id uuid PRIMARY KEY DEFAULT uuidv7(),nursing_unit_id uuid NOT NULL REFERENCES care_organization.nursing_unit(id),campus_id uuid NOT NULL REFERENCES organization_master.campus(id),ward_id uuid NOT NULL REFERENCES care_organization.ward_unit(id),scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')),applicability jsonb NOT NULL,source_system_id uuid NOT NULL REFERENCES governance_catalog.object(id),source_alias text NOT NULL CHECK(length(source_alias) BETWEEN 1 AND 64),UNIQUE(source_system_id,source_alias));
CREATE INDEX ward_nursing_unit_scope ON care_organization.ward_nursing(nursing_unit_id,campus_id,ward_id);
CREATE TABLE care_organization.ward_nursing_change(id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL UNIQUE REFERENCES care_organization.ward_nursing_input(id),candidate_id uuid NOT NULL UNIQUE REFERENCES governance_catalog.apply_candidate(id),digest text NOT NULL,results jsonb NOT NULL,recorded_at timestamp NOT NULL);
CREATE TABLE care_organization.ward_nursing_apply_binding(candidate_id uuid PRIMARY KEY REFERENCES governance_catalog.apply_candidate(id),input_id uuid NOT NULL REFERENCES care_organization.ward_nursing_input(id),candidate_digest text NOT NULL,writes_digest text NOT NULL,writes_hash text NOT NULL,verification_id uuid NOT NULL,verification_number bigint NOT NULL,verification_digest text NOT NULL);
CREATE TABLE care_organization.ward_nursing_version(id uuid PRIMARY KEY DEFAULT uuidv7(),ward_nursing_id uuid NOT NULL REFERENCES care_organization.ward_nursing(id),number bigint NOT NULL CHECK(number>0),action text NOT NULL CHECK(action IN ('CREATE','REVISE','END')),valid_from timestamp NOT NULL,valid_to timestamp,facts jsonb NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),change_id uuid NOT NULL REFERENCES care_organization.ward_nursing_change(id) DEFERRABLE INITIALLY DEFERRED,recorded_at timestamp NOT NULL,UNIQUE(ward_nursing_id,number),CHECK(valid_to IS NULL OR valid_to>valid_from),CHECK(action IN ('CREATE','REVISE') OR valid_to IS NULL));
CREATE TABLE care_organization.ward_nursing_withdrawal(input_id uuid PRIMARY KEY REFERENCES care_organization.ward_nursing_input(id),actor text NOT NULL REFERENCES vnext_control.actor(code),request_id uuid NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()));

CREATE OR REPLACE FUNCTION care_organization.ward_nursing_authorize(p_actor text, p_campus uuid, p_permission text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE identity text;c jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF p_permission NOT IN ('READ','WRITE','REVIEW','VERIFY','READ_RESTRICTED') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF p_permission IN ('WRITE','VERIFY','REVIEW') AND NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=p_actor AND active AND principal_kind='HUMAN') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC',CASE WHEN p_permission IN ('REVIEW','VERIFY') THEN 'REVIEW' WHEN p_permission='WRITE' THEN 'WRITE' ELSE 'READ' END);
 c:=organization_master.campus_snapshot(p_actor,p_campus);
 IF NOT EXISTS(SELECT 1 FROM care_organization.ward_nursing_access WHERE actor=p_actor AND campus_id=p_campus AND scope=c->>'scope' AND permission=p_permission) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;RETURN identity;
END $function$
;
CREATE OR REPLACE FUNCTION care_organization.ward_nursing_input_read(p_actor text, p_id uuid, p_permission text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE r care_organization.ward_nursing_input;v care_organization.ward_nursing_verification;campus uuid;BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');SELECT * INTO r FROM care_organization.ward_nursing_input WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 FOREACH campus IN ARRAY r.campus_ids LOOP PERFORM care_organization.ward_nursing_authorize(p_actor,campus,p_permission);PERFORM care_organization.ward_nursing_authorize(p_actor,campus,'READ');END LOOP;
 PERFORM governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));
 IF p_permission='READ_RESTRICTED' THEN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'WARD_NURSING_READ_RESTRICTED','ORG11_SOURCE',r.digest);END IF;
 SELECT * INTO v FROM care_organization.ward_nursing_verification WHERE input_id=r.id ORDER BY number DESC LIMIT 1;
 RETURN to_jsonb(r)||jsonb_build_object('withdrawn',EXISTS(SELECT 1 FROM care_organization.ward_nursing_withdrawal WHERE input_id=r.id))||jsonb_build_object('verification',CASE WHEN v.id IS NULL THEN NULL ELSE to_jsonb(v) END);
END $function$
;
CREATE OR REPLACE FUNCTION care_organization.ward_nursing_job_read(p_actor text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE r jsonb;BEGIN r:=care_organization.ward_nursing_input_read(p_actor,p_id,'READ_RESTRICTED');RETURN governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r->>'job_id'));END $function$
;
CREATE OR REPLACE FUNCTION care_organization.ward_nursing_closed(p_value jsonb, p_keys text[])
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR p_value-p_keys<>'{}'::jsonb OR NOT p_value ?& p_keys THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;END $function$
;
CREATE OR REPLACE FUNCTION care_organization.ward_nursing_local_time(p_value text)
 RETURNS timestamp without time zone
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE result timestamp;BEGIN IF p_value IS NULL OR p_value !~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?$' THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED';END IF;BEGIN result:=p_value::timestamp;EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED';END;RETURN result;END $function$
;
CREATE OR REPLACE FUNCTION care_organization.ward_nursing_audit_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(coalesce(NEW.actor,OLD.actor),coalesce(NEW.campus_id,OLD.campus_id),'WARD_NURSING_AUTHORIZATION',TG_OP,encode(sha256(convert_to(coalesce(to_jsonb(NEW),to_jsonb(OLD))::text,'UTF8')),'hex'));RETURN coalesce(NEW,OLD);END $function$
;
CREATE OR REPLACE FUNCTION care_organization.ward_nursing_withdraw(p_ticket text, p_signature text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE t jsonb:=p_ticket::jsonb;k bytea;i integer;ip bytea:=decode(repeat('36',64),'hex');op bytea:=decode(repeat('5c',64),'hex');r care_organization.ward_nursing_input;prior care_organization.ward_nursing_withdrawal;BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM care_organization.ward_nursing_closed(t,ARRAY['actor','transaction','inputId','requestId']);SELECT decode(key_hex,'hex') INTO k FROM vnext_control.ward_nursing_write_authority;
 IF k IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;FOR i IN 0..31 LOOP ip:=set_byte(ip,i,get_byte(ip,i)#get_byte(k,i));op:=set_byte(op,i,get_byte(op,i)#get_byte(k,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(op||sha256(ip||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 r:=jsonb_populate_record(NULL::care_organization.ward_nursing_input,care_organization.ward_nursing_input_read(t->>'actor',(t->>'inputId')::uuid,'WRITE'));
 IF r.identity_code IS DISTINCT FROM vnext_control.authorize(t->>'actor','SYNTHETIC','WRITE') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF EXISTS(SELECT 1 FROM care_organization.ward_nursing_change WHERE input_id=r.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
 SELECT * INTO prior FROM care_organization.ward_nursing_withdrawal WHERE input_id=r.id;IF FOUND THEN IF prior.request_id::text IS DISTINCT FROM t->>'requestId' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;ELSE
 INSERT INTO care_organization.ward_nursing_withdrawal(input_id,actor,request_id) VALUES(r.id,t->>'actor',(t->>'requestId')::uuid);INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(t->>'actor',r.id,'WARD_NURSING_WITHDRAW','EXPLICIT_WITHDRAWAL',r.digest);END IF;
 RETURN jsonb_build_object('inputId',r.id,'status','WITHDRAWN');
END $function$
;
CREATE FUNCTION care_organization.ward_nursing_owner_ready(p_proof text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM vnext_control.ward_nursing_write_authority WHERE encode(sha256(decode(key_hex,'hex')),'hex')=p_proof)
$$;
CREATE FUNCTION care_organization.ward_nursing_record_time() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE point text;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.ward_nursing_write_authority WHERE singleton;
 IF secret IS NULL THEN RAISE EXCEPTION 'WARD_NURSING_OWNER_NOT_PROVISIONED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 point:=to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US');
 RETURN jsonb_build_object('recordAt',point,'recordAtProof',encode(sha256(opad||sha256(ipad||convert_to('WARD_NURSING_TRANSACTION_R_V1|'||pg_current_xact_id()::text||'|'||point,'UTF8'))),'hex'));
END $$;
CREATE FUNCTION care_organization.ward_nursing_snapshot_at(p_actor text,p_id uuid,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u care_organization.ward_nursing;BEGIN
 PERFORM pg_advisory_xact_lock(901002);SELECT * INTO u FROM care_organization.ward_nursing WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM care_organization.ward_nursing_authorize(p_actor,u.campus_id,'READ');PERFORM care_organization.nursing_snapshot(p_actor,u.nursing_unit_id);PERFORM care_organization.ward_snapshot(p_actor,u.ward_id);
 RETURN jsonb_build_object('id',u.id,'scope',u.scope,'applicability',u.applicability,'versions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'number',v.number::text,'action',v.action,'validFrom',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordedAt',to_char(v.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'facts',v.facts,'reason',v.reason,'changeId',v.change_id) ORDER BY v.number) FROM care_organization.ward_nursing_version v WHERE v.ward_nursing_id=u.id AND v.recorded_at<=p_asof),'[]'));
END $$;
CREATE FUNCTION care_organization.ward_nursing_snapshot(p_actor text,p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT care_organization.ward_nursing_snapshot_at(p_actor,p_id,timezone('Asia/Shanghai',clock_timestamp()))$$;
CREATE FUNCTION care_organization.ward_nursing_snapshot_version(p_actor text,p_id uuid,p_version text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r timestamp;BEGIN SELECT recorded_at INTO r FROM care_organization.ward_nursing_version WHERE ward_nursing_id=p_id AND number::text=p_version;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;RETURN care_organization.ward_nursing_snapshot_at(p_actor,p_id,r);END $$;
CREATE FUNCTION care_organization.ward_nursing_list_at(p_actor text,p_scope text,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u record;result jsonb:='[]';BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');IF p_scope NOT IN ('NORTH','SOUTH') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR u IN SELECT c.* FROM care_organization.ward_nursing c WHERE c.scope=p_scope AND EXISTS(SELECT 1 FROM care_organization.ward_nursing_version v WHERE v.ward_nursing_id=c.id AND v.recorded_at<=p_asof) ORDER BY c.id LOOP
  IF EXISTS(SELECT 1 FROM care_organization.ward_nursing_access WHERE actor=p_actor AND campus_id=u.campus_id AND scope=p_scope AND permission='READ') THEN result:=result||jsonb_build_array(care_organization.ward_nursing_snapshot_at(p_actor,u.id,p_asof));END IF;
 END LOOP;RETURN result;
END $$;
CREATE FUNCTION care_organization.ward_nursing_list(p_actor text,p_scope text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT care_organization.ward_nursing_list_at(p_actor,p_scope,timezone('Asia/Shanghai',clock_timestamp()))$$;
CREATE FUNCTION care_organization.ward_nursing_source_conflict(p_actor text,p_source uuid,p_alias text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');RETURN EXISTS(SELECT 1 FROM care_organization.ward_nursing WHERE source_system_id=p_source AND source_alias=p_alias);END $$;
CREATE FUNCTION care_organization.ward_nursing_reserved(p_id uuid,p_r timestamp) RETURNS tsrange LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v care_organization.ward_nursing_version;ending timestamp;BEGIN SELECT * INTO v FROM care_organization.ward_nursing_version WHERE ward_nursing_id=p_id AND action IN ('CREATE','REVISE') AND recorded_at<=p_r ORDER BY number DESC LIMIT 1;IF NOT FOUND THEN RETURN 'empty'::tsrange;END IF;SELECT min(valid_from) INTO ending FROM care_organization.ward_nursing_version WHERE ward_nursing_id=p_id AND action='END' AND recorded_at<=p_r;ending:=least(ending,v.valid_to);IF ending IS NOT NULL AND ending<=v.valid_from THEN RETURN 'empty'::tsrange;END IF;RETURN tsrange(v.valid_from,ending,'[)');END $$;
CREATE FUNCTION care_organization.ward_nursing_state(p_id uuid,p_b timestamp,p_r timestamp) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN IF EXISTS(SELECT 1 FROM care_organization.ward_nursing_version WHERE ward_nursing_id=p_id AND action='END' AND recorded_at<=p_r AND valid_from<=p_b) THEN RETURN 'ENDED';END IF;
 RETURN CASE WHEN care_organization.ward_nursing_reserved(p_id,p_r) @> p_b THEN 'ACTIVE' ELSE 'NOT_EFFECTIVE' END;END $$;
CREATE FUNCTION care_organization.ward_nursing_scope_histories(p_actor text,p_scope jsonb,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c record;result jsonb:='[]';BEGIN PERFORM care_organization.ward_nursing_authorize(p_actor,(p_scope->'campus'->>'id')::uuid,'READ');
 FOR c IN SELECT id FROM care_organization.ward_nursing WHERE ward_id=(p_scope->'ward'->>'id')::uuid AND campus_id=(p_scope->'campus'->>'id')::uuid ORDER BY id LOOP result:=result||jsonb_build_array(care_organization.ward_nursing_snapshot_at(p_actor,c.id,p_r));END LOOP;RETURN result;END $$;
CREATE FUNCTION governance_catalog.ward_nursing_source_coverage(p_actor text,p_source uuid,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pin uuid;r timestamp:=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));BEGIN
 IF p_from IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 SELECT s.version_id INTO pin FROM governance_catalog.definition_spans(p_source,r) s WHERE governance_catalog.source_valid_spans(s.version_id,r) @> tsrange(p_from,p_to,'[)');
 IF pin IS NULL THEN PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',p_source);RAISE EXCEPTION 'WARD_NURSING_SOURCE_NOT_ADMITTED';END IF;
 PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',p_source,pin);
 RETURN jsonb_build_object('sourceId',p_source,'versionId',pin,'covered',true);
END $$;
CREATE FUNCTION governance_catalog.ward_nursing_source_reference(p_actor text,p_source uuid,p_version uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',p_source,p_version);
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_version AND o.id=p_source AND o.kind='SOURCE' AND o.scope='SYNTHETIC') THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
END $$;
CREATE TABLE care_organization.ward_nursing_scope_set(id uuid PRIMARY KEY DEFAULT uuidv7(),ward_id uuid NOT NULL UNIQUE REFERENCES care_organization.ward_unit(id),campus_id uuid NOT NULL REFERENCES organization_master.campus(id),scope text NOT NULL,source_alias text NOT NULL,partitions jsonb NOT NULL CHECK(jsonb_array_length(partitions) BETWEEN 2 AND 100),valid_from timestamp NOT NULL,valid_to timestamp,recorded_at timestamp NOT NULL,verification_basis jsonb NOT NULL,change_id uuid NOT NULL REFERENCES care_organization.ward_nursing_change(id) DEFERRABLE INITIALLY DEFERRED,CHECK(valid_to IS NULL OR valid_to>valid_from));
CREATE FUNCTION care_organization.ward_nursing_scope_set_read(p_actor text,p_id uuid,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d care_organization.ward_nursing_scope_set;BEGIN SELECT * INTO d FROM care_organization.ward_nursing_scope_set WHERE id=p_id AND recorded_at<=p_r;IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_COVERAGE_SCOPE';END IF;PERFORM care_organization.ward_nursing_authorize(p_actor,d.campus_id,'READ');PERFORM care_organization.ward_snapshot(p_actor,d.ward_id);RETURN jsonb_build_object('id',d.id,'version','1','scope',d.scope,'applicability',jsonb_build_object('ward',jsonb_build_object('owner','care-organization/ward','id',d.ward_id),'campus',jsonb_build_object('owner','organization-master/campus','id',d.campus_id),'purpose','NURSING_COVERAGE'),'partitions',d.partitions,'validFrom',to_char(d.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(d.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordedAt',to_char(d.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'sourceAlias',d.source_alias,'verificationBasis',d.verification_basis,'changeId',d.change_id);END $$;
CREATE FUNCTION care_organization.ward_nursing_scope_validate(p_actor text,p_a jsonb,p_scope jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d jsonb;part text;BEGIN
 IF p_scope->>'kind'='WHOLE_WARD' THEN PERFORM care_organization.ward_nursing_closed(p_scope,ARRAY['kind']);RETURN p_scope;END IF;
 PERFORM care_organization.ward_nursing_closed(p_scope,ARRAY['kind','scopeSetId','version','partitionIds']);IF p_scope->>'kind'<>'PARTITIONS' OR p_scope->>'version'<>'1' OR jsonb_typeof(p_scope->'partitionIds')<>'array' OR jsonb_array_length(p_scope->'partitionIds') NOT BETWEEN 1 AND 100 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_scope->'partitionIds'))<>jsonb_array_length(p_scope->'partitionIds') THEN RAISE EXCEPTION 'UNKNOWN_COVERAGE_SCOPE';END IF;
 d:=care_organization.ward_nursing_scope_set_read(p_actor,(p_scope->>'scopeSetId')::uuid,p_r);
 IF d->'applicability'->'ward' IS DISTINCT FROM p_a->'ward' OR d->'applicability'->'campus' IS DISTINCT FROM p_a->'campus' OR NOT tsrange((d->>'validFrom')::timestamp,(d->>'validTo')::timestamp,'[)') @> tsrange(p_from,p_to,'[)') THEN RAISE EXCEPTION 'SCOPE_BASIS_MISMATCH';END IF;
 FOR part IN SELECT value FROM jsonb_array_elements_text(p_scope->'partitionIds') LOOP IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'partitions') q WHERE q->>'id'=part) THEN RAISE EXCEPTION 'UNKNOWN_COVERAGE_SCOPE';END IF;END LOOP;RETURN d;
END $$;
CREATE FUNCTION care_organization.ward_nursing_scope_contains(a jsonb,b jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN IF a->>'kind'='WHOLE_WARD' THEN RETURN true;END IF;IF b->>'kind'='WHOLE_WARD' THEN RETURN false;END IF;IF a->>'scopeSetId' IS DISTINCT FROM b->>'scopeSetId' OR a->>'version' IS DISTINCT FROM b->>'version' THEN RAISE EXCEPTION 'SCOPE_BASIS_MISMATCH';END IF;RETURN (a->'partitionIds') @> (b->'partitionIds');END $$;
CREATE FUNCTION care_organization.ward_nursing_scope_intersects(a jsonb,b jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN IF a->>'kind'='WHOLE_WARD' OR b->>'kind'='WHOLE_WARD' THEN RETURN true;END IF;IF a->>'scopeSetId' IS DISTINCT FROM b->>'scopeSetId' OR a->>'version' IS DISTINCT FROM b->>'version' THEN RAISE EXCEPTION 'SCOPE_BASIS_MISMATCH';END IF;RETURN EXISTS(SELECT 1 FROM jsonb_array_elements_text(a->'partitionIds') q WHERE b->'partitionIds' ? q.value);END $$;
-- A finite same-Owner reader: one requested B window and one caller-pinned R.
CREATE FUNCTION care_organization.ward_nursing_master_window(p_actor text,p_kind text,p_id uuid,p_campus uuid,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h jsonb;property jsonb;later jsonb;b jsonb;v jsonb;spans tsmultirange;span tsrange;piece tsrange;complete tsmultirange:='{}';parts jsonb:='[]';basis jsonb;source jsonb;begin_at text;end_at text;operating jsonb;unit_piece jsonb;BEGIN
 IF p_from IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 IF p_kind='WARD' THEN h:=care_organization.ward_snapshot_at(p_actor,p_id,p_r);IF h->>'campusId' IS DISTINCT FROM p_campus::text THEN RAISE EXCEPTION 'CROSS_CAMPUS_POLICY_REQUIRED';END IF;
 ELSIF p_kind='NURSING' THEN h:=care_organization.nursing_snapshot_at(p_actor,p_id,p_r);ELSE RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 FOR property IN SELECT value FROM jsonb_array_elements(h->'versions') WHERE value->>'action' IN ('CREATE','REVISE') LOOP
  spans:=tsmultirange(tsrange((property->>'validFrom')::timestamp,(property->>'validTo')::timestamp,'[)'));
  FOR later IN SELECT value FROM jsonb_array_elements(h->'versions') WHERE value->>'action'<>'REBIND' AND (value->>'number')::bigint>(property->>'number')::bigint LOOP spans:=spans-tsmultirange(tsrange((later->>'validFrom')::timestamp,NULL,'[)'));END LOOP;
  FOR b IN SELECT value FROM jsonb_array_elements(h->'bindings') LOOP
   v:=b->'versions'->(jsonb_array_length(b->'versions')-1);
   FOR span IN SELECT unnest(spans) LOOP
    piece:=span*tsrange((v->>'validFrom')::timestamp,(v->>'validTo')::timestamp,'[)')*tsrange(p_from,p_to,'[)');IF isempty(piece) THEN CONTINUE;END IF;
    IF v->'binding'->'campus'->>'id' IS DISTINCT FROM p_campus::text THEN RAISE EXCEPTION 'CROSS_CAMPUS_POLICY_REQUIRED';END IF;
    IF p_kind='WARD' THEN
     basis:=care_organization.ward_admission(p_actor,v->'binding',lower(piece),upper(piece),p_r);
     source:=governance_catalog.ward_source_coverage(p_actor,(property->'facts'->'source'->>'sourceSystemId')::uuid,lower(piece),upper(piece),p_r);
    ELSE basis:=care_organization.nursing_admission(p_actor,v->'binding',lower(piece),upper(piece),p_r);source:=governance_catalog.nursing_source_coverage(p_actor,(property->'facts'->'source'->>'sourceSystemId')::uuid,lower(piece),upper(piece),p_r);END IF;
    -- Accepted manager pins are distinct from current qualification.
    parts:=parts||jsonb_build_array(jsonb_build_object('from',to_char(lower(piece),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(upper(piece),'YYYY-MM-DD"T"HH24:MI:SS.US'),'propertyVersionId',property->>'id','bindingVersionId',v->>'id','binding',v->'binding','basis',basis,'source',source));complete:=complete+tsmultirange(piece);
   END LOOP;
  END LOOP;
 END LOOP;
 IF NOT complete @> tsrange(p_from,p_to,'[)') THEN RAISE EXCEPTION '%',CASE p_kind WHEN 'WARD' THEN 'WARD_WINDOW_NOT_COVERED' ELSE 'NURSING_WINDOW_NOT_COVERED' END;END IF;
 RETURN jsonb_build_object('id',p_id,'campusId',p_campus,'parts',parts);
END $$;
CREATE FUNCTION care_organization.ward_nursing_admission(p_actor text,p_a jsonb,p_rule jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ward jsonb;nursing jsonb;participants jsonb:='[]';id text;BEGIN
 PERFORM care_organization.ward_nursing_closed(p_a,ARRAY['ward','nursing','campus','purpose']);IF p_a->>'purpose'<>'NURSING_COVERAGE' OR p_a->'ward'->>'owner'<>'care-organization/ward' OR p_a->'nursing'->>'owner'<>'care-organization/nursing' OR p_a->'campus'->>'owner'<>'organization-master/campus' THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 ward:=care_organization.ward_nursing_master_window(p_actor,'WARD',(p_a->'ward'->>'id')::uuid,(p_a->'campus'->>'id')::uuid,p_from,p_to,p_r);
 nursing:=care_organization.ward_nursing_master_window(p_actor,'NURSING',(p_a->'nursing'->>'id')::uuid,(p_a->'campus'->>'id')::uuid,p_from,p_to,p_r);
 IF p_rule->>'kind'='SHARED_BOUNDARY' THEN FOR id IN SELECT value FROM jsonb_array_elements_text(p_rule->'participants') ORDER BY value LOOP participants:=participants||jsonb_build_array(care_organization.ward_nursing_master_window(p_actor,'NURSING',id::uuid,(p_a->'campus'->>'id')::uuid,p_from,p_to,p_r));END LOOP;END IF;
 RETURN jsonb_build_object('ward',ward,'nursing',nursing,'participants',participants);
END $$;
CREATE FUNCTION care_organization.ward_nursing_rule_equal(a jsonb,b jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF a->>'kind' IS DISTINCT FROM b->>'kind' THEN RETURN false;END IF;
 IF a->>'kind'<>'SHARED_BOUNDARY' THEN RETURN a=b;END IF;
 RETURN (a-ARRAY['participants','coverage','validFrom','validTo'])=(b-ARRAY['participants','coverage','validFrom','validTo']) AND (a->'participants') @> (b->'participants') AND (b->'participants') @> (a->'participants') AND care_organization.ward_nursing_scope_contains(a->'coverage',b->'coverage') AND care_organization.ward_nursing_scope_contains(b->'coverage',a->'coverage') AND (a->>'validFrom')::timestamp=(b->>'validFrom')::timestamp AND (a->>'validTo')::timestamp IS NOT DISTINCT FROM (b->>'validTo')::timestamp;
END $$;
CREATE FUNCTION care_organization.ward_nursing_group_validate(p_ward uuid,p_r timestamp) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h record;o record;v care_organization.ward_nursing_version;ov care_organization.ward_nursing_version;span tsrange;other_span tsrange;rule jsonb;other_rule jsonb;BEGIN
 FOR h IN SELECT * FROM care_organization.ward_nursing WHERE ward_id=p_ward LOOP
  span:=care_organization.ward_nursing_reserved(h.id,p_r);IF isempty(span) THEN CONTINUE;END IF;SELECT * INTO v FROM care_organization.ward_nursing_version WHERE ward_nursing_id=h.id AND action IN ('CREATE','REVISE') AND recorded_at<=p_r ORDER BY number DESC LIMIT 1;rule:=v.facts->'rule';
  IF rule->>'kind'='SHARED_BOUNDARY' AND (NOT rule->'participants' ? h.nursing_unit_id::text OR NOT care_organization.ward_nursing_scope_contains(rule->'coverage',v.facts->'coverageScope') OR NOT tsrange((rule->>'validFrom')::timestamp,(rule->>'validTo')::timestamp,'[)') @> span) THEN RAISE EXCEPTION 'SHARING_PARTICIPANTS_NOT_COVERED';END IF;
  FOR o IN SELECT * FROM care_organization.ward_nursing WHERE ward_id=p_ward AND id>h.id LOOP
   other_span:=care_organization.ward_nursing_reserved(o.id,p_r);IF NOT span&&other_span THEN CONTINUE;END IF;SELECT * INTO ov FROM care_organization.ward_nursing_version WHERE ward_nursing_id=o.id AND action IN ('CREATE','REVISE') AND recorded_at<=p_r ORDER BY number DESC LIMIT 1;
   IF NOT care_organization.ward_nursing_scope_intersects(v.facts->'coverageScope',ov.facts->'coverageScope') THEN CONTINUE;END IF;
   IF h.nursing_unit_id=o.nursing_unit_id THEN RAISE EXCEPTION 'WARD_NURSING_DUPLICATE_RELATION';END IF;
   IF (v.facts->>'isPrimary')::boolean AND (ov.facts->>'isPrimary')::boolean THEN RAISE EXCEPTION 'WARD_NURSING_PRIMARY_CONFLICT';END IF;
   other_rule:=ov.facts->'rule';IF rule->>'kind' IS DISTINCT FROM 'SHARED_BOUNDARY' OR other_rule->>'kind' IS DISTINCT FROM 'SHARED_BOUNDARY' THEN RAISE EXCEPTION 'SHARING_REVIEW_REQUIRED';END IF;
   IF NOT care_organization.ward_nursing_rule_equal(rule,other_rule) THEN RAISE EXCEPTION 'SHARING_POLICY_CONFLICT';END IF;IF NOT rule->'participants' ? o.nursing_unit_id::text THEN RAISE EXCEPTION 'SHARING_PARTICIPANTS_NOT_COVERED';END IF;
  END LOOP;
 END LOOP;
END $$;

CREATE FUNCTION care_organization.ward_nursing_scope_for_ward(p_actor text,p_ward uuid,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE id uuid;BEGIN PERFORM care_organization.ward_snapshot(p_actor,p_ward);SELECT s.id INTO id FROM care_organization.ward_nursing_scope_set s WHERE ward_id=p_ward AND recorded_at<=p_r;IF id IS NULL THEN RETURN NULL;END IF;RETURN care_organization.ward_nursing_scope_set_read(p_actor,id,p_r);END $$;

CREATE FUNCTION governance_catalog.ward_nursing_source_windows(p_actor text,p_source uuid,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r timestamp:=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));pin uuid;spans tsmultirange;piece tsrange;parts jsonb:='[]';BEGIN
 IF p_from IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',p_source);
 FOR pin IN SELECT version_id FROM governance_catalog.definition_spans(p_source,r) LOOP
  spans:=governance_catalog.source_valid_spans(pin,r)*tsmultirange(tsrange(p_from,p_to,'[)'));IF spans='{}'::tsmultirange THEN CONTINUE;END IF;
  PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',p_source,pin);
  FOR piece IN SELECT unnest(spans) LOOP parts:=parts||jsonb_build_array(jsonb_build_object('from',to_char(lower(piece),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(upper(piece),'YYYY-MM-DD"T"HH24:MI:SS.US')));END LOOP;
 END LOOP;
 RETURN parts;
END $$;

CREATE OR REPLACE FUNCTION care_organization.ward_nursing_mutate(p_ticket text, p_signature text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE fresh jsonb;oldfacts jsonb;handover jsonb;source_coverage care_organization.ward_nursing;source_version care_organization.ward_nursing_version;definition jsonb;scope_id uuid;partition jsonb;partitions jsonb;reduction boolean;prior_primary boolean;t jsonb:=p_ticket::jsonb;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;actor text:=t->>'actor';op text:=t->>'operation';identity text;r care_organization.ward_nursing_input;j jsonb;verify care_organization.ward_nursing_verification;c jsonb;approved_by text;frozen care_organization.ward_nursing_apply_binding;change care_organization.ward_nursing_change;previous care_organization.ward_nursing_version;declaration care_organization.ward_nursing_version;w jsonb;target uuid;u care_organization.ward_nursing;other care_organization.ward_nursing;results jsonb:='[]';from_at timestamp;to_at timestamp;record_at timestamp:=timezone('Asia/Shanghai',clock_timestamp());root_id uuid;campus uuid;campuses uuid[];campus_state jsonb;state text;reserved tsrange;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.ward_nursing_write_authority WHERE singleton;
 IF secret IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF op='STAGE' THEN
  PERFORM care_organization.ward_nursing_closed(t,ARRAY['operation','actor','transaction','requestId','jobId','revisionId','campus','campusIds','digest','envelope']);
  SELECT array_agg(value::uuid) INTO campuses FROM jsonb_array_elements_text(t->'campusIds');IF cardinality(campuses) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  FOREACH campus IN ARRAY campuses LOOP identity:=care_organization.ward_nursing_authorize(actor,campus,'WRITE');PERFORM care_organization.ward_nursing_authorize(actor,campus,'READ_RESTRICTED');END LOOP;
  SELECT * INTO r FROM care_organization.ward_nursing_input WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF r.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);END IF;
  j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',t->>'jobId'));
  IF j->>'submitterIdentity' IS DISTINCT FROM identity OR j->>'currentRevisionId' IS DISTINCT FROM t->>'revisionId' OR j->'contract'->>'dataset'<>'ORG11' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
  INSERT INTO care_organization.ward_nursing_input(job_id,job_revision,maker,identity_code,request_id,digest,campus_ids,scope,envelope) VALUES((j->>'id')::uuid,(j->>'currentRevisionId')::uuid,actor,identity,(t->>'requestId')::uuid,t->>'digest',campuses,t->>'campus',t->'envelope') RETURNING * INTO r;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'WARD_NURSING_INPUT','ORG11_CORE',r.digest);RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);
 END IF;
 r:=jsonb_populate_record(NULL::care_organization.ward_nursing_input,care_organization.ward_nursing_input_read(actor,(t->>'inputId')::uuid,CASE WHEN op='VERIFY' THEN 'VERIFY' ELSE 'WRITE' END));
 IF EXISTS(SELECT 1 FROM care_organization.ward_nursing_withdrawal WHERE input_id=r.id) THEN RAISE EXCEPTION 'INPUT_WITHDRAWN';END IF; IF op='VERIFY' THEN
  PERFORM care_organization.ward_nursing_closed(t,ARRAY['operation','actor','transaction','inputId','inputDigest','requestId','digest','envelope']);
  identity:=vnext_control.authorize(actor,'SYNTHETIC','REVIEW');IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;IF r.digest IS DISTINCT FROM t->>'inputDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  SELECT * INTO verify FROM care_organization.ward_nursing_verification WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF verify.input_id<>r.id OR verify.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('verificationId',verify.id);END IF;
  IF EXISTS(SELECT 1 FROM care_organization.ward_nursing_change WHERE input_id=r.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
  INSERT INTO care_organization.ward_nursing_verification(input_id,number,actor,identity_code,request_id,digest,envelope) VALUES(r.id,(SELECT coalesce(max(number),0)+1 FROM care_organization.ward_nursing_verification WHERE input_id=r.id),actor,identity,(t->>'requestId')::uuid,t->>'digest',t->'envelope') RETURNING * INTO verify;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'WARD_NURSING_VERIFY','RECEIVING_BASIS',verify.digest);RETURN jsonb_build_object('verificationId',verify.id);
 END IF;
 IF op NOT IN ('FREEZE','APPLY') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 c:=governance_catalog.apply_record(actor,'READ_CANDIDATE',jsonb_build_object('candidateId',(t->>'candidateId')::uuid));
 IF c->>'digest' IS DISTINCT FROM t->>'digest' OR c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 IF op='FREEZE' THEN
  PERFORM care_organization.ward_nursing_closed(t,ARRAY['operation','actor','transaction','inputId','writes','writesDigest','candidateId','digest']);
  SELECT * INTO verify FROM care_organization.ward_nursing_verification WHERE input_id=r.id ORDER BY number DESC LIMIT 1;
 IF verify.id IS NULL THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 PERFORM care_organization.ward_nursing_job_read(verify.actor,r.id);
 FOREACH campus IN ARRAY r.campus_ids LOOP identity:=care_organization.ward_nursing_authorize(verify.actor,campus,'VERIFY');IF identity IS DISTINCT FROM verify.identity_code OR identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(t->'writes') q(item) WHERE item->'facts'->'verificationBasis'->>'id' IS DISTINCT FROM verify.id::text OR item->'facts'->'verificationBasis'->>'version' IS DISTINCT FROM verify.number::text OR item->'facts'->'verificationBasis'->>'digest' IS DISTINCT FROM r.digest) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
INSERT INTO care_organization.ward_nursing_apply_binding VALUES((c->>'id')::uuid,r.id,c->>'digest',t->>'writesDigest',encode(sha256(convert_to((t->'writes')::text,'UTF8')),'hex'),verify.id,verify.number,verify.digest);RETURN '{}';
 END IF;
 PERFORM care_organization.ward_nursing_closed(t,ARRAY['operation','actor','transaction','inputId','writes','writeIndex','writesDigest','candidateId','digest','recordAt','recordAtProof']);
 record_at:=care_organization.ward_nursing_local_time(t->>'recordAt');
 IF record_at IS NULL OR t->>'recordAtProof' IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to('WARD_NURSING_TRANSACTION_R_V1|'||pg_current_xact_id()::text||'|'||(t->>'recordAt'),'UTF8'))),'hex') THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
 approved_by:=c->>'approvedBy';IF approved_by IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;PERFORM governance_catalog.apply_record(approved_by,'CHECK_APPROVAL',jsonb_build_object('candidateId',(c->>'id')::uuid));
 FOREACH campus IN ARRAY r.campus_ids LOOP identity:=care_organization.ward_nursing_authorize(approved_by,campus,'REVIEW');IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;END LOOP;
 PERFORM care_organization.ward_nursing_job_read(actor,r.id);PERFORM care_organization.ward_nursing_job_read(approved_by,r.id);
 SELECT * INTO frozen FROM care_organization.ward_nursing_apply_binding WHERE candidate_id=(c->>'id')::uuid;
 IF NOT FOUND OR frozen.input_id<>r.id OR frozen.candidate_digest IS DISTINCT FROM t->>'digest' OR frozen.writes_digest IS DISTINCT FROM t->>'writesDigest' OR ((t->>'writeIndex')::integer=1 AND frozen.writes_hash IS DISTINCT FROM encode(sha256(convert_to((t->'writes')::text,'UTF8')),'hex')) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 SELECT * INTO change FROM care_organization.ward_nursing_change WHERE input_id=r.id;
 IF FOUND THEN IF change.candidate_id<>(c->>'id')::uuid OR change.digest IS DISTINCT FROM t->>'writesDigest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN change.results->((t->>'writeIndex')::integer-1);END IF;
SELECT * INTO verify FROM care_organization.ward_nursing_verification WHERE input_id=r.id ORDER BY number DESC LIMIT 1;
 IF verify.id IS NULL THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 PERFORM care_organization.ward_nursing_job_read(verify.actor,r.id);
 FOREACH campus IN ARRAY r.campus_ids LOOP identity:=care_organization.ward_nursing_authorize(verify.actor,campus,'VERIFY');IF identity IS DISTINCT FROM verify.identity_code OR identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(t->'writes') q(item) WHERE item->'facts'->'verificationBasis'->>'id' IS DISTINCT FROM verify.id::text OR item->'facts'->'verificationBasis'->>'version' IS DISTINCT FROM verify.number::text OR item->'facts'->'verificationBasis'->>'digest' IS DISTINCT FROM r.digest) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
IF frozen.verification_id IS DISTINCT FROM verify.id OR frozen.verification_number IS DISTINCT FROM verify.number OR frozen.verification_digest IS DISTINCT FROM verify.digest THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));IF r.job_revision IS DISTINCT FROM (j->>'currentRevisionId')::uuid THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 IF jsonb_typeof(t->'writes') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'writes') NOT BETWEEN 1 AND 100 OR (t->>'writeIndex')::integer<>1 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;root_id:=uuidv7();


 FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP
  PERFORM care_organization.ward_nursing_closed(w,ARRAY['key','targetId','expectedHead','action','validFrom','validTo','applicability','facts','reason','sourceRow','scope']);
  from_at:=care_organization.ward_nursing_local_time(w->>'validFrom');to_at:=CASE WHEN w->>'validTo' IS NULL THEN NULL ELSE care_organization.ward_nursing_local_time(w->>'validTo') END;
  IF to_at IS NOT NULL AND to_at<=from_at THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
  campus:=(w->'applicability'->'campus'->>'id')::uuid;PERFORM care_organization.ward_nursing_authorize(actor,campus,'WRITE');PERFORM care_organization.ward_nursing_authorize(approved_by,campus,'REVIEW');PERFORM care_organization.ward_nursing_authorize(verify.actor,campus,'VERIFY');
  campus_state:=organization_master.campus_snapshot(actor,campus);IF campus_state->>'scope' IS DISTINCT FROM r.scope OR w->>'scope' IS DISTINCT FROM r.scope THEN RAISE EXCEPTION 'WARD_NURSING_ANCHOR_MISMATCH';END IF;
  IF w->>'action'='REGISTER_SCOPE' THEN
   IF (governance_catalog.contract_read(actor,jsonb_build_object('scope','SYNTHETIC','mode','EFFECTIVE','target',j->'contract'->>'id','businessAt',to_char(record_at,'YYYY-MM-DD"T"HH24:MI:SS.US')))->0->>'versionId') IS DISTINCT FROM j->'contract'->>'versionId' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
    IF NOT tsrange((j->'contract'->>'validFrom')::timestamp,(j->'contract'->>'validTo')::timestamp,'[)') @> tsrange(from_at,to_at,'[)') THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;

   PERFORM care_organization.ward_nursing_closed(w->'applicability',ARRAY['ward','campus','purpose']);PERFORM care_organization.ward_nursing_closed(w->'applicability'->'ward',ARRAY['owner','id']);PERFORM care_organization.ward_nursing_closed(w->'applicability'->'campus',ARRAY['owner','id']);IF w->'applicability'->>'purpose'<>'NURSING_COVERAGE' OR w->'applicability'->'ward'->>'owner'<>'care-organization/ward' OR w->'applicability'->'campus'->>'owner'<>'organization-master/campus' THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
   IF EXISTS(SELECT 1 FROM care_organization.ward_nursing_scope_set WHERE ward_id=(w->'applicability'->'ward'->>'id')::uuid) THEN RAISE EXCEPTION 'SCOPE_REVISION_NOT_SUPPORTED';END IF;
   definition:=w->'facts'->'definition';IF coalesce((w->'facts'->>'completeAndDisjoint')::boolean,false)=false OR jsonb_array_length(definition->'partitions') NOT BETWEEN 2 AND 100 OR (SELECT count(DISTINCT q->>'sourceAlias') FROM jsonb_array_elements(definition->'partitions') q)<>jsonb_array_length(definition->'partitions') THEN RAISE EXCEPTION 'SCOPE_REVIEW_REQUIRED';END IF;
   fresh:=care_organization.ward_nursing_master_window(actor,'WARD',(w->'applicability'->'ward'->>'id')::uuid,campus,from_at,to_at,record_at);
   IF fresh IS DISTINCT FROM w->'facts'->'dependencies'->'upstream'->'ward' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
   PERFORM care_organization.unit_ward_ward_guard(actor,w->'applicability',w->'facts'->'dependencies'->'upstream'->'operatingWard',from_at,to_at,record_at);
   IF governance_catalog.ward_nursing_source_coverage(actor,(definition->>'sourceSystemId')::uuid,from_at,to_at,record_at) IS DISTINCT FROM w->'facts'->'dependencies'->'source' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
   PERFORM care_organization.ward_nursing_master_window(approved_by,'WARD',(w->'applicability'->'ward'->>'id')::uuid,campus,from_at,to_at,record_at);
   partitions:='[]';FOR partition IN SELECT value FROM jsonb_array_elements(definition->'partitions') LOOP PERFORM care_organization.ward_nursing_closed(partition,ARRAY['sourceAlias','name','boundary']);IF length(partition->>'name') NOT BETWEEN 1 AND 2000 OR length(partition->>'boundary') NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;partitions:=partitions||jsonb_build_array(partition||jsonb_build_object('id',uuidv7()));END LOOP;
   INSERT INTO care_organization.ward_nursing_scope_set(ward_id,campus_id,scope,source_alias,partitions,valid_from,valid_to,recorded_at,verification_basis,change_id) VALUES((w->'applicability'->'ward'->>'id')::uuid,campus,r.scope,definition->>'sourceAlias',partitions,from_at,to_at,record_at,w->'facts'->'verificationBasis',root_id) RETURNING id INTO scope_id;
   results:=results||jsonb_build_array(jsonb_build_object('owner','care-organization/ward-nursing-scope','id',scope_id,'version','1','source',jsonb_build_object('dataset','ORG11','row',(w->>'sourceRow')::integer,'step','REGISTER_SCOPE')));
   INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,scope_id,'WARD_NURSING_SCOPE_REGISTER','APPROVED_SCOPE',t->>'writesDigest');CONTINUE;
  END IF;
  PERFORM care_organization.ward_nursing_closed(w->'applicability',ARRAY['ward','nursing','campus','purpose']);
  PERFORM care_organization.ward_nursing_closed(w->'applicability'->'ward',ARRAY['owner','id']);PERFORM care_organization.ward_nursing_closed(w->'applicability'->'nursing',ARRAY['owner','id']);PERFORM care_organization.ward_nursing_closed(w->'applicability'->'campus',ARRAY['owner','id']);
  PERFORM care_organization.ward_nursing_closed(w->'facts',ARRAY['coverageScope','coverageSource','isPrimary','handoverRuleReference','rule','handover','contractVersionId','verificationBasis','dependencies','source']);
  PERFORM care_organization.ward_nursing_closed(w->'facts'->'source',ARRAY['sourceAlias','sourceVersion','sourceSystemId','sourceRecordedAt','recordLocatorEvidence','recordStatus','approvalReference']);
  PERFORM care_organization.ward_nursing_closed(w->'facts'->'source'->'recordLocatorEvidence',ARRAY['inputId','row']);
  IF w->'facts'->>'contractVersionId' IS DISTINCT FROM j->'contract'->>'versionId' OR w->'facts'->'source'->'recordLocatorEvidence'->>'inputId' IS DISTINCT FROM r.id::text OR (w->'facts'->'source'->>'sourceVersion') !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  IF w->'applicability'->>'purpose'<>'NURSING_COVERAGE' OR w->'applicability'->'ward'->>'owner'<>'care-organization/ward' OR w->'applicability'->'nursing'->>'owner'<>'care-organization/nursing' OR w->'applicability'->'campus'->>'owner'<>'organization-master/campus' THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
  IF w->>'action'='CREATE' THEN
   IF w->>'targetId' IS NOT NULL OR w->>'expectedHead' IS NOT NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
   INSERT INTO care_organization.ward_nursing(nursing_unit_id,campus_id,ward_id,scope,applicability,source_system_id,source_alias) VALUES((w->'applicability'->'nursing'->>'id')::uuid,campus,(w->'applicability'->'ward'->>'id')::uuid,r.scope,w->'applicability',(w->'facts'->'source'->>'sourceSystemId')::uuid,w->'facts'->'source'->>'sourceAlias') RETURNING * INTO u;target:=u.id;previous:=NULL;declaration:=NULL;
  ELSE
   target:=(w->>'targetId')::uuid;PERFORM care_organization.ward_nursing_snapshot(actor,target);SELECT * INTO u FROM care_organization.ward_nursing WHERE id=target;
   SELECT * INTO previous FROM care_organization.ward_nursing_version WHERE ward_nursing_id=target ORDER BY number DESC LIMIT 1;SELECT * INTO declaration FROM care_organization.ward_nursing_version WHERE ward_nursing_id=target AND action IN ('CREATE','REVISE') ORDER BY number DESC LIMIT 1;
   IF previous.number::text IS DISTINCT FROM w->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
   IF EXISTS(SELECT 1 FROM care_organization.ward_nursing_version WHERE ward_nursing_id=target AND action='END' AND (w->>'action'<>'END' OR valid_from<from_at)) THEN RAISE EXCEPTION 'WARD_NURSING_ENDED';END IF;
   IF u.applicability IS DISTINCT FROM w->'applicability' OR u.source_system_id::text IS DISTINCT FROM w->'facts'->'source'->>'sourceSystemId' OR u.source_alias IS DISTINCT FROM w->'facts'->'source'->>'sourceAlias' THEN RAISE EXCEPTION 'WARD_NURSING_ANCHOR_MISMATCH';END IF;
   IF w->>'action'='REVISE' AND from_at<>declaration.valid_from THEN RAISE EXCEPTION 'WARD_NURSING_REVISE_INVALID';END IF;
   IF w->>'action' NOT IN ('REVISE','END') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
   IF w->>'action'='END' AND (to_at IS NOT NULL OR from_at<declaration.valid_from OR from_at>coalesce(declaration.valid_to,'infinity'::timestamp) OR ((w->'facts')-ARRAY['source','verificationBasis','contractVersionId','dependencies']) IS DISTINCT FROM (declaration.facts-ARRAY['source','verificationBasis','contractVersionId','dependencies'])) THEN RAISE EXCEPTION 'WARD_NURSING_LIFECYCLE_INVALID';END IF;
  END IF;
  IF jsonb_typeof(w->'facts'->'isPrimary') IS DISTINCT FROM 'boolean' OR length(btrim(coalesce(w->'facts'->'source'->>'approvalReference','')))=0 THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
  reduction:=w->>'action'='REVISE' AND care_organization.ward_nursing_scope_contains(declaration.facts->'coverageScope',w->'facts'->'coverageScope') AND (declaration.valid_to IS NULL OR to_at IS NOT NULL AND to_at<=declaration.valid_to) AND ((w->'facts')-ARRAY['coverageScope','coverageSource','source','verificationBasis','contractVersionId','dependencies','rule']) IS NOT DISTINCT FROM (declaration.facts-ARRAY['coverageScope','coverageSource','source','verificationBasis','contractVersionId','dependencies','rule']);
  reduction:=reduction AND care_organization.ward_nursing_rule_equal(w->'facts'->'rule',declaration.facts->'rule');
  IF w->>'action'<>'END' THEN
   fresh:=care_organization.ward_nursing_scope_validate(actor,u.applicability,w->'facts'->'coverageScope',from_at,to_at,record_at);
   IF NOT reduction THEN
    IF (governance_catalog.contract_read(actor,jsonb_build_object('scope','SYNTHETIC','mode','EFFECTIVE','target',j->'contract'->>'id','businessAt',to_char(record_at,'YYYY-MM-DD"T"HH24:MI:SS.US')))->0->>'versionId') IS DISTINCT FROM j->'contract'->>'versionId' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
    IF NOT tsrange((j->'contract'->>'validFrom')::timestamp,(j->'contract'->>'validTo')::timestamp,'[)') @> tsrange(from_at,to_at,'[)') THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;

    IF fresh IS DISTINCT FROM w->'facts'->'dependencies'->'scope' OR governance_catalog.ward_nursing_source_coverage(actor,u.source_system_id,from_at,to_at,record_at) IS DISTINCT FROM w->'facts'->'dependencies'->'source' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
    fresh:=care_organization.ward_nursing_admission(actor,u.applicability,w->'facts'->'rule',from_at,to_at,record_at);
    IF fresh IS DISTINCT FROM ((w->'facts'->'dependencies'->'upstream')-'operatingWard') THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
    PERFORM care_organization.unit_ward_ward_guard(actor,u.applicability,w->'facts'->'dependencies'->'upstream'->'operatingWard',from_at,to_at,record_at);
    PERFORM care_organization.ward_nursing_admission(approved_by,u.applicability,w->'facts'->'rule',from_at,to_at,record_at);PERFORM care_organization.ward_nursing_admission(verify.actor,u.applicability,w->'facts'->'rule',from_at,to_at,record_at);
   END IF;
  END IF;
  handover:=w->'facts'->'handover';
  IF w->>'action'='CREATE' THEN
   SELECT EXISTS(SELECT 1 FROM care_organization.ward_nursing o JOIN care_organization.ward_nursing_version ov ON ov.ward_nursing_id=o.id WHERE o.ward_id=u.ward_id AND o.id<>target AND ov.action IN ('CREATE','REVISE') AND ov.recorded_at<record_at AND ov.valid_from<from_at
    AND ov.number=(SELECT max(number) FROM care_organization.ward_nursing_version WHERE ward_nursing_id=o.id AND action IN ('CREATE','REVISE') AND recorded_at<=record_at)
    AND NOT isempty(care_organization.ward_nursing_reserved(o.id,record_at))
    AND (((w->'facts'->>'isPrimary')::boolean AND (ov.facts->>'isPrimary')::boolean) OR EXISTS(SELECT 1 FROM care_organization.ward_nursing_version e WHERE e.ward_nursing_id=o.id AND e.action='END' AND e.recorded_at<=record_at AND e.valid_from<=from_at))
    AND care_organization.ward_nursing_scope_intersects(ov.facts->'coverageScope',w->'facts'->'coverageScope')) INTO prior_primary;
   IF prior_primary AND handover->>'kind' IS DISTINCT FROM 'CONFIRMED_HANDOVER' THEN RAISE EXCEPTION 'HANDOVER_CONFIRMATION_REQUIRED';END IF;
  END IF;
  IF w->>'action'='CREATE' AND handover->>'kind'='CONFIRMED_HANDOVER' THEN
   IF handover->>'confirmed' IS DISTINCT FROM 'true' OR handover->>'successorSourceAlias' IS DISTINCT FROM u.source_alias OR handover->'successorNursing' IS DISTINCT FROM u.applicability->'nursing' OR (handover->>'cutover')::timestamp<>from_at OR w->'facts'->>'handoverRuleReference' IS DISTINCT FROM handover->>'ruleReference' OR NOT care_organization.ward_nursing_scope_contains(handover->'coverage',w->'facts'->'coverageScope') OR NOT care_organization.ward_nursing_scope_contains(w->'facts'->'coverageScope',handover->'coverage') THEN RAISE EXCEPTION 'HANDOVER_NOT_CONFIRMED';END IF;
   SELECT * INTO source_coverage FROM care_organization.ward_nursing WHERE id=(handover->'source'->>'id')::uuid;SELECT * INTO source_version FROM care_organization.ward_nursing_version WHERE ward_nursing_id=source_coverage.id ORDER BY number DESC LIMIT 1;
   SELECT facts INTO oldfacts FROM care_organization.ward_nursing_version WHERE ward_nursing_id=source_coverage.id AND action IN ('CREATE','REVISE') ORDER BY number DESC LIMIT 1;
   IF source_coverage.ward_id IS DISTINCT FROM u.ward_id OR source_coverage.campus_id IS DISTINCT FROM u.campus_id OR source_coverage.nursing_unit_id=u.nursing_unit_id OR source_version.action IS DISTINCT FROM 'END' OR source_version.change_id IS DISTINCT FROM root_id OR source_version.valid_from<>from_at OR source_version.number<>(handover->'source'->>'expectedHead')::bigint+1 OR NOT care_organization.ward_nursing_scope_contains(oldfacts->'coverageScope',w->'facts'->'coverageScope') OR NOT care_organization.ward_nursing_scope_contains(w->'facts'->'coverageScope',oldfacts->'coverageScope') THEN RAISE EXCEPTION 'HANDOVER_NOT_CONFIRMED';END IF;
  ELSIF w->>'action'='CREATE' AND (handover->>'kind' IS DISTINCT FROM 'NO_HANDOVER_REQUIRED' OR handover->>'confirmed' IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'HANDOVER_CONFIRMATION_REQUIRED';END IF;
  INSERT INTO care_organization.ward_nursing_version(ward_nursing_id,number,action,valid_from,valid_to,facts,reason,change_id,recorded_at) VALUES(target,coalesce(previous.number,0)+1,w->>'action',from_at,to_at,w->'facts',w->>'reason',root_id,record_at);
  results:=results||jsonb_build_array(jsonb_build_object('owner','care-organization/ward-nursing-coverage','id',target,'version',(coalesce(previous.number,0)+1)::text,'source',jsonb_build_object('dataset','ORG11','row',(w->>'sourceRow')::integer,'step',w->>'action')));
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,target,'WARD_NURSING_'||(w->>'action'),'APPROVED_WARD_NURSING_COMMAND',t->>'writesDigest');
 END LOOP;
 FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') WHERE value->>'action' IN ('CREATE','REVISE') LOOP PERFORM care_organization.ward_nursing_group_validate((w->'applicability'->'ward'->>'id')::uuid,record_at);END LOOP;
 INSERT INTO care_organization.ward_nursing_change VALUES(root_id,r.id,(c->>'id')::uuid,t->>'writesDigest',results,record_at);RETURN results->0;
END $function$;
CREATE TRIGGER ward_nursing_access_lock BEFORE INSERT OR UPDATE OR DELETE ON care_organization.ward_nursing_access FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER ward_nursing_access_audit AFTER INSERT OR UPDATE OR DELETE ON care_organization.ward_nursing_access FOR EACH ROW EXECUTE FUNCTION care_organization.ward_nursing_audit_access();
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['ward_nursing','ward_nursing_scope_set','ward_nursing_input','ward_nursing_verification','ward_nursing_change','ward_nursing_version','ward_nursing_apply_binding','ward_nursing_withdrawal'] LOOP EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON care_organization.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',tab);EXECUTE format('ALTER TABLE care_organization.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('REVOKE ALL ON care_organization.%I FROM PUBLIC,hdi_prototype',tab);END LOOP;
END $$;
ALTER TABLE care_organization.ward_nursing_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON care_organization.ward_nursing_access,vnext_control.ward_nursing_write_authority FROM PUBLIC,hdi_prototype;
DO $$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('care_organization','governance_catalog') AND p.proname LIKE 'ward_nursing_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,hdi_prototype',f.name);END LOOP;END $$;
