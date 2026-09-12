-- Forward-only repair. Original audit/outcome rows and migrations are preserved.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND application_name='hdi-vnext-catalog') THEN RAISE EXCEPTION 'CATALOG_RUNTIME_MUST_BE_STOPPED'; END IF;
END $$;
SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION governance_catalog.assert_source_chain(target uuid, parent uuid, requested_scope text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE seen uuid[]:=ARRAY[target]; p jsonb; expected_version uuid; accepted record;
BEGIN
 LOOP
  IF parent=ANY(seen) THEN RAISE EXCEPTION 'SOURCE_REFERENCE_CYCLE'; END IF;
  seen:=array_append(seen,parent);
  SELECT e.status,e.version_id,v.payload INTO accepted FROM governance_catalog.object o
   JOIN LATERAL(SELECT * FROM governance_catalog.event WHERE object_id=o.id AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1) e ON true
   JOIN governance_catalog.version v ON v.id=e.version_id WHERE o.id=parent AND o.kind='SOURCE' AND o.scope=requested_scope;
  IF NOT FOUND OR accepted.status<>'PUBLISHED' OR (expected_version IS NOT NULL AND accepted.version_id<>expected_version) THEN RAISE EXCEPTION 'SOURCE_EVIDENCE_NOT_READY'; END IF;
  p:=accepted.payload;
  IF p->>'sourceEvidence'='SYNTHETIC_BOOTSTRAP' THEN RETURN; END IF;
  parent:=(p->>'sourceEvidence')::uuid; expected_version:=(p->>'sourceEvidenceVersion')::uuid;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.assert_source_chain(uuid,uuid,text) FROM PUBLIC,hdi_prototype;

ALTER TABLE vnext_control.actor_grant DROP CONSTRAINT actor_grant_permission_check;
ALTER TABLE vnext_control.actor_grant ADD CONSTRAINT actor_grant_permission_check CHECK(permission IN ('READ','WRITE','REVIEW','AUDIT'));
INSERT INTO vnext_control.actor VALUES ('auditor','SYNTHETIC_AUDITOR',true);
INSERT INTO vnext_control.actor_grant VALUES ('auditor','SYNTHETIC','AUDIT');
CREATE TABLE vnext_control.audit_chain (
 audit_stream_id text NOT NULL CHECK(audit_stream_id='GOVERNANCE_CATALOG'),
 audit_sequence bigint NOT NULL CHECK(audit_sequence>0),
 kind text NOT NULL CHECK(kind IN ('LEGACY_BASELINE','EVENT')),
 audit_id uuid UNIQUE REFERENCES vnext_control.audit(id),
 canonical_payload jsonb NOT NULL,
 previous_hash text NOT NULL CHECK(previous_hash ~ '^[a-f0-9]{64}$'),
 current_hash text NOT NULL CHECK(current_hash ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(audit_stream_id,audit_sequence),
 CHECK((kind='LEGACY_BASELINE' AND audit_sequence=1 AND audit_id IS NULL) OR (kind='EVENT' AND audit_sequence>1 AND audit_id IS NOT NULL))
);
CREATE TRIGGER audit_chain_immutable BEFORE UPDATE OR DELETE ON vnext_control.audit_chain FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
REVOKE ALL ON vnext_control.audit_chain FROM PUBLIC,hdi_prototype;
CREATE FUNCTION vnext_control.audit_hash(stream text, sequence bigint, previous text, payload jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(stream,sequence::text,previous,payload)::text,'UTF8')),'hex')
$$;
REVOKE ALL ON FUNCTION vnext_control.audit_hash(text,bigint,text,jsonb) FROM PUBLIC,hdi_prototype;
-- UUID sorting serializes an unordered legacy set; it does NOT claim an event order.
WITH baseline AS (SELECT jsonb_build_object('kind','LEGACY_BASELINE','count',count(*)::text,
 'setDigest',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb)::text,'UTF8')),'hex')) AS payload FROM vnext_control.audit a)
