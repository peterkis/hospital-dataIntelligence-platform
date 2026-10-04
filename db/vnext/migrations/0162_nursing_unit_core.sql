SELECT pg_advisory_xact_lock(901002);

GRANT USAGE ON SCHEMA care_organization TO hdi_prototype;
CREATE TABLE vnext_control.nursing_write_authority(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),key_hex text NOT NULL CHECK(key_hex ~ '^[a-f0-9]{64}$'));
CREATE TABLE care_organization.nursing_access(actor text NOT NULL REFERENCES vnext_control.actor(code),campus_id uuid NOT NULL REFERENCES organization_master.campus(id),scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')),permission text NOT NULL CHECK(permission IN ('READ','WRITE','REVIEW','VERIFY','READ_RESTRICTED')),PRIMARY KEY(actor,campus_id,scope,permission));
CREATE TABLE care_organization.nursing_input(id uuid PRIMARY KEY DEFAULT uuidv7(),revision uuid NOT NULL DEFAULT uuidv7(),job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),job_revision uuid NOT NULL REFERENCES governance_catalog.import_input_revision(id),maker text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),campus_ids uuid[] NOT NULL CHECK(cardinality(campus_ids)>0),scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')),envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(job_id,job_revision));
CREATE TABLE care_organization.nursing_verification(id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL REFERENCES care_organization.nursing_input(id),number bigint NOT NULL CHECK(number>0),actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL,envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(input_id,number));
CREATE TABLE care_organization.nursing_unit(id uuid PRIMARY KEY DEFAULT uuidv7(),department_id uuid NOT NULL REFERENCES department_master.department(id));
CREATE TABLE care_organization.nursing_code(code text PRIMARY KEY CHECK(length(code) BETWEEN 1 AND 256 AND code ~ '\S'),unit_id uuid NOT NULL REFERENCES care_organization.nursing_unit(id));
CREATE TABLE care_organization.nursing_change(id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL UNIQUE REFERENCES care_organization.nursing_input(id),candidate_id uuid NOT NULL UNIQUE REFERENCES governance_catalog.apply_candidate(id),digest text NOT NULL,results jsonb NOT NULL,recorded_at timestamp NOT NULL);
CREATE TABLE care_organization.nursing_apply_binding(candidate_id uuid PRIMARY KEY REFERENCES governance_catalog.apply_candidate(id),input_id uuid NOT NULL REFERENCES care_organization.nursing_input(id),candidate_digest text NOT NULL,writes_digest text NOT NULL,writes_hash text NOT NULL);
CREATE TABLE care_organization.nursing_version(id uuid PRIMARY KEY DEFAULT uuidv7(),unit_id uuid NOT NULL REFERENCES care_organization.nursing_unit(id),number bigint NOT NULL CHECK(number>0),action text NOT NULL CHECK(action IN ('CREATE','REVISE','REBIND','SUSPEND')),valid_from timestamp NOT NULL,valid_to timestamp,facts jsonb NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),change_id uuid NOT NULL REFERENCES care_organization.nursing_change(id) DEFERRABLE INITIALLY DEFERRED,recorded_at timestamp NOT NULL,UNIQUE(unit_id,number),CHECK(valid_to IS NULL OR valid_to>valid_from),CHECK(action<>'SUSPEND' OR valid_to IS NULL));
CREATE TABLE care_organization.nursing_unit_binding(id uuid PRIMARY KEY DEFAULT uuidv7(),unit_id uuid NOT NULL REFERENCES care_organization.nursing_unit(id),campus_id uuid NOT NULL REFERENCES organization_master.campus(id),managing_department_id uuid NOT NULL REFERENCES department_master.department(id),scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')));
CREATE TABLE care_organization.nursing_binding_version(id uuid PRIMARY KEY DEFAULT uuidv7(),binding_id uuid NOT NULL REFERENCES care_organization.nursing_unit_binding(id),number bigint NOT NULL CHECK(number>0),valid_from timestamp NOT NULL,valid_to timestamp,binding jsonb NOT NULL,dependencies jsonb NOT NULL,change_id uuid NOT NULL REFERENCES care_organization.nursing_change(id) DEFERRABLE INITIALLY DEFERRED,recorded_at timestamp NOT NULL,UNIQUE(binding_id,number),CHECK(valid_to IS NULL OR valid_to>valid_from));
CREATE INDEX nursing_department ON care_organization.nursing_unit(department_id);
CREATE INDEX nursing_binding_campus ON care_organization.nursing_unit_binding(campus_id,unit_id);

CREATE TABLE care_organization.nursing_withdrawal(input_id uuid PRIMARY KEY REFERENCES care_organization.nursing_input(id),actor text NOT NULL REFERENCES vnext_control.actor(code),request_id uuid NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()));
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON care_organization.nursing_withdrawal FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
ALTER TABLE care_organization.nursing_withdrawal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON care_organization.nursing_withdrawal FROM PUBLIC,hdi_prototype;
CREATE OR REPLACE FUNCTION care_organization.nursing_authorize(p_actor text, p_campus uuid, p_permission text)
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
 IF NOT EXISTS(SELECT 1 FROM care_organization.nursing_access WHERE actor=p_actor AND campus_id=p_campus AND scope=c->>'scope' AND permission=p_permission) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;RETURN identity;
