SELECT pg_advisory_xact_lock(901002);
CREATE SCHEMA location_master;
-- Code generation may inspect qualified names; no domain data or function privilege.
GRANT USAGE ON SCHEMA location_master TO hdi_prototype;
CREATE TABLE vnext_control.location_write_authority(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),key_hex text NOT NULL CHECK(key_hex ~ '^[a-f0-9]{64}$'));
CREATE TABLE location_master.access(actor text NOT NULL REFERENCES vnext_control.actor(code),campus_id uuid NOT NULL REFERENCES organization_master.campus(id),scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')),permission text NOT NULL CHECK(permission IN ('READ','WRITE','REVIEW','VERIFY','READ_RESTRICTED')),PRIMARY KEY(actor,campus_id,scope,permission));
CREATE TABLE location_master.input(id uuid PRIMARY KEY DEFAULT uuidv7(),revision uuid NOT NULL DEFAULT uuidv7(),job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),job_revision uuid NOT NULL REFERENCES governance_catalog.import_input_revision(id),maker text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),campus_id uuid NOT NULL REFERENCES organization_master.campus(id),scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')),envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(job_id,job_revision));
CREATE TABLE location_master.verification(id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL REFERENCES location_master.input(id),number bigint NOT NULL CHECK(number>0),actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL,envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(input_id,number));
CREATE TABLE location_master.location(id uuid PRIMARY KEY DEFAULT uuidv7(),campus_id uuid NOT NULL REFERENCES organization_master.campus(id),scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')));
CREATE TABLE location_master.code(campus_id uuid NOT NULL REFERENCES organization_master.campus(id),code text NOT NULL CHECK(length(code) BETWEEN 1 AND 256 AND code ~ '\S'),location_id uuid NOT NULL REFERENCES location_master.location(id),PRIMARY KEY(campus_id,code));
CREATE TABLE location_master.change(id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL UNIQUE REFERENCES location_master.input(id),candidate_id uuid NOT NULL UNIQUE REFERENCES governance_catalog.apply_candidate(id),digest text NOT NULL,results jsonb NOT NULL,splits jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()));
CREATE TABLE location_master.apply_binding(candidate_id uuid PRIMARY KEY REFERENCES governance_catalog.apply_candidate(id),input_id uuid NOT NULL REFERENCES location_master.input(id),candidate_digest text NOT NULL,writes_digest text NOT NULL,writes_hash text NOT NULL CHECK(writes_hash ~ '^[a-f0-9]{64}$'));
CREATE TABLE location_master.version(id uuid PRIMARY KEY DEFAULT uuidv7(),location_id uuid NOT NULL REFERENCES location_master.location(id),number bigint NOT NULL CHECK(number>0),action text NOT NULL CHECK(action IN ('CREATE','REVISE','MOVE_CONTAINMENT','CLOSE')),valid_from timestamp NOT NULL,valid_to timestamp,parent_id uuid REFERENCES location_master.location(id),facts jsonb NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),change_id uuid NOT NULL REFERENCES location_master.change(id) DEFERRABLE INITIALLY DEFERRED,recorded_at timestamp NOT NULL,UNIQUE(location_id,number),CHECK(valid_to IS NULL OR valid_to>valid_from),CHECK(action<>'CLOSE' OR valid_to IS NULL));
CREATE INDEX location_version_window ON location_master.version(location_id,valid_from,recorded_at);
CREATE FUNCTION location_master.authorize(p_actor text,p_campus uuid,p_scope text,p_permission text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF p_permission NOT IN ('READ','WRITE','REVIEW','VERIFY','READ_RESTRICTED') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC',CASE WHEN p_permission IN ('REVIEW','VERIFY') THEN 'REVIEW' WHEN p_permission='WRITE' THEN 'WRITE' ELSE 'READ' END);
 IF NOT EXISTS(SELECT 1 FROM location_master.access WHERE actor=p_actor AND campus_id=p_campus AND scope=p_scope AND permission=p_permission) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 RETURN identity;
END $$;
CREATE FUNCTION location_master.input_read(p_actor text,p_id uuid,p_permission text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r location_master.input;v location_master.verification;BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 SELECT * INTO r FROM location_master.input WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM location_master.authorize(p_actor,r.campus_id,r.scope,p_permission);PERFORM location_master.authorize(p_actor,r.campus_id,r.scope,'READ');
 PERFORM governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));
 IF p_permission='READ_RESTRICTED' THEN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'LOCATION_READ_RESTRICTED','ORG12_SOURCE',r.digest);END IF;
 SELECT * INTO v FROM location_master.verification WHERE input_id=r.id ORDER BY number DESC LIMIT 1;
 RETURN to_jsonb(r)||jsonb_build_object('verification',CASE WHEN v.id IS NULL THEN NULL ELSE to_jsonb(v) END);
