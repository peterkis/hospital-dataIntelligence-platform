CREATE SCHEMA governance_catalog;
CREATE TABLE governance_catalog.source_snapshot (
 id uuid PRIMARY KEY DEFAULT uuidv7(), source_key text NOT NULL UNIQUE,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), content jsonb NOT NULL,
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp())
);
CREATE TABLE governance_catalog.object (
 id uuid PRIMARY KEY DEFAULT uuidv7(), kind text NOT NULL CHECK(kind IN ('DATASET','SOURCE','RESPONSIBILITY')),
 scope text NOT NULL CHECK(scope IN ('BASELINE','SYNTHETIC')), code text NOT NULL,
 UNIQUE(kind,scope,code)
);
CREATE TABLE governance_catalog.version (
 id uuid PRIMARY KEY DEFAULT uuidv7(), object_id uuid NOT NULL REFERENCES governance_catalog.object(id),
 number integer NOT NULL CHECK(number>0), payload jsonb NOT NULL,
 maker_identity text NOT NULL, valid_from timestamp NOT NULL, valid_to timestamp,
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 UNIQUE(object_id,number), UNIQUE(id,object_id), CHECK(valid_to IS NULL OR valid_to>valid_from)
);
CREATE TABLE governance_catalog.event (
 head bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, object_id uuid NOT NULL,
 version_id uuid NOT NULL, status text NOT NULL CHECK(status IN ('DRAFT','REVIEW','PUBLISHED','RETIRED')),
 actor_code text NOT NULL, reason text NOT NULL,
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 FOREIGN KEY(version_id,object_id) REFERENCES governance_catalog.version(id,object_id)
);
CREATE INDEX catalog_event_object ON governance_catalog.event(object_id,head DESC);
CREATE TRIGGER snapshot_immutable BEFORE UPDATE OR DELETE ON governance_catalog.source_snapshot FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE TRIGGER object_immutable BEFORE UPDATE OR DELETE ON governance_catalog.object FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE TRIGGER version_immutable BEFORE UPDATE OR DELETE ON governance_catalog.version FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE TRIGGER event_immutable BEFORE UPDATE OR DELETE ON governance_catalog.event FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();

CREATE FUNCTION governance_catalog.local_time(value text) RETURNS timestamp LANGUAGE plpgsql AS $$
BEGIN
 IF value IS NULL OR value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$' THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED'; END IF;
 RETURN value::timestamp;
END $$;

