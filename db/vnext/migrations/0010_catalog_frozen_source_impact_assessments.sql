-- Reviewed source effects are frozen before their governing event; historical approvals are never invented.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND application_name='hdi-vnext-catalog') THEN RAISE EXCEPTION 'CATALOG_RUNTIME_MUST_BE_STOPPED'; END IF;
END $$;
SELECT pg_advisory_xact_lock(901002);
ALTER TABLE governance_catalog.event ADD CONSTRAINT catalog_event_head_object UNIQUE(head,object_id);
CREATE TABLE governance_catalog.source_assessment (
 event_head bigint PRIMARY KEY, object_id uuid NOT NULL REFERENCES governance_catalog.object(id),
 action text NOT NULL CHECK(action IN ('PUBLISH','RETIRE')), request_id uuid NOT NULL,
 reviewer_actor text NOT NULL, reviewer_identity text NOT NULL, reason text NOT NULL,
 content jsonb NOT NULL, digest text NOT NULL,
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 FOREIGN KEY(event_head,object_id) REFERENCES governance_catalog.event(head,object_id) DEFERRABLE INITIALLY DEFERRED,
 UNIQUE(reviewer_identity,request_id),
 CHECK(content->>'target'=object_id::text AND content->>'action'=action),
 CHECK(digest=encode(sha256(convert_to(content::text,'UTF8')),'hex'))
);
CREATE TRIGGER source_assessment_immutable BEFORE UPDATE OR DELETE ON governance_catalog.source_assessment FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
REVOKE ALL ON governance_catalog.source_assessment FROM PUBLIC,hdi_prototype;
ALTER TABLE governance_catalog.impact_event ADD COLUMN assessment_head bigint REFERENCES governance_catalog.source_assessment(event_head);
ALTER TABLE governance_catalog.impact_event ADD CONSTRAINT impact_downstream_version_object FOREIGN KEY(downstream_version,downstream_object) REFERENCES governance_catalog.version(id,object_id);
ALTER TABLE governance_catalog.impact_event ADD CONSTRAINT impact_upstream_event_object FOREIGN KEY(upstream_event,upstream_object) REFERENCES governance_catalog.event(head,object_id);
CREATE FUNCTION governance_catalog.source_projected_span(p_version uuid,p_as_of timestamp,p_target uuid,p_preview uuid,p_retire boolean) RETURNS tsmultirange
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
 SELECT CASE WHEN p_retire AND v.object_id=p_target THEN '{}'::tsmultirange ELSE coalesce((SELECT s.effective_span FROM governance_catalog.definition_spans(v.object_id,p_as_of,CASE WHEN v.object_id=p_target THEN p_preview ELSE NULL END) s WHERE s.version_id=v.id),'{}'::tsmultirange) END
 FROM governance_catalog.version v WHERE v.id=p_version
$$;
CREATE FUNCTION governance_catalog.source_projected_valid_spans(p_version uuid,p_as_of timestamp,p_target uuid,p_preview uuid,p_retire boolean,p_path uuid[] DEFAULT '{}') RETURNS tsmultirange
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE ver governance_catalog.version; own_span tsmultirange; parent_id uuid;
BEGIN
 IF p_version=ANY(p_path) THEN RETURN '{}'::tsmultirange; END IF;
 SELECT v.* INTO ver FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_version AND o.kind='SOURCE';
 IF NOT FOUND THEN RETURN '{}'::tsmultirange; END IF;
 own_span:=governance_catalog.source_projected_span(ver.id,p_as_of,p_target,p_preview,p_retire);
 IF own_span IS NULL OR isempty(own_span) THEN RETURN '{}'::tsmultirange; END IF;
 IF ver.payload->>'sourceEvidence'='SYNTHETIC_BOOTSTRAP' THEN RETURN own_span; END IF;
 SELECT v.id INTO parent_id FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id JOIN governance_catalog.object child ON child.id=ver.object_id
 WHERE v.id=(ver.payload->>'sourceEvidenceVersion')::uuid AND v.object_id=(ver.payload->>'sourceEvidence')::uuid AND o.kind='SOURCE' AND o.scope=child.scope;
 IF parent_id IS NULL THEN RETURN '{}'::tsmultirange; END IF;
 RETURN own_span * governance_catalog.source_projected_valid_spans(parent_id,p_as_of,p_target,p_preview,p_retire,p_path||ver.id);