INSERT INTO vnext_control.audit_chain SELECT 'GOVERNANCE_CATALOG',1,'LEGACY_BASELINE',NULL,payload,repeat('0',64),vnext_control.audit_hash('GOVERNANCE_CATALOG',1,repeat('0',64),payload) FROM baseline;
CREATE FUNCTION vnext_control.append_audit_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control AS $$
DECLARE prior vnext_control.audit_chain; payload jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 SELECT * INTO STRICT prior FROM vnext_control.audit_chain WHERE audit_stream_id='GOVERNANCE_CATALOG' ORDER BY audit_sequence DESC LIMIT 1;
 payload:=jsonb_build_object('kind','EVENT','audit',to_jsonb(NEW));
 INSERT INTO vnext_control.audit_chain VALUES ('GOVERNANCE_CATALOG',prior.audit_sequence+1,'EVENT',NEW.id,payload,prior.current_hash,vnext_control.audit_hash('GOVERNANCE_CATALOG',prior.audit_sequence+1,prior.current_hash,payload));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION vnext_control.append_audit_chain() FROM PUBLIC,hdi_prototype;
CREATE TRIGGER audit_chain_append AFTER INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION vnext_control.append_audit_chain();
CREATE FUNCTION vnext_control.verify_audit(actor text, checkpoint_sequence bigint DEFAULT NULL, checkpoint_hash text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control AS $$
DECLARE row vnext_control.audit_chain; prior text:=repeat('0',64); previous_sequence bigint:=0; baseline jsonb; actual jsonb; events bigint:=0;
BEGIN
 PERFORM vnext_control.authorize(actor,'SYNTHETIC','AUDIT');
 PERFORM pg_advisory_xact_lock(901002);
 PERFORM 1 FROM vnext_control.actor a WHERE a.code=verify_audit.actor FOR SHARE;
 PERFORM 1 FROM vnext_control.actor_grant WHERE actor_code=actor AND scope='SYNTHETIC' AND permission='AUDIT' FOR SHARE;
 PERFORM vnext_control.authorize(actor,'SYNTHETIC','AUDIT');
 IF (checkpoint_sequence IS NULL)<>(checkpoint_hash IS NULL) THEN RAISE EXCEPTION 'AUDIT_CHECKPOINT_INVALID'; END IF;
 IF checkpoint_sequence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vnext_control.audit_chain WHERE audit_stream_id='GOVERNANCE_CATALOG' AND audit_sequence=checkpoint_sequence AND current_hash=checkpoint_hash) THEN RAISE EXCEPTION 'AUDIT_CHECKPOINT_MISMATCH'; END IF;
 FOR row IN SELECT * FROM vnext_control.audit_chain WHERE audit_stream_id='GOVERNANCE_CATALOG' ORDER BY audit_sequence LOOP
  IF row.audit_sequence<=previous_sequence OR row.previous_hash<>prior OR row.current_hash<>vnext_control.audit_hash(row.audit_stream_id,row.audit_sequence,row.previous_hash,row.canonical_payload) THEN RAISE EXCEPTION 'AUDIT_CHAIN_INVALID'; END IF;
  IF previous_sequence=0 THEN
   IF row.audit_sequence<>1 OR row.kind<>'LEGACY_BASELINE' THEN RAISE EXCEPTION 'AUDIT_BASELINE_MISSING'; END IF;
   baseline:=row.canonical_payload;
  ELSE
   SELECT jsonb_build_object('kind','EVENT','audit',to_jsonb(a)) INTO actual FROM vnext_control.audit a WHERE a.id=row.audit_id;
   IF row.kind<>'EVENT' OR actual IS DISTINCT FROM row.canonical_payload THEN RAISE EXCEPTION 'AUDIT_ROW_MISMATCH'; END IF;
   events:=events+1;
  END IF;
  prior:=row.current_hash; previous_sequence:=row.audit_sequence;
 END LOOP;
 IF previous_sequence=0 THEN RAISE EXCEPTION 'AUDIT_BASELINE_MISSING'; END IF;
 SELECT jsonb_build_object('kind','LEGACY_BASELINE','count',count(*)::text,'setDigest',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb)::text,'UTF8')),'hex')) INTO actual
 FROM vnext_control.audit a WHERE NOT EXISTS(SELECT 1 FROM vnext_control.audit_chain c WHERE c.audit_id=a.id);
 IF actual IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'AUDIT_LEGACY_SET_MISMATCH'; END IF;
 RETURN jsonb_build_object('status','PASS','auditStreamId','GOVERNANCE_CATALOG','auditSequence',previous_sequence::text,'currentHash',prior,'eventCount',events::text,'legacyCount',baseline->>'count','legacyProtection','UPGRADE_BASELINE_ONLY');
END $$;
REVOKE ALL ON FUNCTION vnext_control.verify_audit(text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vnext_control.verify_audit(text,bigint,text) TO hdi_prototype;

CREATE OR REPLACE FUNCTION governance_catalog.command(actor text, input jsonb) RETURNS jsonb
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