CREATE FUNCTION governance_catalog.read_catalog(actor text, requested_scope text, as_of text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE result jsonb; cutoff timestamp;
BEGIN
 PERFORM vnext_control.authorize(actor,requested_scope,'READ');
 cutoff:=CASE WHEN as_of IS NULL THEN timezone('Asia/Shanghai',clock_timestamp()) ELSE governance_catalog.local_time(as_of) END;
 SELECT coalesce(jsonb_agg(row_value ORDER BY row_value->>'code'),'[]'::jsonb) INTO result FROM (
 SELECT jsonb_build_object('id',o.id,'kind',o.kind,'scope',o.scope,'code',o.code,'version',v.number,'versionId',v.id,'head',e.head::text,'status',e.status,'payload',v.payload,
 'reviewDigest',encode(sha256(convert_to(jsonb_build_object('payload',v.payload,'validFrom',v.valid_from,'validTo',v.valid_to)::text,'UTF8')),'hex'),
 'validFrom',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),
 'recordedAt',to_char(e.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')) AS row_value
 FROM governance_catalog.object o JOIN LATERAL (SELECT * FROM governance_catalog.event WHERE object_id=o.id AND recorded_at<=cutoff ORDER BY head DESC LIMIT 1) e ON true
 JOIN governance_catalog.version v ON v.id=e.version_id WHERE o.scope=requested_scope) rows;
 RETURN jsonb_build_object('items',result,'domains',(SELECT content->'domains' FROM governance_catalog.source_snapshot WHERE source_key='PACKAGE_V2'));
END $$;

CREATE FUNCTION governance_catalog.history(actor text, requested_scope text, target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE result jsonb;
BEGIN
 PERFORM vnext_control.authorize(actor,requested_scope,'READ');
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=target AND scope=requested_scope) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT jsonb_agg(jsonb_build_object('head',e.head::text,'status',e.status,'version',v.number,'payload',v.payload,'validFrom',replace(v.valid_from::text,' ','T'),'validTo',replace(v.valid_to::text,' ','T'),'recordedAt',to_char(e.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')) ORDER BY e.head) INTO result
 FROM governance_catalog.event e JOIN governance_catalog.version v ON e.version_id=v.id WHERE e.object_id=target;
 RETURN coalesce(result,'[]'::jsonb);
END $$;

CREATE FUNCTION governance_catalog.command(actor text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
<<catalog_write>>
DECLARE identity text; action text:=input->>'action'; sc text:=input->>'scope'; object_kind text:=input->>'kind'; object_code text:=input->>'code';
 req uuid; target uuid; existing vnext_control.outcome; obj governance_catalog.object; ver governance_catalog.version; ev governance_catalog.event;
 payload jsonb; patch jsonb:=coalesce(input->'values','{}'); content_hash text; result jsonb; next_status text; new_version uuid;
 begin_b timestamp; end_b timestamp; requested_digest text; other record; source_object uuid;
BEGIN
 identity:=vnext_control.authorize(actor,sc,CASE WHEN action IN ('PUBLISH','REJECT') THEN 'REVIEW' ELSE 'WRITE' END);
 IF jsonb_typeof(input)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('action','scope','kind','code','requestId','target','expectedHead','values','reason','reviewDigest','validFrom','validTo')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 IF action NOT IN ('CREATE','REVISE','SUBMIT','PUBLISH','REJECT','RETIRE') OR coalesce(input->>'reason','') !~ '^[A-Z0-9_]{1,64}$' OR coalesce(input->>'requestId','') !~ '^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
 req:=(input->>'requestId')::uuid;
 requested_digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(901002);
 -- Serialize authorization changes with commands; current grants cannot disappear mid-write.
 PERFORM 1 FROM vnext_control.actor a WHERE a.code=actor FOR SHARE;
 PERFORM 1 FROM vnext_control.actor_grant WHERE actor_code=actor AND scope=sc FOR SHARE;
 identity:=vnext_control.authorize(actor,sc,CASE WHEN action IN ('PUBLISH','REJECT') THEN 'REVIEW' ELSE 'WRITE' END);
 SELECT * INTO existing FROM vnext_control.outcome WHERE actor_code=actor AND request_id=req;
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
   IF payload->>'sourceEvidence'='SYNTHETIC_BOOTSTRAP' THEN
    IF action='REVISE' AND ver.payload->>'sourceEvidence' IS DISTINCT FROM 'SYNTHETIC_BOOTSTRAP' THEN RAISE EXCEPTION 'BOOTSTRAP_ALREADY_USED'; END IF;
    IF action='CREATE' AND EXISTS(SELECT 1 FROM governance_catalog.object o WHERE o.kind='SOURCE' AND o.id<>target) THEN RAISE EXCEPTION 'BOOTSTRAP_ALREADY_USED'; END IF;
   ELSE
    source_object:=(payload->>'sourceEvidence')::uuid;
    IF NOT EXISTS(SELECT 1 FROM governance_catalog.object o JOIN LATERAL(SELECT status FROM governance_catalog.event WHERE object_id=o.id ORDER BY head DESC LIMIT 1) e ON true WHERE o.id=source_object AND o.kind='SOURCE' AND o.scope=sc AND e.status='PUBLISHED') THEN RAISE EXCEPTION 'SOURCE_EVIDENCE_NOT_READY'; END IF;
    payload:=payload||jsonb_build_object('sourceEvidenceVersion',(SELECT version_id FROM governance_catalog.event WHERE object_id=source_object ORDER BY head DESC LIMIT 1));
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
   IF object_kind='SOURCE' AND payload->>'sourceEvidence'<>'SYNTHETIC_BOOTSTRAP' AND NOT EXISTS(SELECT 1 FROM (SELECT * FROM governance_catalog.event WHERE object_id=(catalog_write.payload->>'sourceEvidence')::uuid ORDER BY head DESC LIMIT 1) parent WHERE parent.status='PUBLISHED' AND parent.version_id=(catalog_write.payload->>'sourceEvidenceVersion')::uuid) THEN RAISE EXCEPTION 'SOURCE_EVIDENCE_NOT_READY'; END IF;
   IF object_kind='RESPONSIBILITY' AND payload->>'role'='OWNER' THEN
    FOR other IN SELECT v.* FROM governance_catalog.object o JOIN LATERAL(SELECT * FROM governance_catalog.event WHERE object_id=o.id AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1) e ON true JOIN governance_catalog.version v ON v.id=e.version_id WHERE o.kind='RESPONSIBILITY' AND o.scope=sc AND o.id<>target AND e.status='PUBLISHED' AND v.payload->>'role'='OWNER' AND v.payload->>'dataset'=catalog_write.payload->>'dataset' LOOP
     IF (payload->>'authorityScope'='ALL' OR other.payload->>'authorityScope'='ALL' OR payload->>'authorityScope'=other.payload->>'authorityScope') AND
      (payload->>'fieldGroup'='ALL' OR other.payload->>'fieldGroup'='ALL' OR payload->>'fieldGroup'=other.payload->>'fieldGroup') AND
      tsrange(ver.valid_from,ver.valid_to,'[)') && tsrange(other.valid_from,other.valid_to,'[)') THEN RAISE EXCEPTION 'OWNER_PERIOD_CONFLICT'; END IF;
    END LOOP;
   END IF;
   next_status:='PUBLISHED';
  ELSIF action='RETIRE' AND ev.status='PUBLISHED' THEN next_status:='RETIRED';
  ELSE RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
 END IF;
 INSERT INTO governance_catalog.event(object_id,version_id,status,actor_code,reason) VALUES(target,new_version,next_status,actor,input->>'reason') RETURNING * INTO ev;
 SELECT * INTO ver FROM governance_catalog.version WHERE id=new_version;
 content_hash:=encode(sha256(convert_to(jsonb_build_object('payload',ver.payload,'validFrom',ver.valid_from,'validTo',ver.valid_to)::text,'UTF8')),'hex');
 result:=jsonb_build_object('id',target,'head',ev.head::text,'version',ver.number,'versionId',new_version,'status',next_status,'reviewDigest',content_hash,'recordedAt',to_char(ev.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,target,action,input->>'reason',content_hash);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(actor,req,requested_digest,result);
 RETURN result;
END $$;

CREATE FUNCTION governance_catalog.resolve_source(actor text, requested_scope text, target uuid, business_at text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE ev governance_catalog.event; ver governance_catalog.version;
BEGIN
 PERFORM vnext_control.authorize(actor,requested_scope,'READ');
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=target AND scope=requested_scope AND kind='SOURCE') THEN RAISE EXCEPTION 'SOURCE_NOT_READY'; END IF;
 SELECT * INTO ev FROM governance_catalog.event WHERE object_id=target ORDER BY head DESC LIMIT 1;
 SELECT * INTO ver FROM governance_catalog.version WHERE id=ev.version_id;
 IF ev.status<>'PUBLISHED' OR NOT tsrange(ver.valid_from,ver.valid_to,'[)') @> governance_catalog.local_time(business_at) THEN RAISE EXCEPTION 'SOURCE_NOT_READY'; END IF;
 IF ver.payload->>'sourceEvidence'<>'SYNTHETIC_BOOTSTRAP' THEN
  IF NOT EXISTS(SELECT 1 FROM (SELECT * FROM governance_catalog.event WHERE object_id=(ver.payload->>'sourceEvidence')::uuid ORDER BY head DESC LIMIT 1) p WHERE p.status='PUBLISHED' AND p.version_id=(ver.payload->>'sourceEvidenceVersion')::uuid) THEN RAISE EXCEPTION 'SOURCE_EVIDENCE_NOT_READY'; END IF;
  PERFORM governance_catalog.resolve_source(actor,requested_scope,(ver.payload->>'sourceEvidence')::uuid,business_at);
 END IF;
 RETURN jsonb_build_object('id',target,'versionId',ver.id,'qualification','SYNTHETIC_REGISTRY_REFERENCE_ONLY','interfaceReadiness','NOT_READY','realApply','NOT_IMPLEMENTED');
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA governance_catalog FROM PUBLIC,hdi_prototype;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA governance_catalog FROM PUBLIC,hdi_prototype;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA governance_catalog FROM PUBLIC;
GRANT USAGE ON SCHEMA governance_catalog TO hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.read_catalog(text,text,text),governance_catalog.history(text,text,uuid),governance_catalog.command(text,jsonb),governance_catalog.resolve_source(text,text,uuid,text) TO hdi_prototype;
-- Visibility for codegen only: ordinary SELECT sees no rows. Owner functions authorize reads.
ALTER TABLE governance_catalog.source_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_catalog.object ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_catalog.version ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_catalog.event ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON ALL TABLES IN SCHEMA governance_catalog TO hdi_prototype;