END $$;
CREATE FUNCTION location_master.read(p_actor text,p_campus uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s text;BEGIN
 SELECT scope INTO s FROM location_master.access WHERE actor=p_actor AND campus_id=p_campus AND permission='READ' LIMIT 1;IF s IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM location_master.authorize(p_actor,p_campus,s,'READ');
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'campusId',l.campus_id,'scope',l.scope,'codes',coalesce((SELECT jsonb_agg(c.code ORDER BY c.code) FROM location_master.code c WHERE c.location_id=l.id),'[]'),'versions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'number',v.number::text,'action',v.action,'validFrom',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',CASE WHEN v.valid_to IS NULL THEN NULL ELSE to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US') END,'recordedAt',to_char(v.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'facts',v.facts,'reason',v.reason,'changeId',v.change_id) ORDER BY v.number) FROM location_master.version v WHERE v.location_id=l.id),'[]')) ORDER BY l.id) FROM location_master.location l WHERE l.campus_id=p_campus AND l.scope=s),'[]');
END $$;
CREATE FUNCTION location_master.job_read(p_actor text,p_input uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE input jsonb;BEGIN
 input:=location_master.input_read(p_actor,p_input,'READ_RESTRICTED');
 RETURN governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',input->>'job_id'));
END $$;
CREATE FUNCTION location_master.snapshot(p_actor text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c uuid;result jsonb;BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 SELECT l.campus_id INTO c FROM location_master.location l WHERE l.id=p_id AND EXISTS(SELECT 1 FROM location_master.access a WHERE a.actor=p_actor AND a.campus_id=l.campus_id AND a.scope=l.scope AND a.permission='READ');IF c IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT value INTO result FROM jsonb_array_elements(location_master.read(p_actor,c)) WHERE value->>'id'=p_id::text;
 IF result IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;RETURN result;
END $$;
CREATE FUNCTION location_master.closed(p_value jsonb,p_keys text[]) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR p_value-p_keys<>'{}'::jsonb OR NOT p_value ?& p_keys THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;END $$;
CREATE FUNCTION location_master.local_time(p_value text) RETURNS timestamp LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE result timestamp;BEGIN
 IF p_value IS NULL OR p_value !~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?$' THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED';END IF;
 BEGIN result:=p_value::timestamp;EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED';END;
 RETURN result;
END $$;
-- Independent SQL oracle over the whole final graph, including future assertions.
CREATE FUNCTION location_master.validate_tree(p_campus uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE at timestamp;n record;p record;cursor_id uuid;visited uuid[];roots integer;BEGIN
 FOR at IN SELECT DISTINCT t FROM (SELECT valid_from t FROM location_master.version v JOIN location_master.location l ON l.id=v.location_id WHERE l.campus_id=p_campus UNION SELECT valid_to FROM location_master.version v JOIN location_master.location l ON l.id=v.location_id WHERE l.campus_id=p_campus AND valid_to IS NOT NULL) bounds ORDER BY t LOOP
  roots:=0;
  FOR n IN SELECT DISTINCT ON(v.location_id) v.* FROM location_master.version v JOIN location_master.location l ON l.id=v.location_id WHERE l.campus_id=p_campus AND v.action<>'CLOSE' AND v.valid_from<=at AND (v.valid_to IS NULL OR at<v.valid_to) AND NOT EXISTS(SELECT 1 FROM location_master.version closed WHERE closed.location_id=v.location_id AND closed.action='CLOSE' AND closed.valid_from<=at) ORDER BY v.location_id,v.number DESC LOOP
   IF n.facts->>'locationType'='OTHER' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
   IF n.facts->>'locationType'='CAMPUS' THEN
    roots:=roots+1;IF roots>1 THEN RAISE EXCEPTION 'LOCATION_ROOT_CONFLICT';END IF;
    IF n.parent_id IS NOT NULL THEN RAISE EXCEPTION 'LOCATION_TYPE_INVALID';END IF;
   ELSE
    IF n.parent_id IS NULL THEN RAISE EXCEPTION 'PARENT_PERIOD_NOT_COVERED';END IF;
    IF NOT EXISTS(SELECT 1 FROM location_master.location WHERE id=n.parent_id AND campus_id=p_campus) THEN RAISE EXCEPTION 'LOCATION_CAMPUS_MISMATCH';END IF;
    SELECT * INTO p FROM location_master.version WHERE location_id=n.parent_id AND action<>'CLOSE' AND valid_from<=at AND (valid_to IS NULL OR at<valid_to) AND NOT EXISTS(SELECT 1 FROM location_master.version closed WHERE closed.location_id=n.parent_id AND closed.action='CLOSE' AND closed.valid_from<=at) ORDER BY number DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'PARENT_PERIOD_NOT_COVERED';END IF;
    IF NOT ((n.facts->>'locationType'='BUILDING' AND p.facts->>'locationType'='CAMPUS') OR (n.facts->>'locationType'='FLOOR' AND p.facts->>'locationType'='BUILDING') OR (n.facts->>'locationType' IN ('ROOM','CLINIC_ROOM','OPERATING_ROOM','WAREHOUSE') AND p.facts->>'locationType'='FLOOR') OR (n.facts->>'locationType'='DISPENSING_WINDOW' AND p.facts->>'locationType' IN ('FLOOR','ROOM','CLINIC_ROOM','OPERATING_ROOM','WAREHOUSE'))) THEN RAISE EXCEPTION 'LOCATION_TYPE_INVALID';END IF;
   END IF;
   visited:=ARRAY[n.location_id];cursor_id:=n.parent_id;
   WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id=ANY(visited) THEN RAISE EXCEPTION 'LOCATION_CYCLE';END IF;visited:=array_append(visited,cursor_id);
    SELECT parent_id INTO cursor_id FROM location_master.version WHERE location_id=cursor_id AND action<>'CLOSE' AND valid_from<=at AND (valid_to IS NULL OR at<valid_to) ORDER BY number DESC LIMIT 1;
   END LOOP;
   IF n.facts->>'locationType' NOT IN ('CAMPUS','BUILDING') AND nullif(btrim(n.facts->>'floorLabel'),'') IS NULL THEN RAISE EXCEPTION 'FLOOR_LABEL_REQUIRED';END IF;
   IF n.facts->>'locationType' IN ('ROOM','CLINIC_ROOM','OPERATING_ROOM') AND nullif(btrim(n.facts->>'roomNumber'),'') IS NULL THEN RAISE EXCEPTION 'ROOM_NUMBER_REQUIRED';END IF;
  END LOOP;
 END LOOP;
END $$;
CREATE FUNCTION location_master.mutate(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;actor text:=t->>'actor';op text:=t->>'operation';identity text;r location_master.input;j jsonb;verify location_master.verification;c jsonb;approved_by text;previous location_master.version;closing_basis location_master.version;binding location_master.apply_binding;change location_master.change;w jsonb;facts jsonb;target uuid;parent uuid;aliases jsonb:='{}';results jsonb:='[]';splits jsonb:='[]';n bigint;from_at timestamp;to_at timestamp;record_at timestamp:=timezone('Asia/Shanghai',clock_timestamp());vid uuid;root_change_id uuid;campus jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.location_write_authority WHERE singleton;
 IF secret IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF op='STAGE' THEN
  PERFORM location_master.closed(t,ARRAY['operation','actor','transaction','requestId','jobId','revisionId','campus','campusId','digest','envelope']);
  identity:=location_master.authorize(actor,(t->>'campusId')::uuid,t->>'campus','WRITE');PERFORM location_master.authorize(actor,(t->>'campusId')::uuid,t->>'campus','READ_RESTRICTED');
  campus:=organization_master.campus_snapshot(actor,(t->>'campusId')::uuid);IF campus->>'scope' IS DISTINCT FROM t->>'campus' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  SELECT * INTO r FROM location_master.input WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF r.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);END IF;
  j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',t->>'jobId'));
  IF j->>'submitterIdentity' IS DISTINCT FROM identity OR j->>'currentRevisionId' IS DISTINCT FROM t->>'revisionId' OR j->'contract'->>'dataset'<>'ORG12' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
  INSERT INTO location_master.input(job_id,job_revision,maker,identity_code,request_id,digest,campus_id,scope,envelope) VALUES((j->>'id')::uuid,(j->>'currentRevisionId')::uuid,actor,identity,(t->>'requestId')::uuid,t->>'digest',(t->>'campusId')::uuid,t->>'campus',t->'envelope') RETURNING * INTO r;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'LOCATION_INPUT','ORG12_CORE',r.digest);
  RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);
 END IF;
 r:=jsonb_populate_record(NULL::location_master.input,location_master.input_read(actor,(t->>'inputId')::uuid,CASE WHEN op='VERIFY' THEN 'VERIFY' ELSE 'WRITE' END));
 IF op='VERIFY' THEN
  PERFORM location_master.closed(t,ARRAY['operation','actor','transaction','inputId','inputDigest','requestId','digest','envelope']);
  identity:=location_master.authorize(actor,r.campus_id,r.scope,'VERIFY');IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
  IF r.digest IS DISTINCT FROM t->>'inputDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  SELECT * INTO verify FROM location_master.verification WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF verify.input_id<>r.id OR verify.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('verificationId',verify.id);END IF;
  IF EXISTS(SELECT 1 FROM location_master.change WHERE input_id=r.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
  INSERT INTO location_master.verification(input_id,number,actor,identity_code,request_id,digest,envelope) VALUES(r.id,(SELECT coalesce(max(number),0)+1 FROM location_master.verification WHERE input_id=r.id),actor,identity,(t->>'requestId')::uuid,t->>'digest',t->'envelope') RETURNING * INTO verify;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'LOCATION_VERIFY','PHYSICAL_FACTS',verify.digest);RETURN jsonb_build_object('verificationId',verify.id);
 END IF;
 IF op NOT IN ('FREEZE','APPLY') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 c:=governance_catalog.apply_record(actor,'READ_CANDIDATE',jsonb_build_object('candidateId',(t->>'candidateId')::uuid));
 IF c->>'digest' IS DISTINCT FROM t->>'digest' OR c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 IF op='FREEZE' THEN
  PERFORM location_master.closed(t,ARRAY['operation','actor','transaction','inputId','writes','writesDigest','candidateId','digest']);
  IF c->>'approvedBy' IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
  INSERT INTO location_master.apply_binding VALUES((c->>'id')::uuid,r.id,c->>'digest',t->>'writesDigest',encode(sha256(convert_to((t->'writes')::text,'UTF8')),'hex'));
  RETURN '{}'::jsonb;
 END IF;
 PERFORM location_master.closed(t,ARRAY['operation','actor','transaction','inputId','writes','writeIndex','writesDigest','candidateId','digest']);
 approved_by:=c->>'approvedBy';IF approved_by IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 PERFORM governance_catalog.apply_record(approved_by,'CHECK_APPROVAL',jsonb_build_object('candidateId',(c->>'id')::uuid));
 identity:=location_master.authorize(approved_by,r.campus_id,r.scope,'REVIEW');IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
 SELECT * INTO binding FROM location_master.apply_binding WHERE candidate_id=(c->>'id')::uuid;
 IF NOT FOUND OR binding.input_id<>r.id OR binding.candidate_digest IS DISTINCT FROM t->>'digest' OR binding.writes_digest IS DISTINCT FROM t->>'writesDigest' OR ((t->>'writeIndex')::integer=1 AND binding.writes_hash IS DISTINCT FROM encode(sha256(convert_to((t->'writes')::text,'UTF8')),'hex')) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 SELECT * INTO change FROM location_master.change WHERE input_id=r.id;
 IF FOUND THEN IF change.candidate_id<>(c->>'id')::uuid OR change.digest IS DISTINCT FROM t->>'writesDigest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN change.results->((t->>'writeIndex')::integer-1);END IF;
 j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));
 IF r.job_revision IS DISTINCT FROM (j->>'currentRevisionId')::uuid THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 IF jsonb_typeof(t->'writes') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'writes') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;
 IF (t->>'writeIndex')::integer<>1 THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
 root_change_id:=uuidv7();
 -- All CREATE IDs are database-generated before resolving exact batch-local parent aliases.
 FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP
  PERFORM location_master.closed(w,ARRAY['key','targetId','expectedVersion','action','validFrom','validTo','facts','reason','sourceRow','splitKey']);
  IF jsonb_typeof(w->'action') IS DISTINCT FROM 'string' OR w->>'action' NOT IN ('CREATE','REVISE','MOVE_CONTAINMENT','CLOSE') OR jsonb_typeof(w->'reason') IS DISTINCT FROM 'string' OR length(w->>'reason') NOT BETWEEN 1 AND 2000 OR jsonb_typeof(w->'key') IS DISTINCT FROM 'string' OR length(w->>'key') NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF w->>'action'='CREATE' THEN
   IF w->'targetId'<>'null'::jsonb OR w->'expectedVersion'<>'null'::jsonb OR aliases ? (w->>'key') THEN RAISE EXCEPTION 'BATCH_CONFLICT';END IF;
   INSERT INTO location_master.location(campus_id,scope) VALUES(r.campus_id,r.scope) RETURNING id INTO target;aliases:=aliases||jsonb_build_object(w->>'key',target);
  END IF;
 END LOOP;
 FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP
  facts:=w->'facts';PERFORM location_master.closed(facts,ARRAY['locationCode','locationName','locationType','floorLabel','roomNumber','addressDetail','isAccessible','parentId','source','contractVersionId','dependencyEvidence']);
  PERFORM location_master.closed(facts->'source',ARRAY['sourceAlias','sourceVersion','sourceSystemId','sourceRecordedAt','recordLocatorEvidence','recordStatus','approvalReference']);
  PERFORM location_master.closed(facts->'source'->'recordLocatorEvidence',ARRAY['inputId','row']);
  IF facts->'source'->'recordLocatorEvidence'->>'inputId' IS DISTINCT FROM r.id::text OR jsonb_typeof(facts->'source'->'recordLocatorEvidence'->'row') IS DISTINCT FROM 'number' OR (facts->'source'->'recordLocatorEvidence'->>'row')::integer NOT BETWEEN 1 AND 1048576 OR jsonb_typeof(facts->'source'->'sourceAlias') IS DISTINCT FROM 'string' OR length(facts->'source'->>'sourceAlias') NOT BETWEEN 1 AND 64 OR facts->'source'->>'sourceVersion' !~ '^[1-9][0-9]{0,9}$' OR (facts->'source'->>'sourceVersion')::bigint>2147483647 OR facts->'source'->>'recordStatus' NOT IN ('ACTIVE','RETIRED') OR jsonb_typeof(facts->'source'->'approvalReference') IS DISTINCT FROM 'string' OR length(facts->'source'->>'approvalReference')>2000 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  PERFORM location_master.local_time(facts->'source'->>'sourceRecordedAt');
  IF jsonb_typeof(w->'sourceRow') IS DISTINCT FROM 'number' OR (w->>'sourceRow')::integer NOT BETWEEN 1 AND 1048576 OR jsonb_typeof(w->'splitKey') NOT IN ('string','null') OR (w->>'splitKey' IS NOT NULL AND w->>'action'<>'CREATE') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF jsonb_typeof(facts->'locationCode') IS DISTINCT FROM 'string' OR length(facts->>'locationCode') NOT BETWEEN 1 AND 256 OR facts->>'locationCode' !~ '\S' OR jsonb_typeof(facts->'locationName') IS DISTINCT FROM 'string' OR length(facts->>'locationName') NOT BETWEEN 1 AND 160 OR facts->>'locationName' !~ '\S' OR jsonb_typeof(facts->'locationType') IS DISTINCT FROM 'string' OR facts->>'locationType' NOT IN ('CAMPUS','BUILDING','FLOOR','ROOM','CLINIC_ROOM','OPERATING_ROOM','DISPENSING_WINDOW','WAREHOUSE','OTHER') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  FOREACH op IN ARRAY ARRAY['floorLabel','roomNumber','addressDetail','parentId'] LOOP IF jsonb_typeof(facts->op) NOT IN ('string','null') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;END LOOP;
  IF facts->'isAccessible'<>'null'::jsonb AND (jsonb_typeof(facts->'isAccessible') IS DISTINCT FROM 'string' OR facts->>'isAccessible' NOT IN ('Y','N')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF jsonb_typeof(w->'validFrom') IS DISTINCT FROM 'string' OR jsonb_typeof(w->'validTo') NOT IN ('string','null') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  from_at:=location_master.local_time(w->>'validFrom');to_at:=CASE WHEN w->'validTo'='null'::jsonb THEN NULL ELSE location_master.local_time(w->>'validTo') END;
  IF to_at IS NOT NULL AND to_at<=from_at THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
  target:=CASE WHEN w->>'action'='CREATE' THEN (aliases->>(w->>'key'))::uuid ELSE (w->>'targetId')::uuid END;
  IF NOT EXISTS(SELECT 1 FROM location_master.location WHERE id=target AND campus_id=r.campus_id AND scope=r.scope) THEN RAISE EXCEPTION 'LOCATION_CAMPUS_MISMATCH';END IF;
  previous:=NULL;SELECT * INTO previous FROM location_master.version WHERE location_id=target ORDER BY number DESC LIMIT 1;
  IF w->>'action'<>'CREATE' THEN
   IF previous.number::text IS DISTINCT FROM w->>'expectedVersion' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
   IF EXISTS(SELECT 1 FROM location_master.version WHERE location_id=target AND action='CLOSE') THEN RAISE EXCEPTION 'LOCATION_CLOSED';END IF;
  END IF;
  parent:=CASE WHEN facts->>'parentId' IS NULL THEN NULL WHEN aliases ? (facts->>'parentId') THEN (aliases->>(facts->>'parentId'))::uuid ELSE (facts->>'parentId')::uuid END;
  IF w->>'action'='REVISE' AND (parent IS DISTINCT FROM previous.parent_id OR EXISTS(SELECT 1 FROM location_master.version v WHERE v.location_id=target AND v.action<>'CLOSE' AND v.parent_id IS DISTINCT FROM parent AND NOT isempty(tsmultirange(tsrange(v.valid_from,v.valid_to,'[)') * tsrange(from_at,to_at,'[)'))-coalesce((SELECT range_agg(tsrange(later.valid_from,later.valid_to,'[)')) FROM location_master.version later WHERE later.location_id=target AND later.number>v.number),'{}'::tsmultirange)))) THEN RAISE EXCEPTION 'LOCATION_PARENT_IMMUTABLE';END IF;
  IF w->>'action'='CLOSE' THEN
   closing_basis:=NULL;SELECT * INTO closing_basis FROM location_master.version v WHERE v.location_id=target AND v.action<>'CLOSE' AND v.valid_from<=from_at AND (v.valid_to IS NULL OR from_at<v.valid_to) ORDER BY v.number DESC LIMIT 1;
   IF closing_basis.id IS NULL THEN SELECT * INTO closing_basis FROM location_master.version v WHERE v.location_id=target AND v.action<>'CLOSE' AND v.valid_to=from_at ORDER BY v.number DESC LIMIT 1;END IF;
   IF to_at IS NOT NULL OR closing_basis.id IS NULL OR parent IS DISTINCT FROM closing_basis.parent_id OR (facts-ARRAY['source','contractVersionId','dependencyEvidence']) IS DISTINCT FROM (closing_basis.facts-ARRAY['source','contractVersionId','dependencyEvidence']) THEN RAISE EXCEPTION 'LOCATION_CLOSURE_EXPANSION';END IF;
  ELSE
   campus:=organization_master.location_coverage(actor,r.campus_id,from_at,to_at);
   IF campus->>'scope' IS DISTINCT FROM r.scope OR campus->>'covered'<>'true' OR (campus->>'retiredAt' IS NOT NULL AND (to_at IS NULL OR location_master.local_time(campus->>'retiredAt')<to_at)) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
   PERFORM organization_master.location_coverage(approved_by,r.campus_id,from_at,to_at);

   PERFORM governance_catalog.location_source(actor,(facts->'source'->>'sourceSystemId')::uuid,from_at,to_at,true,(j->'contract'->'definition'->>'sourceVersionId')::uuid);
   PERFORM governance_catalog.location_source(approved_by,(facts->'source'->>'sourceSystemId')::uuid,from_at,to_at,true,(j->'contract'->'definition'->>'sourceVersionId')::uuid);
  END IF;
  IF EXISTS(SELECT 1 FROM location_master.code WHERE campus_id=r.campus_id AND code=facts->>'locationCode' AND location_id<>target) THEN RAISE EXCEPTION 'LOCATION_CODE_CONFLICT';END IF;
  INSERT INTO location_master.code(campus_id,code,location_id) VALUES(r.campus_id,facts->>'locationCode',target) ON CONFLICT DO NOTHING;
  facts:=jsonb_set(facts,'{parentId}',coalesce(to_jsonb(parent),'null'::jsonb));n:=coalesce(previous.number,0)+1;
  INSERT INTO location_master.version(location_id,number,action,valid_from,valid_to,parent_id,facts,reason,change_id,recorded_at) VALUES(target,n,w->>'action',from_at,to_at,parent,facts,w->>'reason',root_change_id,record_at) RETURNING id INTO vid;
  results:=results||jsonb_build_array(jsonb_build_object('owner','location-master','id',target,'version',n::text,'source',jsonb_build_object('dataset','ORG12','row',(w->>'sourceRow')::integer,'step',w->>'action')));
  IF w->>'splitKey' IS NOT NULL THEN splits:=splits||jsonb_build_array(jsonb_build_object('predecessorId',w->>'splitKey','successorId',target,'effectiveAt',to_char(from_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'sourceRow',w->'sourceRow'));END IF;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,target,'LOCATION_'||(w->>'action'),'APPROVED_PHYSICAL_COMMAND',t->>'writesDigest');
 END LOOP;
 -- A split is an explicit closed predecessor plus at least two same-floor CREATEs.
 -- Recheck the associations independently of the application expansion.
 FOR w IN SELECT DISTINCT jsonb_build_object('predecessorId',value->>'predecessorId') FROM jsonb_array_elements(splits) LOOP
  SELECT * INTO previous FROM location_master.version WHERE location_id=(w->>'predecessorId')::uuid AND change_id=root_change_id AND action='CLOSE';
  IF NOT FOUND OR previous.facts->>'locationType' NOT IN ('ROOM','CLINIC_ROOM','OPERATING_ROOM','WAREHOUSE') OR (SELECT count(*) FROM jsonb_array_elements(splits) s WHERE s->>'predecessorId'=w->>'predecessorId')<2 THEN RAISE EXCEPTION 'LOCATION_SPLIT_INVALID';END IF;
  IF NOT EXISTS(SELECT 1 FROM location_master.version p WHERE p.location_id=previous.parent_id AND p.action<>'CLOSE' AND p.valid_from<=previous.valid_from AND (p.valid_to IS NULL OR previous.valid_from<p.valid_to) AND p.facts->>'locationType'='FLOOR') OR EXISTS(SELECT 1 FROM jsonb_array_elements(splits) s LEFT JOIN location_master.version successor ON successor.location_id=(s->>'successorId')::uuid AND successor.change_id=root_change_id WHERE s->>'predecessorId'=w->>'predecessorId' AND (successor.action IS DISTINCT FROM 'CREATE' OR successor.parent_id IS DISTINCT FROM previous.parent_id OR successor.valid_from IS DISTINCT FROM previous.valid_from OR successor.facts->>'locationType' NOT IN ('ROOM','CLINIC_ROOM','OPERATING_ROOM','WAREHOUSE'))) THEN RAISE EXCEPTION 'LOCATION_SPLIT_INVALID';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(s||jsonb_build_object('predecessorVersion',p.number::text,'predecessorVersionId',p.id,'predecessorHeadVersion',(v.number-1)::text)),'[]') INTO splits FROM jsonb_array_elements(splits) s JOIN location_master.version v ON v.location_id=(s->>'predecessorId')::uuid AND v.change_id=root_change_id AND v.action='CLOSE' JOIN LATERAL (SELECT prior.* FROM location_master.version prior WHERE prior.location_id=v.location_id AND prior.number<v.number AND prior.action<>'CLOSE' AND prior.valid_from<=v.valid_from AND (prior.valid_to IS NULL OR v.valid_from<prior.valid_to) ORDER BY prior.number DESC LIMIT 1) p ON true;
 PERFORM location_master.validate_tree(r.campus_id);
 INSERT INTO location_master.change(id,input_id,candidate_id,digest,results,splits,recorded_at) VALUES(root_change_id,r.id,(c->>'id')::uuid,t->>'writesDigest',results,splits,record_at);
 RETURN results->0;
