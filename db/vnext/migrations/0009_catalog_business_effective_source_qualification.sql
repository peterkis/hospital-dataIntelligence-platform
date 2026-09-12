-- SOURCE registry definitions use one coherent B/R timeline and immutable exact parent pins.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND application_name='hdi-vnext-catalog') THEN RAISE EXCEPTION 'CATALOG_RUNTIME_MUST_BE_STOPPED'; END IF;
END $$;
SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION governance_catalog.source_valid_spans(p_version uuid,p_as_of timestamp,p_path uuid[] DEFAULT '{}') RETURNS tsmultirange
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE ver governance_catalog.version; own_span tsmultirange; parent_id uuid;
BEGIN
 IF p_version=ANY(p_path) THEN RETURN '{}'::tsmultirange; END IF;
 SELECT v.* INTO ver FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_version AND o.kind='SOURCE';
 IF NOT FOUND THEN RETURN '{}'::tsmultirange; END IF;
 SELECT effective_span INTO own_span FROM governance_catalog.definition_spans(ver.object_id,p_as_of) WHERE version_id=ver.id;
 IF own_span IS NULL OR isempty(own_span) THEN RETURN '{}'::tsmultirange; END IF;
 IF ver.payload->>'sourceEvidence'='SYNTHETIC_BOOTSTRAP' THEN RETURN own_span; END IF;
 SELECT v.id INTO parent_id FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id JOIN governance_catalog.object child ON child.id=ver.object_id
 WHERE v.id=(ver.payload->>'sourceEvidenceVersion')::uuid AND v.object_id=(ver.payload->>'sourceEvidence')::uuid AND o.kind='SOURCE' AND o.scope=child.scope;
 IF parent_id IS NULL THEN RETURN '{}'::tsmultirange; END IF;
 RETURN own_span * governance_catalog.source_valid_spans(parent_id,p_as_of,p_path||ver.id);
END $$;
CREATE FUNCTION governance_catalog.source_covering_version(p_source uuid,p_period tsrange) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
 WITH instant AS MATERIALIZED(SELECT timezone('Asia/Shanghai',clock_timestamp()) AS r)
 SELECT s.version_id FROM instant CROSS JOIN LATERAL governance_catalog.definition_spans(p_source,instant.r) s
 WHERE governance_catalog.source_valid_spans(s.version_id,instant.r) @> p_period
