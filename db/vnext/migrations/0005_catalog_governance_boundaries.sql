-- Forward-only governance boundary repair; installed migrations remain unchanged.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND application_name='hdi-vnext-catalog') THEN RAISE EXCEPTION 'CATALOG_RUNTIME_MUST_BE_STOPPED'; END IF;
END $$;
SELECT pg_advisory_xact_lock(901002);
CREATE OR REPLACE FUNCTION governance_catalog.local_time(value text) RETURNS timestamp LANGUAGE plpgsql AS $$
DECLARE parsed timestamp;
BEGIN
 IF value IS NULL OR value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$' THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED'; END IF;
 parsed:=value::timestamp;
 IF to_char(parsed,'YYYY-MM-DD"T"HH24:MI:SS')<>left(value,19) THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED'; END IF;
 RETURN parsed;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED';
END $$;
CREATE FUNCTION governance_catalog.read_effective(actor text, requested_scope text, business_at text, as_of text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE result jsonb; cutoff timestamp; business_time timestamp;
BEGIN
 PERFORM vnext_control.authorize(actor,requested_scope,'READ');
 business_time:=governance_catalog.local_time(business_at);
 cutoff:=CASE WHEN as_of IS NULL THEN timezone('Asia/Shanghai',clock_timestamp()) ELSE governance_catalog.local_time(as_of) END;
 SELECT coalesce(jsonb_agg(row_value ORDER BY row_value->>'code'),'[]'::jsonb) INTO result FROM (
 SELECT jsonb_build_object('id',o.id,'kind',o.kind,'scope',o.scope,'code',o.code,'version',v.number,'versionId',v.id,'head',e.head::text,'status',e.status,'payload',v.payload,
 'reviewDigest',encode(sha256(convert_to(jsonb_build_object('payload',v.payload,'validFrom',v.valid_from,'validTo',v.valid_to)::text,'UTF8')),'hex'),
 'validFrom',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),
 'recordedAt',to_char(e.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')) AS row_value
 FROM governance_catalog.object o JOIN LATERAL (SELECT * FROM governance_catalog.event WHERE object_id=o.id AND recorded_at<=cutoff AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1) e ON true
 JOIN governance_catalog.version v ON v.id=e.version_id WHERE o.scope=requested_scope AND e.status='PUBLISHED' AND tsrange(v.valid_from,v.valid_to,'[)') @> business_time) rows;
 RETURN jsonb_build_object('items',result,'domains',(SELECT content->'domains' FROM governance_catalog.source_snapshot WHERE source_key='PACKAGE_V2'));
END $$;

REVOKE ALL ON FUNCTION governance_catalog.read_effective(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance_catalog.read_effective(text,text,text,text) TO hdi_prototype;
CREATE OR REPLACE FUNCTION governance_catalog.command(actor text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
<<catalog_write>>
DECLARE identity text; action text:=input->>'action'; sc text:=input->>'scope'; object_kind text:=input->>'kind'; object_code text:=input->>'code';
 req uuid; target uuid; existing vnext_control.outcome; obj governance_catalog.object; ver governance_catalog.version; ev governance_catalog.event;
 payload jsonb; patch jsonb:=coalesce(input->'values','{}'); content_hash text; result jsonb; next_status text; new_version uuid;
 begin_b timestamp; end_b timestamp; requested_digest text; other record; source_object uuid;
BEGIN
 identity:=vnext_control.authorize(actor,sc,CASE WHEN action IN ('PUBLISH','REJECT','RETIRE') THEN 'REVIEW' ELSE 'WRITE' END);
 IF jsonb_typeof(input)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('action','scope','kind','code','requestId','target','expectedHead','values','reason','reviewDigest','validFrom','validTo')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 IF action NOT IN ('CREATE','REVISE','SUBMIT','PUBLISH','REJECT','RETIRE') OR coalesce(input->>'reason','') !~ '^[A-Z0-9_]{1,64}$' OR coalesce(input->>'requestId','') !~ '^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('action','scope','requestId','reason') AND NOT (
  (action='CREATE' AND k IN ('kind','code','values','validFrom','validTo')) OR
  (action='REVISE' AND k IN ('target','expectedHead','values','validFrom','validTo')) OR
  (action IN ('SUBMIT','REJECT') AND k IN ('target','expectedHead')) OR
  (action IN ('PUBLISH','RETIRE') AND k IN ('target','expectedHead','reviewDigest'))
 )) THEN RAISE EXCEPTION 'ACTION_FIELDS_FORBIDDEN'; END IF;
 req:=(input->>'requestId')::uuid;
 requested_digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(901002);
 -- Serialize authorization changes with commands; current grants cannot disappear mid-write.
 PERFORM 1 FROM vnext_control.actor a WHERE a.code=actor FOR SHARE;
 PERFORM 1 FROM vnext_control.actor_grant WHERE actor_code=actor AND scope=sc FOR SHARE;
 identity:=vnext_control.authorize(actor,sc,CASE WHEN action IN ('PUBLISH','REJECT','RETIRE') THEN 'REVIEW' ELSE 'WRITE' END);
 SELECT o.* INTO existing FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=req;
 IF FOUND THEN IF existing.input_digest<>requested_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF; RETURN existing.result; END IF;
 IF action='CREATE' THEN
  IF object_kind NOT IN ('DATASET','SOURCE','RESPONSIBILITY') OR sc<>'SYNTHETIC' OR coalesce(object_code,'') !~ '^[A-Z0-9_]{2,64}$' OR input ? 'target' OR input ? 'expectedHead' THEN RAISE EXCEPTION 'INVALID_CREATE'; END IF;
  IF object_kind='DATASET' THEN
   SELECT v.payload INTO payload FROM governance_catalog.object o JOIN governance_catalog.version v ON v.object_id=o.id AND v.number=1 WHERE o.kind='DATASET' AND o.scope='BASELINE' AND o.code=object_code;
   IF payload IS NULL THEN RAISE EXCEPTION 'UNKNOWN_DATASET'; END IF;
  ELSE payload:='{}'::jsonb; END IF;
  INSERT INTO governance_catalog.object(kind,scope,code) VALUES(object_kind,sc,object_code) RETURNING id INTO target;
 ELSE
  target:=(input->>'target')::uuid;
  SELECT * INTO obj FROM governance_catalog.object WHERE id=target AND scope=sc;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  object_kind:=obj.kind; object_code:=obj.code;
  SELECT * INTO ev FROM governance_catalog.event WHERE object_id=target ORDER BY head DESC LIMIT 1;
  IF coalesce(input->>'expectedHead','')<>ev.head::text THEN RAISE EXCEPTION 'STALE_HEAD'; END IF;
  SELECT * INTO ver FROM governance_catalog.version WHERE id=ev.version_id;
  payload:=ver.payload;
 END IF;
 IF action IN ('CREATE','REVISE') THEN
  IF action='REVISE' AND ev.status='RETIRED' THEN RAISE EXCEPTION 'RETIRED'; END IF;
  IF jsonb_typeof(patch)<>'object' THEN RAISE EXCEPTION 'CLOSED_FIELDS_REQUIRED'; END IF;
  IF object_kind='DATASET' THEN
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(patch) k WHERE k NOT IN ('name','explanation')) THEN RAISE EXCEPTION 'CLOSED_FIELDS_REQUIRED'; END IF;
   payload:=jsonb_set(payload,'{adopted}',coalesce(payload->'adopted','{}')||patch);
  ELSIF object_kind='SOURCE' THEN
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(patch) k WHERE k NOT IN ('name','environment','sourceKind','deploymentScope','vendor','systemVersion','businessOwnerRole','technicalRole','sourceEvidence','interfaceContractRef')) THEN RAISE EXCEPTION 'CLOSED_FIELDS_REQUIRED'; END IF;
   payload:=payload||patch;
   IF coalesce(payload->>'environment','')<>'SYNTHETIC' OR coalesce(payload->>'sourceKind','') NOT IN ('MANUAL','SOFTWARE') OR coalesce(payload->>'deploymentScope','') NOT IN ('UNRESOLVED_DECLARATION','SYNTHETIC_ALL') OR
     coalesce(payload->>'name','')='' OR coalesce(payload->>'businessOwnerRole','')='' OR coalesce(payload->>'technicalRole','')='' THEN RAISE EXCEPTION 'SOURCE_FIELDS_REQUIRED'; END IF;
   IF payload->>'sourceKind'='SOFTWARE' AND (coalesce(payload->>'vendor','')='' OR coalesce(payload->>'systemVersion','')='') THEN RAISE EXCEPTION 'VENDOR_VERSION_REQUIRED'; END IF;
   IF action='REVISE' AND ver.payload->>'sourceEvidence'='SYNTHETIC_BOOTSTRAP' AND payload->>'sourceEvidence' IS DISTINCT FROM 'SYNTHETIC_BOOTSTRAP' THEN RAISE EXCEPTION 'BOOTSTRAP_ROOT_IMMUTABLE'; END IF;
   IF payload->>'sourceEvidence' IS DISTINCT FROM 'SYNTHETIC_BOOTSTRAP' AND coalesce(payload->>'sourceEvidence','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'SOURCE_REFERENCE_INVALID'; END IF;
   IF payload->>'sourceEvidence'='SYNTHETIC_BOOTSTRAP' THEN
    IF action='REVISE' AND ver.payload->>'sourceEvidence' IS DISTINCT FROM 'SYNTHETIC_BOOTSTRAP' THEN RAISE EXCEPTION 'BOOTSTRAP_ALREADY_USED'; END IF;
    IF action='CREATE' AND EXISTS(SELECT 1 FROM governance_catalog.object o WHERE o.kind='SOURCE' AND o.id<>target) THEN RAISE EXCEPTION 'BOOTSTRAP_ALREADY_USED'; END IF;
   ELSE
    source_object:=(payload->>'sourceEvidence')::uuid;
    PERFORM governance_catalog.assert_source_chain(target,source_object,sc);
    IF NOT EXISTS(SELECT 1 FROM governance_catalog.object o JOIN LATERAL(SELECT status FROM governance_catalog.event WHERE object_id=o.id AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1) e ON true WHERE o.id=source_object AND o.kind='SOURCE' AND o.scope=sc AND e.status='PUBLISHED') THEN RAISE EXCEPTION 'SOURCE_EVIDENCE_NOT_READY'; END IF;
    payload:=payload||jsonb_build_object('sourceEvidenceVersion',(SELECT version_id FROM governance_catalog.event WHERE object_id=source_object AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1));
   END IF;
   payload:=payload||jsonb_build_object('readiness','METADATA_ONLY','interfaceReadiness','NOT_READY','approval_status','SYNTHETIC_ONLY');
  ELSE
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(patch) k WHERE k NOT IN ('dataset','authorityScope','fieldGroup','role','assigneeRole')) THEN RAISE EXCEPTION 'CLOSED_FIELDS_REQUIRED'; END IF;
   payload:=payload||patch;
   IF NOT EXISTS(SELECT 1 FROM governance_catalog.object o WHERE o.scope='BASELINE' AND o.kind='DATASET' AND o.code=payload->>'dataset') OR
    coalesce(payload->>'authorityScope','') NOT IN ('ALL','NORTH','SOUTH') OR coalesce(payload->>'fieldGroup','') NOT IN ('ALL','IDENTITY','CONTACT') OR coalesce(payload->>'role','') NOT IN ('OWNER','STEWARD','COLLABORATOR') OR coalesce(payload->>'assigneeRole','') NOT IN ('SYNTHETIC_OWNER_A','SYNTHETIC_OWNER_B','SYNTHETIC_STEWARD') THEN RAISE EXCEPTION 'RESPONSIBILITY_SCOPE_REQUIRED'; END IF;
  END IF;
  IF length(payload::text)>250000 OR EXISTS(SELECT 1 FROM jsonb_each_text(patch) p WHERE length(p.value)>2000) THEN RAISE EXCEPTION 'BOUNDED_INPUT_REQUIRED'; END IF;
  begin_b:=governance_catalog.local_time(input->>'validFrom');
  end_b:=CASE WHEN input->>'validTo' IS NULL THEN NULL ELSE governance_catalog.local_time(input->>'validTo') END;
  IF object_kind='SOURCE' AND payload->>'sourceEvidence'<>'SYNTHETIC_BOOTSTRAP' AND NOT EXISTS(SELECT 1 FROM governance_catalog.version p WHERE p.id=(catalog_write.payload->>'sourceEvidenceVersion')::uuid AND tsrange(p.valid_from,p.valid_to,'[)') @> tsrange(begin_b,end_b,'[)')) THEN RAISE EXCEPTION 'SOURCE_PERIOD_NOT_COVERED'; END IF;
  INSERT INTO governance_catalog.version(object_id,number,payload,maker_identity,valid_from,valid_to) VALUES(target,coalesce(ver.number,0)+1,payload,identity,begin_b,end_b) RETURNING id INTO new_version;
  next_status:='DRAFT';
 ELSE
  IF patch<>'{}'::jsonb OR input ? 'validFrom' OR input ? 'validTo' THEN RAISE EXCEPTION 'ACTION_FIELDS_FORBIDDEN'; END IF;
  new_version:=ver.id;
  IF action='SUBMIT' AND ev.status='DRAFT' THEN next_status:='REVIEW';
  ELSIF action='REJECT' AND ev.status='REVIEW' THEN
   PERFORM vnext_control.authorize(actor,sc,'REVIEW'); IF identity=ver.maker_identity THEN RAISE EXCEPTION 'SELF_REVIEW_FORBIDDEN'; END IF; next_status:='DRAFT';
  ELSIF action='PUBLISH' AND ev.status='REVIEW' THEN
   IF identity=ver.maker_identity THEN RAISE EXCEPTION 'SELF_REVIEW_FORBIDDEN'; END IF;
   IF coalesce(input->>'reviewDigest','')<>encode(sha256(convert_to(jsonb_build_object('payload',ver.payload,'validFrom',ver.valid_from,'validTo',ver.valid_to)::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'REVIEW_DIGEST_MISMATCH'; END IF;
   IF object_kind='SOURCE' AND payload->>'sourceEvidence'<>'SYNTHETIC_BOOTSTRAP' AND NOT EXISTS(SELECT 1 FROM (SELECT * FROM governance_catalog.event WHERE object_id=(catalog_write.payload->>'sourceEvidence')::uuid AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1) parent WHERE parent.status='PUBLISHED' AND parent.version_id=(catalog_write.payload->>'sourceEvidenceVersion')::uuid) THEN RAISE EXCEPTION 'SOURCE_EVIDENCE_NOT_READY'; END IF;
   IF object_kind='SOURCE' AND payload->>'sourceEvidence'<>'SYNTHETIC_BOOTSTRAP' THEN PERFORM governance_catalog.assert_source_chain(target,(payload->>'sourceEvidence')::uuid,sc); END IF;
   IF object_kind='RESPONSIBILITY' AND payload->>'role'='OWNER' THEN
    FOR other IN SELECT v.* FROM governance_catalog.object o JOIN LATERAL(SELECT * FROM governance_catalog.event WHERE object_id=o.id AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1) e ON true JOIN governance_catalog.version v ON v.id=e.version_id WHERE o.kind='RESPONSIBILITY' AND o.scope=sc AND o.id<>target AND e.status='PUBLISHED' AND v.payload->>'role'='OWNER' AND v.payload->>'dataset'=catalog_write.payload->>'dataset' LOOP
     IF (payload->>'authorityScope'='ALL' OR other.payload->>'authorityScope'='ALL' OR payload->>'authorityScope'=other.payload->>'authorityScope') AND
      (payload->>'fieldGroup'='ALL' OR other.payload->>'fieldGroup'='ALL' OR payload->>'fieldGroup'=other.payload->>'fieldGroup') AND
      tsrange(ver.valid_from,ver.valid_to,'[)') && tsrange(other.valid_from,other.valid_to,'[)') THEN RAISE EXCEPTION 'OWNER_PERIOD_CONFLICT'; END IF;
    END LOOP;
   END IF;
   next_status:='PUBLISHED';
  ELSIF action='RETIRE' AND EXISTS(SELECT 1 FROM (SELECT status FROM governance_catalog.event WHERE object_id=target AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1) accepted WHERE accepted.status='PUBLISHED') THEN
   SELECT version_id INTO new_version FROM governance_catalog.event WHERE object_id=target AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1;
   SELECT * INTO ver FROM governance_catalog.version WHERE id=new_version;
   IF identity=ver.maker_identity THEN RAISE EXCEPTION 'SELF_REVIEW_FORBIDDEN'; END IF;
   IF coalesce(input->>'reviewDigest','')<>encode(sha256(convert_to(jsonb_build_object('payload',ver.payload,'validFrom',ver.valid_from,'validTo',ver.valid_to)::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'REVIEW_DIGEST_MISMATCH'; END IF;
   next_status:='RETIRED';
  ELSE RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
 END IF;
 INSERT INTO governance_catalog.event(object_id,version_id,status,actor_code,reason) VALUES(target,new_version,next_status,actor,input->>'reason') RETURNING * INTO ev;
 SELECT * INTO ver FROM governance_catalog.version WHERE id=new_version;
 content_hash:=encode(sha256(convert_to(jsonb_build_object('payload',ver.payload,'validFrom',ver.valid_from,'validTo',ver.valid_to)::text,'UTF8')),'hex');
 result:=jsonb_build_object('id',target,'head',ev.head::text,'version',ver.number,'versionId',new_version,'status',next_status,'reviewDigest',content_hash,'recordedAt',to_char(ev.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,target,action,input->>'reason',content_hash);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(actor,req,requested_digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,actor);
 RETURN result;
END $$;


