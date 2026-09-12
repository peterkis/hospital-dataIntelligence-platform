-- Forward-only import audit and bounded metadata source-impact governance.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND application_name='hdi-vnext-catalog') THEN RAISE EXCEPTION 'CATALOG_RUNTIME_MUST_BE_STOPPED'; END IF;
END $$;
SELECT pg_advisory_xact_lock(901002);
-- Existing unaudited imports receive current observations, never backdated import proof.
INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest)
SELECT 'VNEXT_MIGRATION',o.id,'BASELINE_IMPORT_OBSERVED','UPGRADE_OBSERVATION',encode(sha256(convert_to(jsonb_build_object('code',o.code,'versionId',v.id,'payload',v.payload,'validFrom',v.valid_from,'sourceDigest',s.sha256)::text,'UTF8')),'hex')
FROM governance_catalog.object o JOIN governance_catalog.version v ON v.object_id=o.id AND v.number=1 CROSS JOIN governance_catalog.source_snapshot s
WHERE o.scope='BASELINE' AND o.kind='DATASET' AND s.source_key='PACKAGE_V2' AND NOT EXISTS(SELECT 1 FROM vnext_control.audit a WHERE a.object_id=o.id AND a.action IN ('BASELINE_IMPORT','BASELINE_IMPORT_OBSERVED'));
INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest)
SELECT 'VNEXT_MIGRATION',s.id,'BASELINE_IMPORT_BATCH_OBSERVED','UPGRADE_OBSERVATION',encode(sha256(convert_to(jsonb_build_object('sourceDigest',s.sha256,'datasets',jsonb_array_length(s.content->'records'),'manifestFiles',jsonb_array_length(s.content->'manifest'))::text,'UTF8')),'hex') FROM governance_catalog.source_snapshot s
WHERE s.source_key='PACKAGE_V2' AND NOT EXISTS(SELECT 1 FROM vnext_control.audit a WHERE a.object_id=s.id AND a.action IN ('BASELINE_IMPORT_BATCH','BASELINE_IMPORT_BATCH_OBSERVED'));