END $function$
;
CREATE OR REPLACE FUNCTION care_organization.nursing_input_read(p_actor text, p_id uuid, p_permission text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE r care_organization.nursing_input;v care_organization.nursing_verification;campus uuid;BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');SELECT * INTO r FROM care_organization.nursing_input WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 FOREACH campus IN ARRAY r.campus_ids LOOP PERFORM care_organization.nursing_authorize(p_actor,campus,p_permission);PERFORM care_organization.nursing_authorize(p_actor,campus,'READ');END LOOP;
 PERFORM governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));
 IF p_permission='READ_RESTRICTED' THEN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'NURSING_READ_RESTRICTED','ORG09_SOURCE',r.digest);END IF;
 SELECT * INTO v FROM care_organization.nursing_verification WHERE input_id=r.id ORDER BY number DESC LIMIT 1;
 RETURN to_jsonb(r)||jsonb_build_object('withdrawn',EXISTS(SELECT 1 FROM care_organization.nursing_withdrawal WHERE input_id=r.id))||jsonb_build_object('verification',CASE WHEN v.id IS NULL THEN NULL ELSE to_jsonb(v) END);
END $function$
;
CREATE OR REPLACE FUNCTION care_organization.nursing_job_read(p_actor text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE r jsonb;BEGIN r:=care_organization.nursing_input_read(p_actor,p_id,'READ_RESTRICTED');RETURN governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r->>'job_id'));END $function$
;
CREATE OR REPLACE FUNCTION care_organization.nursing_snapshot(p_actor text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE u care_organization.nursing_unit;bound care_organization.nursing_unit_binding;BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');SELECT * INTO u FROM care_organization.nursing_unit WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM department_master.snapshot(p_actor,u.department_id);
 FOR bound IN SELECT * FROM care_organization.nursing_unit_binding WHERE unit_id=u.id LOOP PERFORM care_organization.nursing_authorize(p_actor,bound.campus_id,'READ');PERFORM department_master.snapshot(p_actor,bound.managing_department_id);END LOOP;
 RETURN jsonb_build_object('id',u.id,'departmentId',u.department_id,'codes',coalesce((SELECT jsonb_agg(code ORDER BY code) FROM care_organization.nursing_code WHERE unit_id=u.id),'[]'),'versions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'number',v.number::text,'action',v.action,'validFrom',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordedAt',to_char(v.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'facts',v.facts,'reason',v.reason,'changeId',v.change_id) ORDER BY v.number) FROM care_organization.nursing_version v WHERE v.unit_id=u.id),'[]'),'bindings',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'campusId',b.campus_id,'managingDepartmentId',b.managing_department_id,'scope',b.scope,'versions',(SELECT jsonb_agg(jsonb_build_object('id',v.id,'number',v.number::text,'validFrom',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordedAt',to_char(v.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'binding',v.binding,'dependencies',v.dependencies,'changeId',v.change_id) ORDER BY v.number) FROM care_organization.nursing_binding_version v WHERE v.binding_id=b.id)) ORDER BY b.id) FROM care_organization.nursing_unit_binding b WHERE b.unit_id=u.id),'[]'));
END $function$
;
CREATE OR REPLACE FUNCTION care_organization.nursing_snapshot_at(p_actor text, p_id uuid, p_asof timestamp without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE u care_organization.nursing_unit;bound care_organization.nursing_unit_binding;BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');SELECT * INTO u FROM care_organization.nursing_unit WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM department_master.snapshot(p_actor,u.department_id);
 FOR bound IN SELECT * FROM care_organization.nursing_unit_binding WHERE unit_id=u.id AND EXISTS(SELECT 1 FROM care_organization.nursing_binding_version visible WHERE visible.binding_id=care_organization.nursing_unit_binding.id AND visible.recorded_at<=p_asof) LOOP PERFORM care_organization.nursing_authorize(p_actor,bound.campus_id,'READ');PERFORM department_master.snapshot(p_actor,bound.managing_department_id);END LOOP;
 RETURN jsonb_build_object('id',u.id,'departmentId',u.department_id,'codes',coalesce((SELECT jsonb_agg(DISTINCT visible.facts->'nursingCode') FROM care_organization.nursing_version visible WHERE visible.unit_id=u.id AND visible.recorded_at<=p_asof),'[]'),'versions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'number',v.number::text,'action',v.action,'validFrom',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordedAt',to_char(v.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'facts',v.facts,'reason',v.reason,'changeId',v.change_id) ORDER BY v.number) FROM care_organization.nursing_version v WHERE v.unit_id=u.id AND v.recorded_at<=p_asof),'[]'),'bindings',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'campusId',b.campus_id,'managingDepartmentId',b.managing_department_id,'scope',b.scope,'versions',(SELECT jsonb_agg(jsonb_build_object('id',v.id,'number',v.number::text,'validFrom',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordedAt',to_char(v.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'binding',v.binding,'dependencies',v.dependencies,'changeId',v.change_id) ORDER BY v.number) FROM care_organization.nursing_binding_version v WHERE v.binding_id=b.id AND v.recorded_at<=p_asof)) ORDER BY b.id) FROM care_organization.nursing_unit_binding b WHERE b.unit_id=u.id AND EXISTS(SELECT 1 FROM care_organization.nursing_binding_version visible WHERE visible.binding_id=b.id AND visible.recorded_at<=p_asof)),'[]'));
END $function$
;
CREATE OR REPLACE FUNCTION care_organization.nursing_snapshot_version(p_actor text, p_id uuid, p_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE at_r timestamp;BEGIN PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');SELECT recorded_at INTO at_r FROM care_organization.nursing_version WHERE unit_id=p_id AND number::text=p_version;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;RETURN care_organization.nursing_snapshot_at(p_actor,p_id,at_r);END $function$
;
CREATE OR REPLACE FUNCTION care_organization.nursing_list(p_actor text, p_scope text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE u record;result jsonb:='[]';BEGIN
 IF p_scope NOT IN ('NORTH','SOUTH') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 FOR u IN SELECT DISTINCT unit_id FROM care_organization.nursing_unit_binding WHERE scope=p_scope ORDER BY unit_id LOOP result:=result||jsonb_build_array(care_organization.nursing_snapshot(p_actor,u.unit_id));END LOOP;RETURN result;
END $function$
;
CREATE OR REPLACE FUNCTION care_organization.nursing_list_at(p_actor text, p_scope text, p_asof timestamp without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE u record;result jsonb:='[]';BEGIN
 IF p_scope NOT IN ('NORTH','SOUTH') OR p_asof IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 FOR u IN SELECT DISTINCT b.unit_id FROM care_organization.nursing_unit_binding b WHERE b.scope=p_scope AND EXISTS(SELECT 1 FROM care_organization.nursing_binding_version v WHERE v.binding_id=b.id AND v.recorded_at<=p_asof) ORDER BY b.unit_id LOOP result:=result||jsonb_build_array(care_organization.nursing_snapshot_at(p_actor,u.unit_id,p_asof));END LOOP;RETURN result;
END $function$
;
CREATE OR REPLACE FUNCTION care_organization.nursing_local_time(p_value text)
 RETURNS timestamp without time zone
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE result timestamp;BEGIN IF p_value IS NULL OR p_value !~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?$' THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED';END IF;BEGIN result:=p_value::timestamp;EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED';END;RETURN result;END $function$
;
CREATE OR REPLACE FUNCTION care_organization.nursing_closed(p_value jsonb, p_keys text[])
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR p_value-p_keys<>'{}'::jsonb OR NOT p_value ?& p_keys THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;END $function$
;
CREATE OR REPLACE FUNCTION care_organization.nursing_validate_bindings(p_unit uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE a record;b record;property record;closing timestamp;spans tsmultirange;ending timestamp;BEGIN
 SELECT min(valid_from) INTO closing FROM care_organization.nursing_version WHERE unit_id=p_unit AND action='SUSPEND';
 FOR a IN SELECT DISTINCT ON(binding_id) v.* FROM care_organization.nursing_binding_version v JOIN care_organization.nursing_unit_binding u ON u.id=v.binding_id WHERE u.unit_id=p_unit ORDER BY binding_id,number DESC LOOP
  FOR b IN SELECT DISTINCT ON(binding_id) v.* FROM care_organization.nursing_binding_version v JOIN care_organization.nursing_unit_binding u ON u.id=v.binding_id WHERE u.unit_id=p_unit AND binding_id<>a.binding_id ORDER BY binding_id,number DESC LOOP
   IF tsrange(a.valid_from,a.valid_to,'[)')&&tsrange(b.valid_from,b.valid_to,'[)') THEN RAISE EXCEPTION 'NURSING_BINDING_CONFLICT';END IF;
  END LOOP;
 END LOOP;
 SELECT range_agg(tsrange(v.valid_from,v.valid_to,'[)')) INTO spans FROM (SELECT DISTINCT ON(binding_id) bv.* FROM care_organization.nursing_binding_version bv JOIN care_organization.nursing_unit_binding ub ON ub.id=bv.binding_id WHERE ub.unit_id=p_unit ORDER BY binding_id,number DESC) v;
 FOR property IN SELECT * FROM care_organization.nursing_version WHERE unit_id=p_unit AND action IN ('CREATE','REVISE') LOOP
  ending:=least(property.valid_to,closing);IF ending IS NOT NULL AND ending<=property.valid_from THEN CONTINUE;END IF;
  IF NOT coalesce(spans @> tsrange(property.valid_from,ending,'[)'),false) THEN RAISE EXCEPTION 'NURSING_BINDING_REQUIRED';END IF;
 END LOOP;
END $function$
;
CREATE OR REPLACE FUNCTION care_organization.nursing_mutate(p_ticket text, p_signature text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE t jsonb:=p_ticket::jsonb;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;actor text:=t->>'actor';op text:=t->>'operation';identity text;r care_organization.nursing_input;j jsonb;verify care_organization.nursing_verification;c jsonb;approved_by text;frozen care_organization.nursing_apply_binding;change care_organization.nursing_change;previous care_organization.nursing_version;at_version care_organization.nursing_version;w jsonb;bc jsonb;target uuid;bid uuid;bp care_organization.nursing_binding_version;br care_organization.nursing_unit_binding;u care_organization.nursing_unit;results jsonb:='[]';from_at timestamp;to_at timestamp;record_at timestamp:=timezone('Asia/Shanghai',clock_timestamp());root_id uuid;campus uuid;campuses uuid[];campus_state jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.nursing_write_authority WHERE singleton;
 IF secret IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF op='STAGE' THEN
  PERFORM care_organization.nursing_closed(t,ARRAY['operation','actor','transaction','requestId','jobId','revisionId','campus','campusIds','digest','envelope']);
  SELECT array_agg(value::uuid) INTO campuses FROM jsonb_array_elements_text(t->'campusIds');IF cardinality(campuses) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  FOREACH campus IN ARRAY campuses LOOP identity:=care_organization.nursing_authorize(actor,campus,'WRITE');PERFORM care_organization.nursing_authorize(actor,campus,'READ_RESTRICTED');END LOOP;
  SELECT * INTO r FROM care_organization.nursing_input WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF r.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);END IF;
  j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',t->>'jobId'));
  IF j->>'submitterIdentity' IS DISTINCT FROM identity OR j->>'currentRevisionId' IS DISTINCT FROM t->>'revisionId' OR j->'contract'->>'dataset'<>'ORG09' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
  INSERT INTO care_organization.nursing_input(job_id,job_revision,maker,identity_code,request_id,digest,campus_ids,scope,envelope) VALUES((j->>'id')::uuid,(j->>'currentRevisionId')::uuid,actor,identity,(t->>'requestId')::uuid,t->>'digest',campuses,t->>'campus',t->'envelope') RETURNING * INTO r;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'NURSING_INPUT','ORG09_CORE',r.digest);RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);
 END IF;
 r:=jsonb_populate_record(NULL::care_organization.nursing_input,care_organization.nursing_input_read(actor,(t->>'inputId')::uuid,CASE WHEN op='VERIFY' THEN 'VERIFY' ELSE 'WRITE' END));
 IF EXISTS(SELECT 1 FROM care_organization.nursing_withdrawal WHERE input_id=r.id) THEN RAISE EXCEPTION 'INPUT_WITHDRAWN';END IF; IF op='VERIFY' THEN
  PERFORM care_organization.nursing_closed(t,ARRAY['operation','actor','transaction','inputId','inputDigest','requestId','digest','envelope']);
  identity:=vnext_control.authorize(actor,'SYNTHETIC','REVIEW');IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;IF r.digest IS DISTINCT FROM t->>'inputDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  SELECT * INTO verify FROM care_organization.nursing_verification WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF verify.input_id<>r.id OR verify.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('verificationId',verify.id);END IF;
  IF EXISTS(SELECT 1 FROM care_organization.nursing_change WHERE input_id=r.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
  INSERT INTO care_organization.nursing_verification(input_id,number,actor,identity_code,request_id,digest,envelope) VALUES(r.id,(SELECT coalesce(max(number),0)+1 FROM care_organization.nursing_verification WHERE input_id=r.id),actor,identity,(t->>'requestId')::uuid,t->>'digest',t->'envelope') RETURNING * INTO verify;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'NURSING_VERIFY','RECEIVING_BASIS',verify.digest);RETURN jsonb_build_object('verificationId',verify.id);
 END IF;
 IF op NOT IN ('FREEZE','APPLY') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 c:=governance_catalog.apply_record(actor,'READ_CANDIDATE',jsonb_build_object('candidateId',(t->>'candidateId')::uuid));
 IF c->>'digest' IS DISTINCT FROM t->>'digest' OR c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 IF op='FREEZE' THEN
  PERFORM care_organization.nursing_closed(t,ARRAY['operation','actor','transaction','inputId','writes','writesDigest','candidateId','digest']);
  INSERT INTO care_organization.nursing_apply_binding VALUES((c->>'id')::uuid,r.id,c->>'digest',t->>'writesDigest',encode(sha256(convert_to((t->'writes')::text,'UTF8')),'hex'));RETURN '{}';
 END IF;
 PERFORM care_organization.nursing_closed(t,ARRAY['operation','actor','transaction','inputId','writes','writeIndex','writesDigest','candidateId','digest']);
 approved_by:=c->>'approvedBy';IF approved_by IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;PERFORM governance_catalog.apply_record(approved_by,'CHECK_APPROVAL',jsonb_build_object('candidateId',(c->>'id')::uuid));
 FOREACH campus IN ARRAY r.campus_ids LOOP identity:=care_organization.nursing_authorize(approved_by,campus,'REVIEW');IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;END LOOP;
 SELECT * INTO frozen FROM care_organization.nursing_apply_binding WHERE candidate_id=(c->>'id')::uuid;
 IF NOT FOUND OR frozen.input_id<>r.id OR frozen.candidate_digest IS DISTINCT FROM t->>'digest' OR frozen.writes_digest IS DISTINCT FROM t->>'writesDigest' OR ((t->>'writeIndex')::integer=1 AND frozen.writes_hash IS DISTINCT FROM encode(sha256(convert_to((t->'writes')::text,'UTF8')),'hex')) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 SELECT * INTO change FROM care_organization.nursing_change WHERE input_id=r.id;
 IF FOUND THEN IF change.candidate_id<>(c->>'id')::uuid OR change.digest IS DISTINCT FROM t->>'writesDigest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN change.results->((t->>'writeIndex')::integer-1);END IF;
 j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));IF r.job_revision IS DISTINCT FROM (j->>'currentRevisionId')::uuid THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 IF jsonb_typeof(t->'writes') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'writes') NOT BETWEEN 1 AND 100 OR (t->>'writeIndex')::integer<>1 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;IF (SELECT sum(1+jsonb_array_length(expanded.entry->'bindingChanges')) FROM jsonb_array_elements(t->'writes') AS expanded(entry))>100 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;root_id:=uuidv7();
 FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP
  PERFORM care_organization.nursing_closed(w,ARRAY['key','targetId','expectedHead','action','validFrom','validTo','facts','binding','bindingChanges','reason','sourceRow','scope']);
  from_at:=care_organization.nursing_local_time(w->>'validFrom');to_at:=CASE WHEN w->>'validTo' IS NULL THEN NULL ELSE care_organization.nursing_local_time(w->>'validTo') END;IF to_at IS NOT NULL AND to_at<=from_at THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
  IF w->>'action'='CREATE' THEN
   IF w->>'targetId' IS NOT NULL OR w->>'expectedHead' IS NOT NULL OR jsonb_array_length(w->'bindingChanges')<>1 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
   INSERT INTO care_organization.nursing_unit(department_id) VALUES((w->'binding'->'department'->>'id')::uuid) RETURNING * INTO u;target:=u.id;previous:=NULL;
  ELSE
   target:=(w->>'targetId')::uuid;PERFORM care_organization.nursing_snapshot(actor,target);SELECT * INTO u FROM care_organization.nursing_unit WHERE id=target;SELECT * INTO previous FROM care_organization.nursing_version WHERE unit_id=target ORDER BY number DESC LIMIT 1;
   IF previous.number::text IS DISTINCT FROM w->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;IF EXISTS(SELECT 1 FROM care_organization.nursing_version WHERE unit_id=target AND action='SUSPEND' AND (to_at IS NULL OR valid_from<to_at)) THEN RAISE EXCEPTION 'NURSING_SUSPENDED';END IF;
  END IF;
  IF w->>'action'='REVISE' AND jsonb_array_length(w->'bindingChanges')<>0 THEN RAISE EXCEPTION 'NURSING_REVISE_INVALID';END IF;
  IF w->>'action' NOT IN ('CREATE','REVISE','REBIND','SUSPEND') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF w->>'action'='REBIND' THEN
   SELECT * INTO at_version FROM care_organization.nursing_version WHERE unit_id=target AND action IN ('CREATE','REVISE') AND valid_from<=from_at AND (valid_to IS NULL OR from_at<valid_to) ORDER BY number DESC LIMIT 1;
   IF at_version.id IS NULL OR ((w->'facts')-ARRAY['source','contractVersionId','managementBasis']) IS DISTINCT FROM (at_version.facts-ARRAY['source','contractVersionId','managementBasis']) THEN RAISE EXCEPTION 'NURSING_REBIND_INVALID';END IF;
  END IF;
  IF w->>'action'='SUSPEND' THEN
   SELECT * INTO at_version FROM care_organization.nursing_version WHERE unit_id=target AND action IN ('CREATE','REVISE') AND valid_from<=from_at AND (valid_to IS NULL OR from_at<=valid_to) ORDER BY number DESC LIMIT 1;
   IF to_at IS NOT NULL OR at_version.id IS NULL OR ((w->'facts')-ARRAY['source','contractVersionId','managementBasis']) IS DISTINCT FROM (at_version.facts-ARRAY['source','contractVersionId','managementBasis']) THEN RAISE EXCEPTION 'NURSING_CLOSURE_EXPANSION';END IF;
  END IF;
  IF w->>'action'='CREATE' AND EXISTS(SELECT 1 FROM care_organization.nursing_version WHERE action='CREATE' AND facts->'source'->>'sourceSystemId'=w->'facts'->'source'->>'sourceSystemId' AND facts->'source'->>'sourceAlias'=w->'facts'->'source'->>'sourceAlias') THEN RAISE EXCEPTION 'NURSING_SOURCE_ALREADY_REGISTERED';END IF;
  IF EXISTS(SELECT 1 FROM care_organization.nursing_code WHERE code=w->'facts'->>'nursingCode' AND unit_id<>target) THEN RAISE EXCEPTION 'NURSING_CODE_CONFLICT';END IF;
  INSERT INTO care_organization.nursing_code VALUES(w->'facts'->>'nursingCode',target) ON CONFLICT DO NOTHING;
  FOR bc IN SELECT value FROM jsonb_array_elements(w->'bindingChanges') LOOP
   PERFORM care_organization.nursing_closed(bc,ARRAY['id','expectedHead','validFrom','validTo','binding','dependencies']);
   IF bc->'binding'->'department'->>'owner'<>'department-master' OR bc->'binding'->'campus'->>'owner'<>'organization-master/campus' THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
   IF bc->>'id' IS NULL THEN PERFORM care_organization.nursing_admission(actor,bc->'binding',care_organization.nursing_local_time(bc->>'validFrom'),CASE WHEN bc->>'validTo' IS NULL THEN NULL ELSE care_organization.nursing_local_time(bc->>'validTo') END,record_at);END IF;
   campus:=(bc->'binding'->'campus'->>'id')::uuid;PERFORM care_organization.nursing_authorize(actor,campus,'WRITE');PERFORM care_organization.nursing_authorize(approved_by,campus,'REVIEW');campus_state:=organization_master.campus_snapshot(actor,campus);
   IF bc->>'id' IS NULL THEN
    IF bc->>'expectedHead' IS NOT NULL OR w->>'action' NOT IN ('CREATE','REBIND') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
    INSERT INTO care_organization.nursing_unit_binding(unit_id,campus_id,managing_department_id,scope) VALUES(target,campus,(bc->'binding'->'department'->>'id')::uuid,campus_state->>'scope') RETURNING * INTO br;bid:=br.id;bp:=NULL;
   ELSE
    bid:=(bc->>'id')::uuid;SELECT * INTO br FROM care_organization.nursing_unit_binding WHERE id=bid;SELECT * INTO bp FROM care_organization.nursing_binding_version WHERE binding_id=bid ORDER BY number DESC LIMIT 1;
    IF br.unit_id IS DISTINCT FROM target OR br.campus_id IS DISTINCT FROM campus OR br.managing_department_id::text IS DISTINCT FROM bc->'binding'->'department'->>'id' OR bp.number::text IS DISTINCT FROM bc->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
    IF w->>'action'='REVISE' AND (bc->'binding' IS DISTINCT FROM bp.binding OR care_organization.nursing_local_time(bc->>'validFrom')<>bp.valid_from) THEN RAISE EXCEPTION 'NURSING_REVISE_INVALID';END IF;
    IF w->>'action'='SUSPEND' AND (care_organization.nursing_local_time(bc->>'validFrom')<>bp.valid_from OR bc->>'validTo' IS NULL OR care_organization.nursing_local_time(bc->>'validTo')>coalesce(bp.valid_to,'infinity'::timestamp) OR bc->'binding' IS DISTINCT FROM bp.binding) THEN RAISE EXCEPTION 'NURSING_CLOSURE_EXPANSION';END IF;
   END IF;
   INSERT INTO care_organization.nursing_binding_version(binding_id,number,valid_from,valid_to,binding,dependencies,change_id,recorded_at) VALUES(bid,coalesce(bp.number,0)+1,care_organization.nursing_local_time(bc->>'validFrom'),CASE WHEN bc->>'validTo' IS NULL THEN NULL ELSE care_organization.nursing_local_time(bc->>'validTo') END,bc->'binding',bc->'dependencies',root_id,record_at);
  END LOOP;
  campus_state:=organization_master.campus_snapshot(actor,(w->'binding'->'campus'->>'id')::uuid);
  IF campus_state->>'scope' IS DISTINCT FROM r.scope OR w->>'scope' IS DISTINCT FROM r.scope THEN RAISE EXCEPTION 'NURSING_ANCHOR_MISMATCH';END IF;
  IF length(btrim(coalesce(w->'facts'->'source'->>'approvalReference','')))=0 THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
  IF w->>'action' IN ('CREATE','REVISE','REBIND') THEN
   PERFORM governance_catalog.nursing_source_reference(actor,(w->'facts'->'source'->>'sourceSystemId')::uuid,(j->'contract'->'definition'->>'sourceVersionId')::uuid);
   PERFORM governance_catalog.nursing_source_coverage(actor,(w->'facts'->'source'->>'sourceSystemId')::uuid,from_at,to_at,record_at);
   PERFORM governance_catalog.nursing_source_coverage(approved_by,(w->'facts'->'source'->>'sourceSystemId')::uuid,from_at,to_at,record_at);
   PERFORM care_organization.nursing_admission(actor,w->'binding',from_at,to_at,record_at);
  END IF;
  INSERT INTO care_organization.nursing_version(unit_id,number,action,valid_from,valid_to,facts,reason,change_id,recorded_at) VALUES(target,coalesce(previous.number,0)+1,w->>'action',from_at,to_at,w->'facts',w->>'reason',root_id,record_at);
  PERFORM care_organization.nursing_validate_bindings(target);
  results:=results||jsonb_build_array(jsonb_build_object('owner','care-organization/nursing','id',target,'version',(coalesce(previous.number,0)+1)::text,'source',jsonb_build_object('dataset','ORG09','row',(w->>'sourceRow')::integer,'step',w->>'action')));
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,target,'NURSING_'||(w->>'action'),'APPROVED_NURSING_COMMAND',t->>'writesDigest');
 END LOOP;
 INSERT INTO care_organization.nursing_change VALUES(root_id,r.id,(c->>'id')::uuid,t->>'writesDigest',results,record_at);RETURN results->0;
END $function$
;
CREATE OR REPLACE FUNCTION care_organization.nursing_audit_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(coalesce(NEW.actor,OLD.actor),coalesce(NEW.campus_id,OLD.campus_id),'NURSING_AUTHORIZATION',TG_OP,encode(sha256(convert_to(coalesce(to_jsonb(NEW),to_jsonb(OLD))::text,'UTF8')),'hex'));RETURN coalesce(NEW,OLD);END $function$
;
CREATE OR REPLACE FUNCTION care_organization.nursing_withdraw(p_ticket text, p_signature text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE t jsonb:=p_ticket::jsonb;k bytea;i integer;ip bytea:=decode(repeat('36',64),'hex');op bytea:=decode(repeat('5c',64),'hex');r care_organization.nursing_input;prior care_organization.nursing_withdrawal;BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM care_organization.nursing_closed(t,ARRAY['actor','transaction','inputId','requestId']);SELECT decode(key_hex,'hex') INTO k FROM vnext_control.nursing_write_authority;
 IF k IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;FOR i IN 0..31 LOOP ip:=set_byte(ip,i,get_byte(ip,i)#get_byte(k,i));op:=set_byte(op,i,get_byte(op,i)#get_byte(k,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(op||sha256(ip||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 r:=jsonb_populate_record(NULL::care_organization.nursing_input,care_organization.nursing_input_read(t->>'actor',(t->>'inputId')::uuid,'WRITE'));
 IF r.identity_code IS DISTINCT FROM vnext_control.authorize(t->>'actor','SYNTHETIC','WRITE') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF EXISTS(SELECT 1 FROM care_organization.nursing_change WHERE input_id=r.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
 SELECT * INTO prior FROM care_organization.nursing_withdrawal WHERE input_id=r.id;IF FOUND THEN IF prior.request_id::text IS DISTINCT FROM t->>'requestId' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;ELSE
 INSERT INTO care_organization.nursing_withdrawal(input_id,actor,request_id) VALUES(r.id,t->>'actor',(t->>'requestId')::uuid);INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(t->>'actor',r.id,'NURSING_WITHDRAW','EXPLICIT_WITHDRAWAL',r.digest);END IF;
 RETURN jsonb_build_object('inputId',r.id,'status','WITHDRAWN');
END $function$
;
CREATE OR REPLACE FUNCTION care_organization.nursing_code_conflict(p_actor text, p_code text, p_target uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');RETURN EXISTS(SELECT 1 FROM care_organization.nursing_code WHERE code=p_code AND (p_target IS NULL OR unit_id<>p_target));END $function$
;
CREATE OR REPLACE FUNCTION care_organization.nursing_current_end(p_unit uuid)
 RETURNS timestamp without time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE ending timestamp;closing timestamp;BEGIN
 SELECT CASE WHEN bool_or(valid_to IS NULL) THEN NULL ELSE max(valid_to) END INTO ending FROM care_organization.nursing_version WHERE unit_id=p_unit AND action IN ('CREATE','REVISE');
 SELECT min(valid_from) INTO closing FROM care_organization.nursing_version WHERE unit_id=p_unit AND action='SUSPEND';RETURN least(ending,closing);
END $function$
;

CREATE FUNCTION department_master.nursing_management_coverage(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE admission jsonb;parts jsonb;spans tsmultirange;r timestamp:=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));BEGIN
 PERFORM department_master.snapshot(p_actor,p_id);admission:=department_master.lifecycle_admission(p_actor,p_id,p_from,p_to,r);
 WITH assertions AS (
 SELECT v.id,v.number,unnest(tsmultirange(tsrange(v.valid_from,v.valid_to,'[)'))-coalesce((SELECT range_agg(tsrange(n.valid_from,n.valid_to,'[)')) FROM department_master.version n WHERE n.department_id=p_id AND n.number>v.number AND n.recorded_at<=r),'{}'::tsmultirange)) period
 FROM department_master.version v WHERE v.department_id=p_id AND v.recorded_at<=r),pieces AS (
 SELECT a.id,a.number,a.period*tsrange(p_from,p_to,'[)')*tsrange((l.value->>'from')::timestamp,(l.value->>'to')::timestamp,'[)') period FROM assertions a CROSS JOIN jsonb_array_elements(admission->'parts') l)
 SELECT coalesce(jsonb_agg(jsonb_build_object('versionId',id,'version',number::text,'from',to_char(lower(period),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(upper(period),'YYYY-MM-DD"T"HH24:MI:SS.US')) ORDER BY lower(period),number),'[]'),range_agg(period) INTO parts,spans FROM pieces WHERE NOT isempty(period);
 IF admission->>'covered'<>'true' OR NOT coalesce(spans @> tsrange(p_from,p_to,'[)'),false) THEN RAISE EXCEPTION 'NURSING_DEPARTMENT_NOT_ADMITTED';END IF;
 RETURN jsonb_build_object('id',p_id,'covered',true,'parts',parts);
END $$;
CREATE FUNCTION organization_master.nursing_campus_coverage(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb;parts jsonb;spans tsmultirange;terminal timestamp;r timestamp:=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));BEGIN
 c:=organization_master.campus_snapshot(p_actor,p_id);
 WITH assertions AS (
 SELECT e.id,e.number,unnest(tsmultirange(tsrange(e.valid_from,e.valid_to,'[)'))-coalesce((SELECT range_agg(tsrange(n.valid_from,n.valid_to,'[)')) FROM organization_master.campus_event n JOIN organization_master.campus_version nv ON nv.event_id=n.id WHERE n.campus_id=p_id AND n.number>e.number AND n.recorded_at<=r),'{}'::tsmultirange)) period
 FROM organization_master.campus_event e JOIN organization_master.campus_version v ON v.event_id=e.id WHERE e.campus_id=p_id AND e.recorded_at<=r),pieces AS (SELECT id,number,period*tsrange(p_from,p_to,'[)') period FROM assertions)
 SELECT coalesce(jsonb_agg(jsonb_build_object('versionId',id,'version',number::text,'from',to_char(lower(period),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(upper(period),'YYYY-MM-DD"T"HH24:MI:SS.US')) ORDER BY lower(period),number),'[]'),range_agg(period) INTO parts,spans FROM pieces WHERE NOT isempty(period);
 SELECT min(e.valid_from) INTO terminal FROM organization_master.campus_event e JOIN organization_master.campus_operation o ON o.event_id=e.id WHERE e.campus_id=p_id AND e.recorded_at<=r AND o.state='RETIRED';
 IF NOT coalesce(spans @> tsrange(p_from,p_to,'[)'),false) OR (terminal IS NOT NULL AND (p_to IS NULL OR p_to>terminal)) THEN RAISE EXCEPTION 'NURSING_CAMPUS_NOT_ADMITTED';END IF;
 RETURN jsonb_build_object('id',p_id,'scope',c->>'scope','covered',true,'parts',parts,'operatingPermission','NOT_EVALUABLE');
END $$;
REVOKE ALL ON FUNCTION department_master.nursing_management_coverage(text,uuid,timestamp,timestamp,timestamp),organization_master.nursing_campus_coverage(text,uuid,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
CREATE FUNCTION care_organization.nursing_admission(p_actor text,p_binding jsonb,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d jsonb;c jsonb;r timestamp:=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));BEGIN
 PERFORM care_organization.nursing_closed(p_binding,ARRAY['department','campus']);PERFORM care_organization.nursing_closed(p_binding->'department',ARRAY['owner','id']);PERFORM care_organization.nursing_closed(p_binding->'campus',ARRAY['owner','id']);
 IF p_binding->'department'->>'owner'<>'department-master' OR p_binding->'campus'->>'owner'<>'organization-master/campus' OR p_from IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 d:=department_master.nursing_management_coverage(p_actor,(p_binding->'department'->>'id')::uuid,p_from,p_to,r);
 c:=organization_master.nursing_campus_coverage(p_actor,(p_binding->'campus'->>'id')::uuid,p_from,p_to,r);
 RETURN jsonb_build_object('scope',c->>'scope','department',d,'campus',c);
END $$;
CREATE FUNCTION care_organization.nursing_reference_access(p_actor text,p_ref jsonb,p_permission text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h jsonb;b jsonb;BEGIN h:=care_organization.nursing_snapshot(p_actor,(p_ref->>'id')::uuid);
 IF NOT (EXISTS(SELECT 1 FROM jsonb_array_elements(h->'versions') visible WHERE visible->>'id'=p_ref->>'versionId') OR EXISTS(SELECT 1 FROM jsonb_array_elements(h->'bindings') binding_row CROSS JOIN jsonb_array_elements(binding_row->'versions') bv WHERE bv->>'id'=p_ref->>'versionId')) OR NOT (EXISTS(SELECT 1 FROM jsonb_array_elements(h->'versions') visible WHERE visible->>'id'=p_ref->>'currentVersionId') OR EXISTS(SELECT 1 FROM jsonb_array_elements(h->'bindings') binding_row CROSS JOIN jsonb_array_elements(binding_row->'versions') bv WHERE bv->>'id'=p_ref->>'currentVersionId')) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(h->'bindings') LOOP PERFORM care_organization.nursing_authorize(p_actor,(b->>'campusId')::uuid,p_permission);END LOOP;END $$;
CREATE TRIGGER nursing_access_lock BEFORE INSERT OR UPDATE OR DELETE ON care_organization.nursing_access FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER nursing_access_audit AFTER INSERT OR UPDATE OR DELETE ON care_organization.nursing_access FOR EACH ROW EXECUTE FUNCTION care_organization.nursing_audit_access();
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['input','verification','unit','code','change','version','unit_binding','binding_version','apply_binding'] LOOP EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON care_organization.nursing_%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',tab);END LOOP;
 FOREACH tab IN ARRAY ARRAY['access','input','verification','unit','code','change','version','unit_binding','binding_version','apply_binding'] LOOP EXECUTE format('ALTER TABLE care_organization.nursing_%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('REVOKE ALL ON care_organization.nursing_%I FROM PUBLIC,hdi_prototype',tab);END LOOP;
END $$;
REVOKE ALL ON vnext_control.nursing_write_authority FROM PUBLIC,hdi_prototype;
DO $$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='care_organization' AND p.proname LIKE 'nursing_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,hdi_prototype',f.name);END LOOP;END $$;

CREATE UNIQUE INDEX nursing_source_identity ON care_organization.nursing_version((facts->'source'->>'sourceSystemId'),(facts->'source'->>'sourceAlias')) WHERE action='CREATE';
CREATE FUNCTION care_organization.nursing_source_conflict(p_actor text,p_source uuid,p_alias text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');RETURN EXISTS(SELECT 1 FROM care_organization.nursing_version WHERE action='CREATE' AND facts->'source'->>'sourceSystemId'=p_source::text AND facts->'source'->>'sourceAlias'=p_alias);END $$;
REVOKE ALL ON FUNCTION care_organization.nursing_source_conflict(text,uuid,text) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.nursing_source_coverage(p_actor text,p_source uuid,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pin uuid;r timestamp:=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));BEGIN
 IF p_from IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 SELECT s.version_id INTO pin FROM governance_catalog.definition_spans(p_source,r) s WHERE governance_catalog.source_valid_spans(s.version_id,r) @> tsrange(p_from,p_to,'[)');
 IF pin IS NULL THEN PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',p_source);RAISE EXCEPTION 'NURSING_SOURCE_NOT_ADMITTED';END IF;
 PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',p_source,pin);
 RETURN jsonb_build_object('sourceId',p_source,'versionId',pin,'covered',true);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.nursing_source_coverage(text,uuid,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
CREATE FUNCTION governance_catalog.nursing_source_reference(p_actor text,p_source uuid,p_version uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',p_source,p_version);
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_version AND o.id=p_source AND o.kind='SOURCE' AND o.scope='SYNTHETIC') THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.nursing_source_reference(text,uuid,uuid) FROM PUBLIC,hdi_prototype;