END $$;
CREATE OR REPLACE FUNCTION governance_catalog.source_valid_spans(p_version uuid,p_as_of timestamp,p_path uuid[] DEFAULT '{}') RETURNS tsmultirange
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
 SELECT governance_catalog.source_projected_valid_spans(p_version,p_as_of,NULL,NULL,false,p_path)
$$;
REVOKE ALL ON FUNCTION governance_catalog.source_projected_span(uuid,timestamp,uuid,uuid,boolean),governance_catalog.source_projected_valid_spans(uuid,timestamp,uuid,uuid,boolean,uuid[]) FROM PUBLIC,hdi_prototype;
CREATE FUNCTION governance_catalog.source_proposed_impact(p_target uuid,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE at_r timestamp; maintenance governance_catalog.event; accepted governance_catalog.event; preview uuid; base jsonb; ref jsonb; ver governance_catalog.version; before_span tsmultirange; after_span tsmultirange; before_bad tsmultirange; after_bad tsmultirange; opening jsonb:='[]'; closing jsonb:='[]'; definitions jsonb:='[]'; item governance_catalog.impact_event; parent_event bigint; chosen uuid; definition_digest text;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('PUBLISH','RETIRE') THEN RAISE EXCEPTION 'INVALID_IMPACT_ACTION'; END IF;
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=p_target AND kind='SOURCE') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 -- A stable knowledge watermark, not wall-clock time: unchanged facts yield the same reviewed digest.
 SELECT greatest((SELECT max(recorded_at) FROM governance_catalog.event),(SELECT max(recorded_at) FROM governance_catalog.impact_event)) INTO at_r;
 SELECT * INTO maintenance FROM governance_catalog.event WHERE object_id=p_target ORDER BY head DESC LIMIT 1;
 SELECT * INTO accepted FROM governance_catalog.event WHERE object_id=p_target AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1;
 preview:=CASE WHEN p_action='PUBLISH' THEN maintenance.version_id ELSE NULL END;
 chosen:=CASE WHEN p_action='PUBLISH' THEN maintenance.version_id ELSE accepted.version_id END;
 SELECT encode(sha256(convert_to(jsonb_build_object('payload',v.payload,'validFrom',v.valid_from,'validTo',v.valid_to)::text,'UTF8')),'hex') INTO definition_digest FROM governance_catalog.version v WHERE v.id=chosen;
 base:=governance_catalog.source_impact(p_target);
 FOR ref IN SELECT value FROM jsonb_array_elements(base->'current') LOOP
  before_span:=governance_catalog.source_projected_span((ref->>'versionId')::uuid,at_r,NULL,NULL,false);
  before_bad:=before_span-governance_catalog.source_valid_spans((ref->>'versionId')::uuid,at_r);
  after_span:=governance_catalog.source_projected_span((ref->>'versionId')::uuid,at_r,p_target,preview,p_action='RETIRE');
  after_bad:=after_span-governance_catalog.source_projected_valid_spans((ref->>'versionId')::uuid,at_r,p_target,preview,p_action='RETIRE');
  IF NOT isempty(after_bad-before_bad) THEN opening:=opening||jsonb_build_array(jsonb_build_object('upstreamObject',p_target,'upstreamEvent','PROPOSED_EVENT','downstreamObject',ref->>'id','downstreamVersion',ref->>'versionId','effectiveSpans',after_span::text,'affectedSpans',after_bad::text,'reason',CASE WHEN p_action='RETIRE' THEN 'UPSTREAM_SOURCE_RETIRED' ELSE 'UPSTREAM_SOURCE_REPUBLISHED' END)); END IF;
 END LOOP;
 FOR ver IN SELECT * FROM governance_catalog.version WHERE object_id=p_target ORDER BY number LOOP
  before_span:=governance_catalog.source_projected_span(ver.id,at_r,NULL,NULL,false);
  after_span:=governance_catalog.source_projected_span(ver.id,at_r,p_target,preview,p_action='RETIRE');
  IF NOT isempty(before_span) OR NOT isempty(after_span) OR ver.id=maintenance.version_id THEN
   definitions:=definitions||jsonb_build_array(jsonb_build_object('id',p_target,'versionId',ver.id,'beforeSpans',before_span::text,'proposedSpans',after_span::text,'digest',encode(sha256(convert_to(jsonb_build_object('payload',ver.payload,'validFrom',ver.valid_from,'validTo',ver.valid_to)::text,'UTF8')),'hex')));
  END IF;
  before_bad:=before_span-governance_catalog.source_valid_spans(ver.id,at_r);
  after_bad:=after_span-governance_catalog.source_projected_valid_spans(ver.id,at_r,p_target,preview,p_action='RETIRE');
  IF NOT isempty(after_bad-before_bad) AND ver.payload->>'sourceEvidence'<>'SYNTHETIC_BOOTSTRAP' THEN
   SELECT head INTO STRICT parent_event FROM governance_catalog.event WHERE object_id=(ver.payload->>'sourceEvidence')::uuid AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1;
   opening:=opening||jsonb_build_array(jsonb_build_object('upstreamObject',ver.payload->>'sourceEvidence','upstreamEvent',parent_event::text,'downstreamObject',p_target,'downstreamVersion',ver.id,'effectiveSpans',after_span::text,'affectedSpans',after_bad::text,'reason','SOURCE_REVISION_EXPOSED_PIN'));
  END IF;
 END LOOP;
 FOR item IN SELECT i.* FROM governance_catalog.impact_event i WHERE i.downstream_object=p_target AND i.event_sequence=1 AND NOT EXISTS(SELECT 1 FROM governance_catalog.impact_event c WHERE c.case_id=i.case_id AND c.event_sequence=2) ORDER BY i.case_id LOOP
  after_span:=governance_catalog.source_projected_span(item.downstream_version,at_r,p_target,preview,p_action='RETIRE');
  after_bad:=after_span-governance_catalog.source_projected_valid_spans(item.downstream_version,at_r,p_target,preview,p_action='RETIRE');
  IF isempty(after_bad) THEN closing:=closing||jsonb_build_array(jsonb_build_object('caseId',item.case_id,'upstreamObject',item.upstream_object,'upstreamEvent',item.upstream_event::text,'downstreamObject',item.downstream_object,'downstreamVersion',item.downstream_version)); END IF;
 END LOOP;
 RETURN base||jsonb_build_object('action',p_action,'asOf',to_char(at_r,'YYYY-MM-DD"T"HH24:MI:SS.US'),'catalogHead',(SELECT max(head)::text FROM governance_catalog.event),'candidateVersionId',maintenance.version_id,'definitionVersionId',chosen,'definitionDigest',definition_digest,'targetDefinitions',definitions,'opening',opening,'closing',closing);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.source_proposed_impact(uuid,text) FROM PUBLIC,hdi_prototype;