END $$;

CREATE FUNCTION location_master.read_change(p_actor text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c location_master.change;r location_master.input;BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 SELECT * INTO c FROM location_master.change WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT * INTO r FROM location_master.input WHERE id=c.input_id;PERFORM location_master.authorize(p_actor,r.campus_id,r.scope,'READ');
 RETURN jsonb_build_object('id',c.id,'results',c.results,'splits',c.splits,'recordedAt',to_char(c.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
END $$;
CREATE FUNCTION location_master.audit_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(coalesce(NEW.actor,OLD.actor),coalesce(NEW.campus_id,OLD.campus_id),'LOCATION_AUTHORIZATION',TG_OP,encode(sha256(convert_to(coalesce(to_jsonb(NEW),to_jsonb(OLD))::text,'UTF8')),'hex'));RETURN coalesce(NEW,OLD);END $$;
CREATE TRIGGER access_lock BEFORE INSERT OR UPDATE OR DELETE ON location_master.access FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER access_audit AFTER INSERT OR UPDATE OR DELETE ON location_master.access FOR EACH ROW EXECUTE FUNCTION location_master.audit_access();
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['input','verification','location','code','change','version','apply_binding'] LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON location_master.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['access','input','verification','location','code','change','version','apply_binding'] LOOP
  EXECUTE format('ALTER TABLE location_master.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('REVOKE ALL ON location_master.%I FROM PUBLIC,hdi_prototype',tab);
 END LOOP;
END $$;
REVOKE ALL ON vnext_control.location_write_authority FROM PUBLIC,hdi_prototype;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA location_master FROM PUBLIC,hdi_prototype;