$$;
REVOKE ALL ON FUNCTION governance_catalog.source_valid_spans(uuid,timestamp,uuid[]),governance_catalog.source_covering_version(uuid,tsrange) FROM PUBLIC,hdi_prototype;
CREATE FUNCTION governance_catalog.assert_source_period_chain(p_target uuid,p_parent uuid,p_scope text,p_period tsrange,p_pin uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE seen uuid[]:=ARRAY[p_target]; ver governance_catalog.version; at_r timestamp:=timezone('Asia/Shanghai',clock_timestamp());
BEGIN
 LOOP
  IF p_parent=ANY(seen) THEN RAISE EXCEPTION 'SOURCE_REFERENCE_CYCLE'; END IF;
  seen:=seen||p_parent;
  IF p_pin IS NULL THEN p_pin:=governance_catalog.source_covering_version(p_parent,p_period); END IF;
  SELECT v.* INTO ver FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_pin AND o.id=p_parent AND o.kind='SOURCE' AND o.scope=p_scope;
  IF NOT FOUND OR NOT governance_catalog.source_valid_spans(ver.id,at_r) @> p_period THEN RAISE EXCEPTION 'SOURCE_PERIOD_NOT_COVERED'; END IF;
  IF ver.payload->>'sourceEvidence'='SYNTHETIC_BOOTSTRAP' THEN RETURN; END IF;
  p_parent:=(ver.payload->>'sourceEvidence')::uuid;p_pin:=(ver.payload->>'sourceEvidenceVersion')::uuid;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.assert_source_period_chain(uuid,uuid,text,tsrange,uuid) FROM PUBLIC,hdi_prototype;
CREATE OR REPLACE FUNCTION governance_catalog.resolve_source_raw(actor text,requested_scope text,target uuid,business_at text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE at_b timestamp:=governance_catalog.local_time(business_at); at_r timestamp:=timezone('Asia/Shanghai',clock_timestamp()); current_object uuid:=target; expected_version uuid; ver governance_catalog.version; original_version uuid; original_number integer; visited uuid[]:='{}';
BEGIN
 PERFORM vnext_control.authorize(actor,requested_scope,'READ');
 LOOP
  IF current_object=ANY(visited) THEN RAISE EXCEPTION 'SOURCE_REFERENCE_CYCLE'; END IF;
  visited:=visited||current_object;
  SELECT v.* INTO ver FROM governance_catalog.object o CROSS JOIN LATERAL governance_catalog.definition_spans(o.id,at_r) s JOIN governance_catalog.version v ON v.id=s.version_id
  WHERE o.id=current_object AND o.kind='SOURCE' AND o.scope=requested_scope AND s.effective_span @> at_b;
  IF NOT FOUND THEN
   IF current_object=target THEN PERFORM vnext_control.require_object(actor,requested_scope,target,'READ','SYNTHETIC_REFERENCE');RAISE EXCEPTION 'SOURCE_NOT_READY'; END IF;
   RAISE EXCEPTION 'SOURCE_EVIDENCE_NOT_READY';
  END IF;
  IF NOT vnext_control.definition_allowed(actor,current_object,ver.payload,'SYNTHETIC_REFERENCE') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF expected_version IS NOT NULL AND ver.id<>expected_version THEN RAISE EXCEPTION 'SOURCE_EVIDENCE_NOT_READY'; END IF;
  IF original_version IS NULL THEN original_version:=ver.id;original_number:=ver.number; END IF;
  IF ver.payload->>'sourceEvidence'='SYNTHETIC_BOOTSTRAP' THEN EXIT; END IF;
  current_object:=(ver.payload->>'sourceEvidence')::uuid;expected_version:=(ver.payload->>'sourceEvidenceVersion')::uuid;
 END LOOP;
 IF NOT governance_catalog.source_valid_spans(original_version,at_r) @> at_b THEN RAISE EXCEPTION 'SOURCE_EVIDENCE_NOT_READY'; END IF;
 RETURN jsonb_build_object('id',target,'versionId',original_version,'version',original_number::text,'qualification','SYNTHETIC_REGISTRY_REFERENCE_ONLY','interfaceReadiness','NOT_READY','realApply','NOT_IMPLEMENTED');
END $$;
CREATE OR REPLACE FUNCTION governance_catalog.resolve_source(p_actor text,p_scope text,p_target uuid,p_business_at text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 RETURN governance_catalog.resolve_source_raw(p_actor,p_scope,p_target,p_business_at);
END $$;
CREATE FUNCTION vnext_control.require_source_reference(p_actor text,p_scope text,p_source uuid,p_business_at text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control,governance_catalog AS $$ BEGIN
 PERFORM governance_catalog.resolve_source(p_actor,p_scope,p_source,p_business_at);
EXCEPTION WHEN raise_exception THEN
 IF SQLERRM='SOURCE_NOT_READY' THEN RAISE EXCEPTION 'SOURCE_EVIDENCE_NOT_READY'; END IF;
 RAISE;
END $$;
REVOKE ALL ON FUNCTION vnext_control.require_source_reference(text,text,uuid,text) FROM PUBLIC,hdi_prototype;
CREATE OR REPLACE FUNCTION governance_catalog.command(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; sc text:=p_input->>'scope'; action text:=p_input->>'action'; permission text; existing vnext_control.outcome; obj governance_catalog.object;
 target uuid; payload jsonb; proposed jsonb; dimensions jsonb; result jsonb; reference_id uuid; candidate_version uuid;
BEGIN
 permission:=CASE WHEN action IN ('PUBLISH','REJECT','RETIRE') THEN 'REVIEW' ELSE 'WRITE' END;
 identity:=vnext_control.authorize(p_actor,sc,permission);
 PERFORM pg_advisory_xact_lock(901002);
 identity:=vnext_control.authorize(p_actor,sc,permission);
 IF action IN ('PUBLISH','RETIRE') THEN PERFORM vnext_control.authorize(p_actor,sc,'PUBLISH'); END IF;
 SELECT o.* INTO existing FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=(p_input->>'requestId')::uuid;
 IF FOUND THEN
  target:=(existing.result->>'id')::uuid;
  SELECT v.payload INTO payload FROM governance_catalog.version v WHERE v.id=(existing.result->>'versionId')::uuid;
  PERFORM vnext_control.require_object(p_actor,sc,target,permission,'METADATA',payload);
  IF action IN ('PUBLISH','RETIRE') THEN PERFORM vnext_control.require_object(p_actor,sc,target,'PUBLISH','METADATA',payload); END IF;
  RETURN governance_catalog.command_raw(p_actor,p_input);
 END IF;
 IF action='CREATE' THEN
  dimensions:=vnext_control.object_dimensions(p_input->>'kind',p_input->'values');
  IF p_input->>'kind'='RESPONSIBILITY' AND (dimensions->>'campus'='INVALID' OR dimensions->>'fieldGroup'='INVALID') THEN RAISE EXCEPTION 'RESPONSIBILITY_SCOPE_REQUIRED'; END IF;
  PERFORM 1 FROM vnext_control.creation_policy WHERE creator_actor=p_actor FOR SHARE;
  IF sc<>'SYNTHETIC' OR NOT EXISTS(SELECT 1 FROM vnext_control.creation_policy p WHERE p.creator_actor=p_actor AND p.object_kind=p_input->>'kind' AND p.campus=dimensions->>'campus' AND p.field_group=dimensions->>'fieldGroup' AND p.purpose='METADATA') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF p_input->>'kind'='DATASET' THEN
   SELECT id INTO reference_id FROM governance_catalog.object WHERE kind='DATASET' AND scope='BASELINE' AND code=p_input->>'code';
   IF reference_id IS NOT NULL THEN PERFORM vnext_control.require_object(p_actor,'BASELINE',reference_id,'READ','METADATA'); END IF;
  ELSIF p_input->>'kind'='RESPONSIBILITY' THEN
   SELECT id INTO reference_id FROM governance_catalog.object WHERE kind='DATASET' AND scope='BASELINE' AND code=p_input->'values'->>'dataset';
   IF reference_id IS NOT NULL THEN PERFORM vnext_control.require_object(p_actor,'BASELINE',reference_id,'READ','METADATA'); END IF;
  END IF;
  IF p_input->>'kind'='SOURCE' AND coalesce(p_input->'values'->>'sourceEvidence','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN PERFORM vnext_control.require_source_reference(p_actor,sc,(p_input->'values'->>'sourceEvidence')::uuid,p_input->>'validFrom'); END IF;
  result:=governance_catalog.command_raw(p_actor,p_input);
  PERFORM vnext_control.grant_created_object(p_actor,(result->>'id')::uuid);
  RETURN result;
 END IF;
 target:=(p_input->>'target')::uuid;
 SELECT * INTO obj FROM governance_catalog.object WHERE id=target AND scope=sc;
 SELECT v.payload INTO payload FROM governance_catalog.event e JOIN governance_catalog.version v ON v.id=e.version_id WHERE e.object_id=target ORDER BY e.head DESC LIMIT 1;
 PERFORM vnext_control.require_object(p_actor,sc,target,permission,'METADATA');
 IF action IN ('PUBLISH','RETIRE') THEN PERFORM vnext_control.require_object(p_actor,sc,target,'PUBLISH','METADATA'); END IF;
 IF action IN ('PUBLISH','RETIRE') THEN
  IF action='PUBLISH' THEN SELECT version_id INTO candidate_version FROM governance_catalog.event WHERE object_id=target ORDER BY head DESC LIMIT 1; END IF;
  FOR proposed IN SELECT DISTINCT v.payload FROM (
   SELECT * FROM governance_catalog.definition_spans(target,timezone('Asia/Shanghai',clock_timestamp()))
   UNION ALL SELECT * FROM governance_catalog.definition_spans(target,timezone('Asia/Shanghai',clock_timestamp()),candidate_version)
  ) s JOIN governance_catalog.version v ON v.id=s.version_id WHERE NOT isempty(s.effective_span) LOOP
   PERFORM vnext_control.require_object(p_actor,sc,target,'REVIEW','METADATA',proposed);
   PERFORM vnext_control.require_object(p_actor,sc,target,'PUBLISH','METADATA',proposed);
  END LOOP;
 END IF;
 proposed:=CASE WHEN jsonb_typeof(p_input->'values')='object' THEN payload||(p_input->'values') ELSE payload END;
 IF action='REVISE' THEN PERFORM vnext_control.require_object(p_actor,sc,target,'WRITE','METADATA',proposed); END IF;
 IF obj.kind='SOURCE' AND action IN ('REVISE','PUBLISH') AND coalesce(proposed->>'sourceEvidence','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN PERFORM vnext_control.require_source_reference(p_actor,sc,(proposed->>'sourceEvidence')::uuid,coalesce(p_input->>'validFrom',(SELECT to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US') FROM governance_catalog.version v WHERE v.id=candidate_version))); END IF;
 IF obj.kind='SOURCE' AND action IN ('PUBLISH','RETIRE') THEN PERFORM vnext_control.require_impact_access(p_actor,sc,target); END IF;
 IF obj.kind='RESPONSIBILITY' AND action='REVISE' THEN
  SELECT id INTO reference_id FROM governance_catalog.object WHERE kind='DATASET' AND scope='BASELINE' AND code=proposed->>'dataset';
  IF reference_id IS NOT NULL THEN PERFORM vnext_control.require_object(p_actor,'BASELINE',reference_id,'READ','METADATA'); END IF;
 END IF;
 RETURN governance_catalog.command_raw(p_actor,p_input);
END $$;
CREATE OR REPLACE FUNCTION governance_catalog.command_raw(actor text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
<<catalog_write>>
DECLARE identity text; action text:=input->>'action'; sc text:=input->>'scope'; object_kind text:=input->>'kind'; object_code text:=input->>'code';
 req uuid; target uuid; existing vnext_control.outcome; obj governance_catalog.object; ver governance_catalog.version; ev governance_catalog.event;
 payload jsonb; patch jsonb:=coalesce(input->'values','{}'); content_hash text; result jsonb; next_status text; new_version uuid;
 begin_b timestamp; end_b timestamp; requested_digest text; other record; prospective record; source_object uuid;
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
  IF EXISTS(SELECT 1 FROM governance_catalog.object WHERE kind=object_kind AND scope=sc AND code=object_code) THEN RAISE EXCEPTION 'CATALOG_CODE_CONFLICT'; END IF;
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
  begin_b:=governance_catalog.local_time(input->>'validFrom');
  end_b:=CASE WHEN input->>'validTo' IS NULL THEN NULL ELSE governance_catalog.local_time(input->>'validTo') END;
  IF end_b IS NOT NULL AND end_b<=begin_b THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD'; END IF;
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
    PERFORM governance_catalog.assert_source_period_chain(target,source_object,sc,tsrange(begin_b,end_b,'[)'));
    IF NOT EXISTS(SELECT 1 FROM governance_catalog.object o JOIN LATERAL(SELECT status FROM governance_catalog.event WHERE object_id=o.id AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1) e ON true WHERE o.id=source_object AND o.kind='SOURCE' AND o.scope=sc AND e.status='PUBLISHED') THEN RAISE EXCEPTION 'SOURCE_EVIDENCE_NOT_READY'; END IF;
    new_version:=governance_catalog.source_covering_version(source_object,tsrange(begin_b,end_b,'[)'));
    IF new_version IS NULL THEN RAISE EXCEPTION 'SOURCE_PERIOD_NOT_COVERED'; END IF;
    payload:=payload||jsonb_build_object('sourceEvidenceVersion',new_version);
   END IF;
   payload:=payload||jsonb_build_object('readiness','METADATA_ONLY','interfaceReadiness','NOT_READY','approval_status','SYNTHETIC_ONLY');
  ELSE
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(patch) k WHERE k NOT IN ('dataset','authorityScope','fieldGroup','role','assigneeRole')) THEN RAISE EXCEPTION 'CLOSED_FIELDS_REQUIRED'; END IF;
   payload:=payload||patch;
   IF NOT EXISTS(SELECT 1 FROM governance_catalog.object o WHERE o.scope='BASELINE' AND o.kind='DATASET' AND o.code=payload->>'dataset') OR
    coalesce(payload->>'authorityScope','') NOT IN ('ALL','NORTH','SOUTH') OR coalesce(payload->>'fieldGroup','') NOT IN ('ALL','IDENTITY','CONTACT') OR coalesce(payload->>'role','') NOT IN ('OWNER','STEWARD','COLLABORATOR') OR coalesce(payload->>'assigneeRole','') NOT IN ('SYNTHETIC_OWNER_A','SYNTHETIC_OWNER_B','SYNTHETIC_STEWARD') THEN RAISE EXCEPTION 'RESPONSIBILITY_SCOPE_REQUIRED'; END IF;
  END IF;
  IF length(payload::text)>250000 OR EXISTS(SELECT 1 FROM jsonb_each_text(patch) p WHERE length(p.value)>2000) THEN RAISE EXCEPTION 'BOUNDED_INPUT_REQUIRED'; END IF;
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
   IF object_kind='SOURCE' AND payload->>'sourceEvidence'<>'SYNTHETIC_BOOTSTRAP' AND governance_catalog.source_covering_version((payload->>'sourceEvidence')::uuid,tsrange(ver.valid_from,ver.valid_to,'[)')) IS DISTINCT FROM (payload->>'sourceEvidenceVersion')::uuid THEN RAISE EXCEPTION 'SOURCE_PERIOD_NOT_COVERED'; END IF;
   IF object_kind='SOURCE' AND payload->>'sourceEvidence'<>'SYNTHETIC_BOOTSTRAP' THEN PERFORM governance_catalog.assert_source_period_chain(target,(payload->>'sourceEvidence')::uuid,sc,tsrange(ver.valid_from,ver.valid_to,'[)'),(payload->>'sourceEvidenceVersion')::uuid); END IF;
   IF object_kind='RESPONSIBILITY' THEN
    FOR prospective IN SELECT v.payload,s.effective_span FROM governance_catalog.definition_spans(target,timezone('Asia/Shanghai',clock_timestamp()),ver.id) s JOIN governance_catalog.version v ON v.id=s.version_id WHERE v.payload->>'role'='OWNER' AND NOT isempty(s.effective_span) LOOP
     FOR other IN SELECT v.payload,s.effective_span FROM governance_catalog.object o CROSS JOIN LATERAL governance_catalog.definition_spans(o.id,timezone('Asia/Shanghai',clock_timestamp())) s JOIN governance_catalog.version v ON v.id=s.version_id WHERE o.kind='RESPONSIBILITY' AND o.scope=sc AND o.id<>target AND v.payload->>'role'='OWNER' AND v.payload->>'dataset'=prospective.payload->>'dataset' LOOP
      IF (prospective.payload->>'authorityScope'='ALL' OR other.payload->>'authorityScope'='ALL' OR prospective.payload->>'authorityScope'=other.payload->>'authorityScope') AND
       (prospective.payload->>'fieldGroup'='ALL' OR other.payload->>'fieldGroup'='ALL' OR prospective.payload->>'fieldGroup'=other.payload->>'fieldGroup') AND
       prospective.effective_span && other.effective_span THEN RAISE EXCEPTION 'OWNER_PERIOD_CONFLICT'; END IF;
     END LOOP;
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

CREATE OR REPLACE FUNCTION governance_catalog.source_impact(target uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
 WITH RECURSIVE instant AS MATERIALIZED(SELECT timezone('Asia/Shanghai',clock_timestamp()) AS r), references_to AS (
  SELECT v.id,v.object_id,v.number,v.payload,v.recorded_at,(v.payload->>'sourceEvidenceVersion')::uuid AS root_version,ARRAY[v.id] AS path FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id
  WHERE o.kind='SOURCE' AND EXISTS(SELECT 1 FROM governance_catalog.version parent WHERE parent.id=(v.payload->>'sourceEvidenceVersion')::uuid AND parent.object_id=target)
  UNION ALL
  SELECT v.id,v.object_id,v.number,v.payload,v.recorded_at,r.root_version,r.path||v.id FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id JOIN references_to r ON (v.payload->>'sourceEvidenceVersion')::uuid=r.id
  WHERE o.kind='SOURCE' AND NOT v.id=ANY(r.path)
 ), refs AS (SELECT DISTINCT id,object_id,number,recorded_at,root_version FROM references_to), current_refs AS (
  SELECT r.*,s.published_head AS head,s.effective_span,s.effective_span-governance_catalog.source_valid_spans(r.id,instant.r) AS affected_span FROM refs r CROSS JOIN instant CROSS JOIN LATERAL governance_catalog.definition_spans(r.object_id,instant.r) s WHERE s.version_id=r.id AND NOT isempty(s.effective_span)
 )
 SELECT jsonb_build_object('effectiveMode','ON_COMMIT','target',target,'head',(SELECT max(head)::text FROM governance_catalog.event WHERE object_id=target),
 'current',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.object_id,'versionId',r.id,'code',o.code,'version',r.number,'head',r.head::text,'rootVersionId',r.root_version,'effectiveSpans',r.effective_span::text,'affectedSpans',r.affected_span::text) ORDER BY o.code,r.id) FROM current_refs r JOIN governance_catalog.object o ON o.id=r.object_id),'[]'::jsonb),
 'history',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.object_id,'versionId',r.id,'code',o.code,'version',r.number,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')) ORDER BY o.code,r.number) FROM refs r JOIN governance_catalog.object o ON o.id=r.object_id),'[]'::jsonb))
$$;
CREATE OR REPLACE FUNCTION governance_catalog.record_source_impact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE affected jsonb; item governance_catalog.impact_event;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=NEW.object_id AND kind='SOURCE') THEN RETURN NEW; END IF;
 IF NEW.status IN ('RETIRED','PUBLISHED') THEN
  FOR affected IN SELECT value FROM jsonb_array_elements(governance_catalog.source_impact(NEW.object_id)->'current') WHERE value->>'affectedSpans'<>'{}' LOOP
   INSERT INTO governance_catalog.impact_event(case_id,event_sequence,upstream_event,upstream_object,downstream_object,downstream_version,status,actor_code,reason,recorded_at)
   VALUES(uuidv7(),1,NEW.head,NEW.object_id,(affected->>'id')::uuid,(affected->>'versionId')::uuid,'OPEN',NEW.actor_code,CASE WHEN NEW.status='RETIRED' THEN 'UPSTREAM_SOURCE_RETIRED' ELSE 'UPSTREAM_SOURCE_REPUBLISHED' END,NEW.recorded_at) RETURNING * INTO item;
   INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(NEW.actor_code,item.case_id,'IMPACT_OPEN',item.reason,encode(sha256(convert_to(to_jsonb(item)::text,'UTF8')),'hex'));
  END LOOP;
 END IF;
 IF NEW.status IN ('PUBLISHED','RETIRED') THEN
  FOR item IN SELECT i.* FROM governance_catalog.impact_event i WHERE i.downstream_object=NEW.object_id AND i.event_sequence=1 AND NOT EXISTS(SELECT 1 FROM governance_catalog.impact_event c WHERE c.case_id=i.case_id AND c.event_sequence=2) LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(governance_catalog.source_impact(item.upstream_object)->'current') r WHERE (r->>'versionId')::uuid=item.downstream_version AND r->>'affectedSpans'<>'{}') THEN
   INSERT INTO governance_catalog.impact_event VALUES(item.case_id,2,item.upstream_event,item.upstream_object,item.downstream_object,item.downstream_version,'CLOSED',NEW.actor_code,CASE WHEN NEW.status='RETIRED' THEN 'DOWNSTREAM_RETIRED' ELSE 'DOWNSTREAM_REQUALIFIED' END,NEW.recorded_at,NEW.head) RETURNING * INTO item;
   INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(NEW.actor_code,item.case_id,'IMPACT_CLOSED',item.reason,encode(sha256(convert_to(to_jsonb(item)::text,'UTF8')),'hex'));
   END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;