CREATE FUNCTION vnext_control.require_assessment_access(p_actor text,p_scope text,p_assessment jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control,governance_catalog AS $$
DECLARE ref jsonb; payload jsonb;
BEGIN
 PERFORM vnext_control.require_object(p_actor,p_scope,(p_assessment->>'target')::uuid,'READ','METADATA');
 FOR ref IN SELECT value FROM jsonb_array_elements((p_assessment->'history')||(p_assessment->'current')||(p_assessment->'targetDefinitions')) LOOP
  SELECT v.payload INTO payload FROM governance_catalog.version v WHERE id=(ref->>'versionId')::uuid;
  PERFORM vnext_control.require_object(p_actor,p_scope,(ref->>'id')::uuid,'READ','METADATA',payload);
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements((p_assessment->'opening')||(p_assessment->'closing')) LOOP
  SELECT v.payload INTO payload FROM governance_catalog.version v WHERE id=(ref->>'downstreamVersion')::uuid;
  PERFORM vnext_control.require_object(p_actor,p_scope,(ref->>'downstreamObject')::uuid,'READ','METADATA',payload);
  IF ref->>'upstreamEvent'='PROPOSED_EVENT' THEN
   SELECT v.payload INTO payload FROM governance_catalog.version v WHERE id=(p_assessment->>'definitionVersionId')::uuid AND object_id=(ref->>'upstreamObject')::uuid;
  ELSE
   SELECT v.payload INTO payload FROM governance_catalog.event e JOIN governance_catalog.version v ON v.id=e.version_id WHERE e.head=(ref->>'upstreamEvent')::bigint AND e.object_id=(ref->>'upstreamObject')::uuid;
  END IF;
  IF payload IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  PERFORM vnext_control.require_object(p_actor,p_scope,(ref->>'upstreamObject')::uuid,'READ','METADATA',payload);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION vnext_control.require_assessment_access(text,text,jsonb) FROM PUBLIC,hdi_prototype;
DROP FUNCTION governance_catalog.change_impact(text,text,uuid);
CREATE FUNCTION governance_catalog.change_impact(p_actor text,p_scope text,p_target uuid,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$ DECLARE result jsonb; BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM vnext_control.require_object(p_actor,p_scope,p_target,'READ','METADATA');
 result:=governance_catalog.source_proposed_impact(p_target,p_action);PERFORM vnext_control.require_assessment_access(p_actor,p_scope,result);
 RETURN result||jsonb_build_object('impactDigest',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION governance_catalog.change_impact(text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance_catalog.change_impact(text,text,uuid,text) TO hdi_prototype;
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
  IF EXISTS(SELECT 1 FROM governance_catalog.source_assessment WHERE event_head=(existing.result->>'head')::bigint) THEN
   PERFORM vnext_control.require_assessment_access(p_actor,sc,(SELECT content FROM governance_catalog.source_assessment WHERE event_head=(existing.result->>'head')::bigint));
  END IF;
  IF payload->>'sourceEvidence' IS NOT NULL AND payload->>'sourceEvidence'<>'SYNTHETIC_BOOTSTRAP' THEN PERFORM vnext_control.require_source_access(p_actor,sc,(payload->>'sourceEvidence')::uuid,(payload->>'sourceEvidenceVersion')::uuid); END IF;
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
 begin_b timestamp; end_b timestamp; requested_digest text; assessment jsonb; assessment_digest text; allocated_head bigint; frozen governance_catalog.source_assessment; other record; prospective record; source_object uuid;
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
   IF object_kind<>'SOURCE' AND input ? 'impactDigest' THEN RAISE EXCEPTION 'ACTION_FIELDS_FORBIDDEN'; END IF;
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
   IF object_kind<>'SOURCE' AND input ? 'impactDigest' THEN RAISE EXCEPTION 'ACTION_FIELDS_FORBIDDEN'; END IF;
   next_status:='RETIRED';
  ELSE RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
 END IF;
 IF object_kind='SOURCE' AND action IN ('PUBLISH','RETIRE') THEN
  assessment:=governance_catalog.source_proposed_impact(target,action);
  PERFORM vnext_control.require_assessment_access(actor,sc,assessment);
  assessment_digest:=encode(sha256(convert_to(assessment::text,'UTF8')),'hex');
  IF (input ? 'impactDigest' OR jsonb_array_length(assessment->'opening')>0 OR jsonb_array_length(assessment->'closing')>0) AND coalesce(input->>'impactDigest','')<>assessment_digest THEN RAISE EXCEPTION 'IMPACT_REVIEW_MISMATCH'; END IF;
  allocated_head:=nextval('governance_catalog.event_head_seq');
  INSERT INTO governance_catalog.source_assessment(event_head,object_id,action,request_id,reviewer_actor,reviewer_identity,reason,content,digest)
  VALUES(allocated_head,target,action,req,actor,identity,input->>'reason',assessment,assessment_digest) RETURNING * INTO frozen;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,target,'SOURCE_IMPACT_REVIEWED','IMPACT_ASSESSMENT_BOUND',encode(sha256(convert_to(to_jsonb(frozen)::text,'UTF8')),'hex'));
  INSERT INTO governance_catalog.event(head,object_id,version_id,status,actor_code,reason) OVERRIDING SYSTEM VALUE VALUES(allocated_head,target,new_version,next_status,actor,input->>'reason') RETURNING * INTO ev;
 ELSE
  INSERT INTO governance_catalog.event(object_id,version_id,status,actor_code,reason) VALUES(target,new_version,next_status,actor,input->>'reason') RETURNING * INTO ev;
 END IF;
 SELECT * INTO ver FROM governance_catalog.version WHERE id=new_version;
 content_hash:=encode(sha256(convert_to(jsonb_build_object('payload',ver.payload,'validFrom',ver.valid_from,'validTo',ver.valid_to)::text,'UTF8')),'hex');
 result:=jsonb_build_object('id',target,'head',ev.head::text,'version',ver.number,'versionId',new_version,'status',next_status,'reviewDigest',content_hash,'recordedAt',to_char(ev.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,target,action,input->>'reason',content_hash);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(actor,req,requested_digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,actor);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION governance_catalog.record_source_impact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE frozen governance_catalog.source_assessment; ref jsonb; item governance_catalog.impact_event; source_event bigint;
BEGIN
 IF NEW.status NOT IN ('PUBLISHED','RETIRED') OR NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=NEW.object_id AND kind='SOURCE') THEN RETURN NEW; END IF;
 SELECT * INTO frozen FROM governance_catalog.source_assessment WHERE event_head=NEW.head;
 IF NOT FOUND THEN RAISE EXCEPTION 'IMPACT_ASSESSMENT_REQUIRED'; END IF;
 IF frozen.object_id<>NEW.object_id OR frozen.reviewer_actor<>NEW.actor_code OR frozen.action<>(CASE WHEN NEW.status='PUBLISHED' THEN 'PUBLISH' ELSE 'RETIRE' END) OR frozen.content->>'definitionVersionId'<>NEW.version_id::text THEN RAISE EXCEPTION 'IMPACT_ASSESSMENT_MISMATCH'; END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(frozen.content->'opening') LOOP
  source_event:=CASE WHEN ref->>'upstreamEvent'='PROPOSED_EVENT' THEN NEW.head ELSE (ref->>'upstreamEvent')::bigint END;
  INSERT INTO governance_catalog.impact_event(case_id,event_sequence,upstream_event,upstream_object,downstream_object,downstream_version,status,actor_code,reason,recorded_at,assessment_head)
  VALUES(uuidv7(),1,source_event,(ref->>'upstreamObject')::uuid,(ref->>'downstreamObject')::uuid,(ref->>'downstreamVersion')::uuid,'OPEN',NEW.actor_code,ref->>'reason',NEW.recorded_at,NEW.head) RETURNING * INTO item;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(NEW.actor_code,item.case_id,'IMPACT_OPEN',item.reason,encode(sha256(convert_to(to_jsonb(item)::text,'UTF8')),'hex'));
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(frozen.content->'closing') LOOP
  SELECT i.* INTO item FROM governance_catalog.impact_event i WHERE i.case_id=(ref->>'caseId')::uuid AND i.event_sequence=1 AND NOT EXISTS(SELECT 1 FROM governance_catalog.impact_event c WHERE c.case_id=i.case_id AND c.event_sequence=2);
  IF NOT FOUND OR item.downstream_object<>NEW.object_id OR item.downstream_version<>(ref->>'downstreamVersion')::uuid THEN RAISE EXCEPTION 'IMPACT_ASSESSMENT_MISMATCH'; END IF;
  INSERT INTO governance_catalog.impact_event(case_id,event_sequence,upstream_event,upstream_object,downstream_object,downstream_version,status,actor_code,reason,recorded_at,resolution_event,assessment_head)
  VALUES(item.case_id,2,item.upstream_event,item.upstream_object,item.downstream_object,item.downstream_version,'CLOSED',NEW.actor_code,CASE WHEN NEW.status='RETIRED' THEN 'DOWNSTREAM_RETIRED' ELSE 'DOWNSTREAM_REQUALIFIED' END,NEW.recorded_at,NEW.head,NEW.head) RETURNING * INTO item;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(NEW.actor_code,item.case_id,'IMPACT_CLOSED',item.reason,encode(sha256(convert_to(to_jsonb(item)::text,'UTF8')),'hex'));
 END LOOP;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION governance_catalog.impact_cases_raw(actor text, requested_scope text, target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE result jsonb;
BEGIN
 PERFORM vnext_control.authorize(actor,requested_scope,'READ');
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=target AND scope=requested_scope AND kind='SOURCE') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('assessment_head',i.assessment_head::text,'upstream_event',i.upstream_event::text,'resolution_event',i.resolution_event::text,'events',(SELECT jsonb_agg(to_jsonb(h)||jsonb_build_object('assessment_head',h.assessment_head::text,'upstream_event',h.upstream_event::text,'resolution_event',h.resolution_event::text) ORDER BY h.event_sequence) FROM governance_catalog.impact_event h WHERE h.case_id=i.case_id)) ORDER BY i.case_id),'[]'::jsonb) INTO result FROM (SELECT DISTINCT ON(case_id) * FROM governance_catalog.impact_event WHERE upstream_object=target ORDER BY case_id,event_sequence DESC) i;
 RETURN result;
END $$;

-- Current observations for any pre-0010 untracked exposed versions; no retroactive approved assessment.
DO $$ DECLARE upstream record; affected jsonb; item governance_catalog.impact_event; BEGIN
 FOR upstream IN SELECT o.id,e.head FROM governance_catalog.object o JOIN LATERAL(SELECT head FROM governance_catalog.event WHERE object_id=o.id AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1) e ON true WHERE o.kind='SOURCE' LOOP
  FOR affected IN SELECT value FROM jsonb_array_elements(governance_catalog.source_impact(upstream.id)->'current') WHERE value->>'affectedSpans'<>'{}' LOOP
   IF NOT EXISTS(SELECT 1 FROM governance_catalog.impact_event i WHERE i.upstream_object=upstream.id AND i.downstream_version=(affected->>'versionId')::uuid AND i.event_sequence=1 AND NOT EXISTS(SELECT 1 FROM governance_catalog.impact_event c WHERE c.case_id=i.case_id AND c.event_sequence=2)) THEN
    INSERT INTO governance_catalog.impact_event(case_id,event_sequence,upstream_event,upstream_object,downstream_object,downstream_version,status,actor_code,reason)
    VALUES(uuidv7(),1,upstream.head,upstream.id,(affected->>'id')::uuid,(affected->>'versionId')::uuid,'OPEN','VNEXT_MIGRATION','UPGRADE_ASSESSMENT_IMPACT_OBSERVATION') RETURNING * INTO item;
    INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES('VNEXT_MIGRATION',item.case_id,'IMPACT_OPEN',item.reason,encode(sha256(convert_to(to_jsonb(item)::text,'UTF8')),'hex'));
   END IF;
  END LOOP;
 END LOOP;
END $$;