CREATE TABLE governance_catalog.impact_event (
 case_id uuid NOT NULL, event_sequence bigint NOT NULL CHECK(event_sequence IN (1,2)),
 upstream_event bigint NOT NULL REFERENCES governance_catalog.event(head),
 upstream_object uuid NOT NULL REFERENCES governance_catalog.object(id),
 downstream_object uuid NOT NULL REFERENCES governance_catalog.object(id),
 downstream_version uuid NOT NULL REFERENCES governance_catalog.version(id),
 status text NOT NULL CHECK(status IN ('OPEN','CLOSED')), actor_code text NOT NULL, reason text NOT NULL,
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 resolution_event bigint REFERENCES governance_catalog.event(head),
 PRIMARY KEY(case_id,event_sequence), UNIQUE(upstream_event,downstream_version,event_sequence),
 CHECK((event_sequence=1 AND status='OPEN' AND resolution_event IS NULL) OR (event_sequence=2 AND status='CLOSED' AND resolution_event IS NOT NULL))
);
CREATE TRIGGER impact_immutable BEFORE UPDATE OR DELETE ON governance_catalog.impact_event FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
REVOKE ALL ON governance_catalog.impact_event FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.source_impact(target uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
 WITH RECURSIVE references_to AS (
  SELECT v.id,v.object_id,v.number,v.payload,v.recorded_at,(v.payload->>'sourceEvidenceVersion')::uuid AS root_version,ARRAY[v.id] AS path FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id
  WHERE o.kind='SOURCE' AND EXISTS(SELECT 1 FROM governance_catalog.version parent WHERE parent.id=(v.payload->>'sourceEvidenceVersion')::uuid AND parent.object_id=target)
  UNION ALL
  SELECT v.id,v.object_id,v.number,v.payload,v.recorded_at,r.root_version,r.path||v.id FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id JOIN references_to r ON (v.payload->>'sourceEvidenceVersion')::uuid=r.id
  WHERE o.kind='SOURCE' AND NOT v.id=ANY(r.path)
 ), refs AS (SELECT DISTINCT id,object_id,number,recorded_at,root_version FROM references_to), current_refs AS (
  SELECT r.*,e.head FROM refs r JOIN LATERAL(SELECT head,status,version_id FROM governance_catalog.event WHERE object_id=r.object_id AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1) e ON e.version_id=r.id AND e.status='PUBLISHED'
 )
 SELECT jsonb_build_object('effectiveMode','ON_COMMIT','target',target,'head',(SELECT max(head)::text FROM governance_catalog.event WHERE object_id=target),
 'current',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.object_id,'versionId',r.id,'code',o.code,'version',r.number,'head',r.head::text,'rootVersionId',r.root_version) ORDER BY o.code,r.id) FROM current_refs r JOIN governance_catalog.object o ON o.id=r.object_id),'[]'::jsonb),
 'history',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.object_id,'versionId',r.id,'code',o.code,'version',r.number,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')) ORDER BY o.code,r.number) FROM refs r JOIN governance_catalog.object o ON o.id=r.object_id),'[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION governance_catalog.source_impact(uuid) FROM PUBLIC,hdi_prototype;
CREATE FUNCTION governance_catalog.change_impact(actor text, requested_scope text, target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE result jsonb;
BEGIN
 PERFORM vnext_control.authorize(actor,requested_scope,'READ');
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=target AND scope=requested_scope AND kind='SOURCE') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 result:=governance_catalog.source_impact(target);
 RETURN result||jsonb_build_object('impactDigest',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION governance_catalog.change_impact(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance_catalog.change_impact(text,text,uuid) TO hdi_prototype;

CREATE FUNCTION governance_catalog.record_source_impact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE affected jsonb; item governance_catalog.impact_event;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=NEW.object_id AND kind='SOURCE') THEN RETURN NEW; END IF;
 IF NEW.status IN ('RETIRED','PUBLISHED') THEN
  FOR affected IN SELECT value FROM jsonb_array_elements(governance_catalog.source_impact(NEW.object_id)->'current') LOOP
   INSERT INTO governance_catalog.impact_event(case_id,event_sequence,upstream_event,upstream_object,downstream_object,downstream_version,status,actor_code,reason,recorded_at)
   VALUES(uuidv7(),1,NEW.head,NEW.object_id,(affected->>'id')::uuid,(affected->>'versionId')::uuid,'OPEN',NEW.actor_code,CASE WHEN NEW.status='RETIRED' THEN 'UPSTREAM_SOURCE_RETIRED' ELSE 'UPSTREAM_SOURCE_REPUBLISHED' END,NEW.recorded_at) RETURNING * INTO item;
   INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(NEW.actor_code,item.case_id,'IMPACT_OPEN',item.reason,encode(sha256(convert_to(to_jsonb(item)::text,'UTF8')),'hex'));
  END LOOP;
 END IF;
 IF NEW.status IN ('PUBLISHED','RETIRED') THEN
  FOR item IN SELECT i.* FROM governance_catalog.impact_event i WHERE i.downstream_object=NEW.object_id AND i.event_sequence=1 AND NOT EXISTS(SELECT 1 FROM governance_catalog.impact_event c WHERE c.case_id=i.case_id AND c.event_sequence=2) LOOP
   INSERT INTO governance_catalog.impact_event VALUES(item.case_id,2,item.upstream_event,item.upstream_object,item.downstream_object,item.downstream_version,'CLOSED',NEW.actor_code,CASE WHEN NEW.status='RETIRED' THEN 'DOWNSTREAM_RETIRED' ELSE 'DOWNSTREAM_REQUALIFIED' END,NEW.recorded_at,NEW.head) RETURNING * INTO item;
   INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(NEW.actor_code,item.case_id,'IMPACT_CLOSED',item.reason,encode(sha256(convert_to(to_jsonb(item)::text,'UTF8')),'hex'));
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.record_source_impact() FROM PUBLIC,hdi_prototype;
CREATE TRIGGER source_impact_after_event AFTER INSERT ON governance_catalog.event FOR EACH ROW EXECUTE FUNCTION governance_catalog.record_source_impact();

CREATE FUNCTION governance_catalog.impact_cases(actor text, requested_scope text, target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE result jsonb;
BEGIN
 PERFORM vnext_control.authorize(actor,requested_scope,'READ');
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=target AND scope=requested_scope AND kind='SOURCE') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('upstream_event',i.upstream_event::text,'resolution_event',i.resolution_event::text,'events',(SELECT jsonb_agg(to_jsonb(h)||jsonb_build_object('upstream_event',h.upstream_event::text,'resolution_event',h.resolution_event::text) ORDER BY h.event_sequence) FROM governance_catalog.impact_event h WHERE h.case_id=i.case_id)) ORDER BY i.case_id),'[]'::jsonb) INTO result FROM (SELECT DISTINCT ON(case_id) * FROM governance_catalog.impact_event WHERE upstream_object=target ORDER BY case_id,event_sequence DESC) i;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.impact_cases(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance_catalog.impact_cases(text,text,uuid) TO hdi_prototype;
-- Current observations for still-affected descendants of already-retired sources.
DO $$ DECLARE retired record; affected jsonb; item governance_catalog.impact_event; BEGIN
 FOR retired IN SELECT o.id,e.head,e.status,e.version_id FROM governance_catalog.object o JOIN LATERAL(SELECT head,status,version_id FROM governance_catalog.event WHERE object_id=o.id AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1) e ON true WHERE o.kind='SOURCE' LOOP
  FOR affected IN SELECT value FROM jsonb_array_elements(governance_catalog.source_impact(retired.id)->'current') WHERE retired.status='RETIRED' OR value->>'rootVersionId'<>retired.version_id::text LOOP
   INSERT INTO governance_catalog.impact_event(case_id,event_sequence,upstream_event,upstream_object,downstream_object,downstream_version,status,actor_code,reason)
   VALUES(uuidv7(),1,retired.head,retired.id,(affected->>'id')::uuid,(affected->>'versionId')::uuid,'OPEN','VNEXT_MIGRATION','UPGRADE_IMPACT_OBSERVATION') RETURNING * INTO item;
   INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES('VNEXT_MIGRATION',item.case_id,'IMPACT_OPEN',item.reason,encode(sha256(convert_to(to_jsonb(item)::text,'UTF8')),'hex'));
  END LOOP;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION governance_catalog.command(actor text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
<<catalog_write>>
DECLARE identity text; action text:=input->>'action'; sc text:=input->>'scope'; object_kind text:=input->>'kind'; object_code text:=input->>'code';
 req uuid; target uuid; existing vnext_control.outcome; obj governance_catalog.object; ver governance_catalog.version; ev governance_catalog.event;
 payload jsonb; patch jsonb:=coalesce(input->'values','{}'); content_hash text; result jsonb; next_status text; new_version uuid;
 begin_b timestamp; end_b timestamp; requested_digest text; other record; source_object uuid;
BEGIN
 identity:=vnext_control.authorize(actor,sc,CASE WHEN action IN ('PUBLISH','REJECT','RETIRE') THEN 'REVIEW' ELSE 'WRITE' END);
 IF jsonb_typeof(input)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('action','scope','kind','code','requestId','target','expectedHead','values','reason','reviewDigest','validFrom','validTo','impactDigest')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 IF action NOT IN ('CREATE','REVISE','SUBMIT','PUBLISH','REJECT','RETIRE') OR coalesce(input->>'reason','') !~ '^[A-Z0-9_]{1,64}$' OR coalesce(input->>'requestId','') !~ '^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('action','scope','requestId','reason') AND NOT (
  (action='CREATE' AND k IN ('kind','code','values','validFrom','validTo')) OR
  (action='REVISE' AND k IN ('target','expectedHead','values','validFrom','validTo')) OR
  (action IN ('SUBMIT','REJECT') AND k IN ('target','expectedHead')) OR
  (action='PUBLISH' AND k IN ('target','expectedHead','reviewDigest','impactDigest')) OR
  (action='RETIRE' AND k IN ('target','expectedHead','reviewDigest','impactDigest'))
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
  IF end_b IS NOT NULL AND end_b<=begin_b THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD'; END IF;
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
   IF object_kind='SOURCE' AND (input ? 'impactDigest' OR jsonb_array_length(governance_catalog.source_impact(target)->'current')>0) THEN
    IF coalesce(input->>'impactDigest','')<>encode(sha256(convert_to(governance_catalog.source_impact(target)::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'IMPACT_REVIEW_MISMATCH'; END IF;
   ELSIF object_kind<>'SOURCE' AND input ? 'impactDigest' THEN RAISE EXCEPTION 'ACTION_FIELDS_FORBIDDEN'; END IF;
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
   IF object_kind='SOURCE' THEN
    IF coalesce(input->>'impactDigest','')<>encode(sha256(convert_to(governance_catalog.source_impact(target)::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'IMPACT_REVIEW_MISMATCH'; END IF;
   ELSIF input ? 'impactDigest' THEN RAISE EXCEPTION 'ACTION_FIELDS_FORBIDDEN'; END IF;
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