-- A historical CLOSED assessment remains immutable; a newly observed obligation gets a new case identity.
DO $$ DECLARE constraint_name text; BEGIN
 SELECT c.conname INTO STRICT constraint_name FROM pg_constraint c WHERE c.conrelid='governance_catalog.impact_event'::regclass AND c.contype='u'
 AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,n) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.n)=ARRAY['upstream_event','downstream_version','event_sequence'];
 EXECUTE format('ALTER TABLE governance_catalog.impact_event DROP CONSTRAINT %I',constraint_name);
END $$;
DO $$ DECLARE upstream record; affected jsonb; item governance_catalog.impact_event; BEGIN
 FOR upstream IN SELECT o.id,e.head FROM governance_catalog.object o JOIN LATERAL(SELECT head FROM governance_catalog.event WHERE object_id=o.id AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1) e ON true WHERE o.kind='SOURCE' LOOP
  FOR affected IN SELECT value FROM jsonb_array_elements(governance_catalog.source_impact(upstream.id)->'current') WHERE value->>'affectedSpans'<>'{}' LOOP
   IF NOT EXISTS(SELECT 1 FROM governance_catalog.impact_event i WHERE i.upstream_object=upstream.id AND i.downstream_version=(affected->>'versionId')::uuid AND i.event_sequence=1 AND NOT EXISTS(SELECT 1 FROM governance_catalog.impact_event c WHERE c.case_id=i.case_id AND c.event_sequence=2)) THEN
    INSERT INTO governance_catalog.impact_event(case_id,event_sequence,upstream_event,upstream_object,downstream_object,downstream_version,status,actor_code,reason)
    VALUES(uuidv7(),1,upstream.head,upstream.id,(affected->>'id')::uuid,(affected->>'versionId')::uuid,'OPEN','VNEXT_MIGRATION','UPGRADE_TEMPORAL_IMPACT_OBSERVATION') RETURNING * INTO item;
    INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES('VNEXT_MIGRATION',item.case_id,'IMPACT_OPEN',item.reason,encode(sha256(convert_to(to_jsonb(item)::text,'UTF8')),'hex'));
   END IF;
  END LOOP;
 END LOOP;
END $$;
