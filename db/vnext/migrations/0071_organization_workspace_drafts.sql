SELECT pg_advisory_xact_lock(901002);
CREATE TABLE organization_master.workspace_draft_revision(
 id uuid NOT NULL,number bigint NOT NULL CHECK(number>0),identity_code text NOT NULL,maker text NOT NULL REFERENCES vnext_control.actor(code),
 request_id uuid NOT NULL,digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),metadata jsonb NOT NULL,envelope jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('EDITING','DISCARDED','SUBMITTED')),submission jsonb,CHECK((state='SUBMITTED')=(submission IS NOT NULL)),recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 PRIMARY KEY(id,number),UNIQUE(identity_code,request_id)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON organization_master.workspace_draft_revision FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
ALTER TABLE organization_master.workspace_draft_revision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON organization_master.workspace_draft_revision FROM PUBLIC,hdi_prototype;
CREATE FUNCTION organization_master.workspace_authorize(p_actor text,m jsonb,p_permission text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;sc text;target uuid:=(m->>'target')::uuid;subject uuid:=(m->>'subject')::uuid;campus uuid:=(m->>'campusId')::uuid;domain text:=m->>'domain';b jsonb;dimensions jsonb;BEGIN
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC',CASE WHEN p_permission='READ_RESTRICTED' THEN 'READ' ELSE p_permission END);
 IF domain NOT IN ('ORG01','ORG02','ORG03','BUNDLE') OR m->>'campus' NOT IN ('NORTH','SOUTH') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF domain='ORG03' AND target IS NOT NULL AND (subject IS NULL OR campus IS NULL) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF domain IN ('ORG01','ORG02') THEN
  IF target IS NOT NULL THEN
   IF domain='ORG01' THEN SELECT s.campus INTO sc FROM organization_master.subject s WHERE id=target;
   ELSE SELECT s.scope INTO sc FROM organization_master.campus s WHERE id=target;END IF;
   IF sc IS DISTINCT FROM m->>'campus' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  END IF;
  PERFORM organization_master.authorize(p_actor,target,m->>'campus',p_permission);
 ELSIF domain='ORG03' AND subject IS NOT NULL AND campus IS NOT NULL THEN
  IF target IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_master.operating_object o WHERE o.id=target AND o.subject_id=subject AND o.campus_id=campus AND o.scope=m->>'campus' AND o.kind=CASE WHEN m->>'action' IN ('REVISE_SCOPE','REVOKE_SCOPE') THEN 'SCOPE' WHEN m->>'action' IN ('REVISE_RELATION','REVALIDATE','CLOSE') THEN 'RELATION' ELSE NULL END) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM organization_master.operating_authorize(p_actor,subject,campus,CASE WHEN p_permission IN ('READ','REVIEW','READ_RESTRICTED') THEN p_permission WHEN m->>'action' IN ('CLOSE','REVOKE_SCOPE') THEN 'CLOSE' WHEN m->>'action' IN ('ESTABLISH','VERIFY_SCOPE') THEN 'ESTABLISH' ELSE 'REVISE' END);
 ELSE
  PERFORM organization_master.authorize(p_actor,NULL,m->>'campus',p_permission);
 END IF;
 IF domain='BUNDLE' AND (m->>'hasPayload')::boolean THEN
  IF jsonb_array_length(m->'bindings')<>3 OR (SELECT count(DISTINCT value->>'dataset') FROM jsonb_array_elements(m->'bindings'))<>3 THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
  FOR b IN SELECT value FROM jsonb_array_elements(m->'bindings') LOOP
   IF NOT EXISTS(SELECT 1 FROM governance_catalog.import_contract_version v JOIN governance_catalog.import_contract c ON c.id=v.contract_id JOIN governance_catalog.object o ON o.id=c.dataset_id WHERE v.id=(b->>'contractVersionId')::uuid AND c.id=(b->>'contractId')::uuid AND c.bundle_org AND o.code=b->>'dataset') THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
   PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',(b->>'contractVersionId')::uuid,'READ');
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('dataset',dataset_value,'scope',scope_value)) INTO dimensions FROM unnest(ARRAY['ORG01','ORG02','ORG03']) dataset_value CROSS JOIN jsonb_array_elements_text(m->'scopes') scope_value;
  PERFORM organization_master.bundle_dimension_access(p_actor,m->'bindings',dimensions,'READ');
  IF p_permission='WRITE' THEN PERFORM organization_master.bundle_dimension_access(p_actor,m->'bindings',dimensions,'STORE');END IF;
 END IF;
 RETURN identity;
END $$;
CREATE FUNCTION organization_master.workspace_save(p_actor text,p_input jsonb,p_digest text,p_envelope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;r organization_master.workspace_draft_revision;prior vnext_control.outcome;previous organization_master.workspace_draft_revision;result jsonb;target uuid:=(p_input->>'id')::uuid;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 identity:=organization_master.workspace_authorize(p_actor,p_input->'metadata','WRITE');PERFORM organization_master.workspace_authorize(p_actor,p_input->'metadata','READ');PERFORM organization_master.workspace_authorize(p_actor,p_input->'metadata','READ_RESTRICTED');
 SELECT o.* INTO prior FROM vnext_control.request_identity ri JOIN vnext_control.outcome o ON o.actor_code=ri.original_actor_code AND o.request_id=ri.request_id WHERE ri.identity_code=identity AND ri.request_id=(p_input->>'requestId')::uuid;
 IF FOUND THEN IF prior.input_digest<>p_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN prior.result;END IF;
 IF target IS NOT NULL THEN
  SELECT * INTO previous FROM organization_master.workspace_draft_revision WHERE id=target ORDER BY number DESC LIMIT 1;
  IF previous.identity_code IS DISTINCT FROM identity THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM organization_master.workspace_authorize(p_actor,previous.metadata,'WRITE');
  IF previous.number::text IS DISTINCT FROM p_input->>'expectedVersion' OR previous.state<>'EDITING' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
  IF previous.metadata->>'domain' IS DISTINCT FROM p_input->'metadata'->>'domain' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 ELSE
  IF p_input->>'expectedVersion' IS NOT NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;target:=uuidv7();
 END IF;
 IF p_input->>'state' NOT IN ('EDITING','DISCARDED','SUBMITTED') OR (p_input->>'state'='DISCARDED' AND previous.id IS NULL) OR jsonb_typeof(p_envelope) IS DISTINCT FROM 'object' OR octet_length(p_envelope::text)>4000000 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF p_input->>'state'='SUBMITTED' THEN
  IF p_input->'metadata'->>'domain'='BUNDLE' THEN
   IF previous.id IS NULL OR NOT EXISTS(SELECT 1 FROM organization_master.bundle_revision b JOIN governance_catalog.import_job j ON j.id=b.job_id WHERE b.job_id=(p_input->'submission'->>'jobId')::uuid AND b.revision_id=(p_input->'submission'->>'revisionId')::uuid AND b.revision_id=(p_input->'submission'->>'jobRevisionId')::uuid AND b.job_id=(p_input->'submission'->>'inputId')::uuid AND j.submitter_identity=identity AND j.current_revision_id=b.revision_id) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  ELSE
  IF previous.id IS NULL OR NOT EXISTS(SELECT 1 FROM organization_master.input i WHERE i.id=(p_input->'submission'->>'inputId')::uuid AND i.revision=(p_input->'submission'->>'revisionId')::uuid AND i.job_id=(p_input->'submission'->>'jobId')::uuid AND i.job_revision=(p_input->'submission'->>'jobRevisionId')::uuid AND i.domain=p_input->'metadata'->>'domain' AND i.identity_code=identity) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  END IF;
 END IF;
 INSERT INTO organization_master.workspace_draft_revision(id,number,identity_code,maker,request_id,digest,metadata,envelope,state,submission)
 VALUES(target,coalesce(previous.number,0)+1,identity,coalesce(previous.maker,p_actor),(p_input->>'requestId')::uuid,p_digest,p_input->'metadata',p_envelope,p_input->>'state',CASE WHEN p_input->>'state'='SUBMITTED' THEN p_input->'submission' ELSE NULL END) RETURNING * INTO r;
 result:=jsonb_build_object('id',r.id,'version',r.number::text,'state',r.state,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,target,'WORKSPACE_SAVE',r.state,p_digest);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(p_actor,r.request_id,p_digest,result);INSERT INTO vnext_control.request_identity VALUES(identity,r.request_id,p_actor);
 RETURN result;
END $$;
CREATE FUNCTION organization_master.workspace_read(p_actor text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;r organization_master.workspace_draft_revision;BEGIN
 PERFORM pg_advisory_xact_lock(901002);identity:=vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 SELECT * INTO r FROM organization_master.workspace_draft_revision WHERE id=p_id ORDER BY number DESC LIMIT 1;
 IF r.identity_code IS DISTINCT FROM identity THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM organization_master.workspace_authorize(p_actor,r.metadata,'READ');PERFORM organization_master.workspace_authorize(p_actor,r.metadata,'READ_RESTRICTED');
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'WORKSPACE_DRAFT_READ','PRIVATE_EDITING_DRAFT',r.digest);
 RETURN to_jsonb(r)||jsonb_build_object('version',r.number::text,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
END $$;
REVOKE ALL ON FUNCTION organization_master.workspace_authorize(text,jsonb,text),organization_master.workspace_save(text,jsonb,text,jsonb),organization_master.workspace_read(text,uuid) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION organization_master.workspace_list(p_actor text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;r organization_master.workspace_draft_revision;result jsonb:='[]';BEGIN
 PERFORM pg_advisory_xact_lock(901002);identity:=vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 FOR r IN SELECT d.* FROM organization_master.workspace_draft_revision d JOIN (SELECT id,max(number) n FROM organization_master.workspace_draft_revision WHERE identity_code=identity GROUP BY id) latest ON latest.id=d.id AND latest.n=d.number ORDER BY recorded_at DESC LIMIT 100 LOOP
  BEGIN PERFORM organization_master.workspace_authorize(p_actor,r.metadata,'READ');EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT IN ('ACCESS_DENIED','NOT_FOUND') THEN RAISE;END IF;CONTINUE;END;
  result:=result||jsonb_build_array(jsonb_build_object('id',r.id,'version',r.number::text,'state',r.state,'domain',r.metadata->>'domain','campus',r.metadata->>'campus','action',r.metadata->>'action','recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')));
 END LOOP;RETURN result;
END $$;
REVOKE ALL ON FUNCTION organization_master.workspace_list(text) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION organization_master.workspace_capabilities(p_actor text,m jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE permission text;field text;allowed boolean;result jsonb:='{}';BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 FOR permission,field IN SELECT * FROM (VALUES('READ','canRead'),('WRITE','canWrite'),('REVIEW','canReview')) a(permission,field) LOOP
  allowed:=true;
  BEGIN PERFORM organization_master.workspace_authorize(p_actor,m,permission);PERFORM organization_master.workspace_authorize(p_actor,m,'READ');PERFORM organization_master.workspace_authorize(p_actor,m,'READ_RESTRICTED');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT IN ('ACCESS_DENIED','NOT_FOUND','BLOCKED_DEPENDENCY') THEN RAISE;END IF;allowed:=false;END;
  result:=result||jsonb_build_object(field,allowed);
 END LOOP;
 RETURN result||jsonb_build_object('observedAt',to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US'));
END $$;
REVOKE ALL ON FUNCTION organization_master.workspace_capabilities(text,jsonb) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION organization_master.workspace_application_access(p_actor text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;r organization_master.input;permission text;field text;allowed boolean;result jsonb:='{}';read_record jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(901002);SELECT * INTO r FROM organization_master.input WHERE id=p_id;
 SELECT identity_code INTO identity FROM vnext_control.actor WHERE code=p_actor AND active;
 FOR permission,field IN SELECT * FROM (VALUES('READ','canRead'),('WRITE','canWrite'),('REVIEW','canReview')) a(permission,field) LOOP
  allowed:=true;
  BEGIN
   IF r.id IS NULL OR EXISTS(SELECT 1 FROM organization_master.bundle_child WHERE input_id=r.id) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
   IF r.domain='ORG03' THEN
    read_record:=organization_master.operating_input_read(p_actor,r.id,'READ');PERFORM organization_master.operating_input_read(p_actor,r.id,permission);
    IF permission='REVIEW' THEN PERFORM organization_master.operating_input_read(p_actor,r.id,'READ_RESTRICTED');END IF;
   ELSE
    read_record:=organization_master.input_read(p_actor,r.id,'READ');PERFORM organization_master.input_read(p_actor,r.id,permission);
    IF permission='REVIEW' THEN PERFORM organization_master.input_read(p_actor,r.id,'READ_RESTRICTED');END IF;
   END IF;
   IF permission='REVIEW' AND identity=r.identity_code THEN allowed:=false;END IF;
   IF permission<>'READ' AND (read_record->>'withdrawn'='true' OR read_record->>'currentRevision' IS DISTINCT FROM read_record->>'jobRevision') THEN allowed:=false;END IF;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT IN ('ACCESS_DENIED','NOT_FOUND') THEN RAISE;END IF;allowed:=false;END;
  result:=result||jsonb_build_object(field,allowed);
 END LOOP;
 RETURN result||jsonb_build_object('canPlan',coalesce((result->>'canWrite')::boolean AND identity=r.identity_code,false));
END $$;
CREATE FUNCTION organization_master.workspace_applications(p_actor text,p_input uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r organization_master.input;c governance_catalog.apply_candidate;permission jsonb;request uuid;kind text;state text;approved text;result jsonb:='[]';BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 FOR r IN SELECT i.* FROM organization_master.input i WHERE (p_input IS NULL OR i.id=p_input) AND NOT EXISTS(SELECT 1 FROM organization_master.bundle_child WHERE input_id=i.id) ORDER BY id DESC LOOP
  permission:=organization_master.workspace_application_access(p_actor,r.id);IF permission->>'canRead'<>'true' THEN CONTINUE;END IF;
  SELECT request_id INTO request FROM organization_master.input_request WHERE input_id=r.id;
  SELECT * INTO c FROM governance_catalog.apply_candidate WHERE input->>'jobId'=r.id::text AND input->>'revisionId'=r.revision::text AND input->>'requestId'=request::text ORDER BY recorded_at DESC LIMIT 1;
  SELECT actor_code INTO approved FROM governance_catalog.apply_approval WHERE candidate_id=c.id;
  SELECT m.kind INTO kind FROM organization_master.operating_input m WHERE input_id=r.id;
  state:=CASE WHEN EXISTS(SELECT 1 FROM governance_catalog.apply_commit WHERE candidate_id=c.id) THEN 'COMMITTED' WHEN EXISTS(SELECT 1 FROM organization_master.withdrawal WHERE input_id=r.id) THEN 'WITHDRAWN' WHEN approved IS NOT NULL THEN 'APPROVED' WHEN c.id IS NOT NULL THEN 'CANDIDATE' ELSE 'STAGED' END;
  result:=result||jsonb_build_array(jsonb_build_object('inputId',r.id,'domain',r.domain,'kind',kind,'campus',r.campus,'maker',r.maker,'state',state,'requestId',request,'candidateId',c.id,'approvedBy',approved,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'access',permission));
  IF jsonb_array_length(result)>=100 THEN EXIT;END IF;
 END LOOP;RETURN result;
END $$;
REVOKE ALL ON FUNCTION organization_master.workspace_application_access(text,uuid),organization_master.workspace_applications(text,uuid) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION organization_master.workspace_object_context(p_actor text,p_kind text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sc text;subject uuid;node_id uuid;head text;subject_head text;o organization_master.operating_object;can_write boolean:=true;can_close boolean:=true;terminal boolean:=false;BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 IF p_kind IN ('ORGANIZATION','LICENSE') THEN
  subject:=CASE WHEN p_kind='ORGANIZATION' THEN p_id ELSE (SELECT subject_id FROM organization_master.license WHERE id=p_id) END;
  SELECT s.campus INTO sc FROM organization_master.subject s WHERE id=subject;IF sc IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  PERFORM organization_master.authorize(p_actor,subject,sc,'READ');
  SELECT max(number)::text INTO subject_head FROM organization_master.version WHERE subject_id=subject;
  IF p_kind='LICENSE' THEN SELECT max(number)::text INTO head FROM organization_master.license_version WHERE license_id=p_id;ELSE head:=subject_head;END IF;
  BEGIN PERFORM organization_master.authorize(p_actor,subject,sc,'WRITE');EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'ACCESS_DENIED' THEN RAISE;END IF;can_write:=false;END;can_close:=can_write;
 ELSIF p_kind='CAMPUS' THEN
  node_id:=p_id;SELECT scope INTO sc FROM organization_master.campus WHERE id=node_id;IF sc IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  PERFORM organization_master.authorize(p_actor,node_id,sc,'READ');SELECT max(number)::text INTO head FROM organization_master.campus_event WHERE campus_id=node_id;
  terminal:=EXISTS(SELECT 1 FROM organization_master.campus_event e JOIN organization_master.campus_operation op ON op.event_id=e.id WHERE e.campus_id=node_id AND op.state='SUSPENDED');
  BEGIN PERFORM organization_master.authorize(p_actor,node_id,sc,'WRITE');EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'ACCESS_DENIED' THEN RAISE;END IF;can_write:=false;END;can_close:=can_write;
 ELSIF p_kind IN ('RELATION','SCOPE') THEN
  SELECT * INTO o FROM organization_master.operating_object WHERE id=p_id AND kind=p_kind;IF o.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  subject:=o.subject_id;node_id:=o.campus_id;sc:=o.scope;PERFORM organization_master.operating_authorize(p_actor,subject,node_id,'READ');
  SELECT max(number)::text INTO head FROM organization_master.operating_version WHERE object_id=o.id;
  terminal:=EXISTS(SELECT 1 FROM organization_master.operating_version WHERE object_id=o.id AND action IN ('CLOSE','REVOKE_SCOPE'));
  BEGIN PERFORM organization_master.operating_authorize(p_actor,subject,node_id,'REVISE');EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'ACCESS_DENIED' THEN RAISE;END IF;can_write:=false;END;
  BEGIN PERFORM organization_master.operating_authorize(p_actor,subject,node_id,'CLOSE');EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'ACCESS_DENIED' THEN RAISE;END IF;can_close:=false;END;
  can_write:=can_write AND NOT terminal;can_close:=can_close AND NOT terminal;
 ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF head IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 RETURN jsonb_build_object('kind',p_kind,'id',p_id,'campus',sc,'head',head,'subjectId',subject,'campusId',node_id,'subjectHead',subject_head,'canWrite',can_write,'canClose',can_close AND p_kind<>'ORGANIZATION','canActivate',p_kind='CAMPUS' AND can_write AND NOT terminal,'terminal',terminal);
END $$;
CREATE FUNCTION organization_master.workspace_version_source(p_actor text,p_kind text,p_id uuid,p_version text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE context jsonb;source_input uuid;r organization_master.input;j governance_catalog.import_job;c governance_catalog.import_contract;BEGIN
 context:=organization_master.workspace_object_context(p_actor,p_kind,p_id);IF context->>'canWrite'<>'true' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF p_kind='ORGANIZATION' THEN SELECT input_id INTO source_input FROM organization_master.version WHERE subject_id=p_id AND number::text=p_version;
 ELSIF p_kind='LICENSE' THEN SELECT input_id INTO source_input FROM organization_master.license_version WHERE license_id=p_id AND number::text=p_version AND NOT revoked;
 ELSIF p_kind='CAMPUS' THEN SELECT e.input_id INTO source_input FROM organization_master.campus_event e JOIN organization_master.campus_version v ON v.event_id=e.id WHERE e.campus_id=p_id AND e.number::text=p_version;
 ELSE SELECT input_id INTO source_input FROM organization_master.operating_version WHERE object_id=p_id AND number::text=p_version AND facts IS NOT NULL;END IF;
 IF source_input IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF p_kind IN ('RELATION','SCOPE') THEN PERFORM organization_master.operating_input_read(p_actor,source_input,'READ_RESTRICTED');ELSE PERFORM organization_master.input_read(p_actor,source_input,'READ_RESTRICTED');END IF;
 SELECT * INTO r FROM organization_master.input WHERE id=source_input;SELECT * INTO j FROM governance_catalog.import_job WHERE id=r.job_id;SELECT * INTO c FROM governance_catalog.import_contract WHERE id=j.contract_id;
 RETURN context||jsonb_build_object('inputId',source_input,'transport',CASE WHEN NOT c.bundle_org THEN jsonb_build_object('contractId',j.contract_id,'contractVersionId',j.contract_version_id) ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION organization_master.workspace_object_context(text,text,uuid),organization_master.workspace_version_source(text,text,uuid,text) FROM PUBLIC,hdi_prototype;

-- A maintenance editor may prepare a metadata-only transport for an authorized
-- private draft without receiving dataset-wide catalog WRITE. The exception is
-- backed by the actual latest draft, never by a client role or a session GUC.
CREATE FUNCTION organization_master.workspace_transport_authorize(p_actor text,p_input jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r organization_master.workspace_draft_revision;identity text;ref jsonb:=p_input->'workspaceDraft';BEGIN
 PERFORM pg_advisory_xact_lock(901002);identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE');
 IF p_input->>'action' IS DISTINCT FROM 'CREATE' OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR p_input->>'profile' IS DISTINCT FROM 'CORE' OR p_input->>'reason' IS DISTINCT FROM 'WORKSPACE_MANUAL' OR p_input->'input'->>'kind' IS DISTINCT FROM 'METADATA_ONLY' OR jsonb_typeof(ref) IS DISTINCT FROM 'object' OR ref-ARRAY['id','expectedVersion']<>'{}'::jsonb THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 SELECT * INTO r FROM organization_master.workspace_draft_revision WHERE id=(ref->>'id')::uuid ORDER BY number DESC LIMIT 1;
 IF r.identity_code IS DISTINCT FROM identity OR r.state IS DISTINCT FROM 'EDITING' OR r.number::text IS DISTINCT FROM ref->>'expectedVersion' OR r.metadata->>'domain' NOT IN ('ORG01','ORG02','ORG03') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM organization_master.workspace_authorize(p_actor,r.metadata,'READ');
 PERFORM organization_master.workspace_authorize(p_actor,r.metadata,'READ_RESTRICTED');
 PERFORM organization_master.workspace_authorize(p_actor,r.metadata,'WRITE');
 IF r.metadata->'transport'->>'contractId' IS DISTINCT FROM p_input->>'contractId' OR r.metadata->'transport'->>'contractVersionId' IS DISTINCT FROM p_input->>'contractVersionId' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 -- The only WRITE exception is reuse of a transport already attached to this
 -- authorized object's immutable facts. Changing a draft's transport is not an
 -- authorization grant for another catalog contract.
 IF NOT EXISTS(
  SELECT 1 FROM organization_master.input i JOIN governance_catalog.import_job j ON j.id=i.job_id
  WHERE j.contract_id=(p_input->>'contractId')::uuid AND j.contract_version_id=(p_input->>'contractVersionId')::uuid AND (
   (r.metadata->>'domain'='ORG01' AND EXISTS(SELECT 1 FROM organization_master.version v WHERE v.input_id=i.id AND v.subject_id=(r.metadata->>'target')::uuid)) OR
   (r.metadata->>'domain'='ORG02' AND EXISTS(SELECT 1 FROM organization_master.campus_event e WHERE e.input_id=i.id AND e.campus_id=(r.metadata->>'target')::uuid)) OR
   (r.metadata->>'domain'='ORG03' AND EXISTS(SELECT 1 FROM organization_master.operating_version v WHERE v.input_id=i.id AND v.object_id=(r.metadata->>'target')::uuid))
  )
 ) THEN PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',(p_input->>'contractVersionId')::uuid,'WRITE');END IF;
END $$;
REVOKE ALL ON FUNCTION organization_master.workspace_transport_authorize(text,jsonb) FROM PUBLIC,hdi_prototype;
DO $migration$
DECLARE body text;BEGIN
 body:=pg_get_functiondef('governance_catalog.import_job_command(text,jsonb)'::regprocedure);
 IF position('''expectedCurrentRevision'',''input''' IN body)=0 OR position('PERFORM governance_catalog.contract_require_access(actor,sc,(snapshot->>''versionId'')::uuid,''WRITE'');' IN body)=0 THEN RAISE EXCEPTION 'WORKSPACE_TRANSPORT_PATCH_BASELINE_MISMATCH';END IF;
 body:=replace(body,'''expectedCurrentRevision'',''input''','''expectedCurrentRevision'',''input'',''workspaceDraft''');
 body:=replace(body,'PERFORM governance_catalog.contract_require_access(actor,sc,(snapshot->>''versionId'')::uuid,''WRITE'');','IF input ? ''workspaceDraft'' THEN PERFORM organization_master.workspace_transport_authorize(actor,input);ELSE PERFORM governance_catalog.contract_require_access(actor,sc,(snapshot->>''versionId'')::uuid,''WRITE'');END IF;');
 body:=replace(body,'IF action=''CREATE'' THEN','IF input ? ''workspaceDraft'' AND action<>''CREATE'' THEN RAISE EXCEPTION ''ACCESS_DENIED'';END IF; IF action=''CREATE'' THEN');
 EXECUTE body;
END $migration$;

CREATE FUNCTION organization_master.workspace_bundles(p_actor text,p_job uuid DEFAULT NULL,p_revision uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b organization_master.bundle_revision;r jsonb;identity text;permission text;allowed boolean;access jsonb;c governance_catalog.apply_candidate;request uuid;approved text;state text;result jsonb:='[]';BEGIN
 PERFORM pg_advisory_xact_lock(901002);identity:=vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 FOR b IN SELECT v.* FROM organization_master.bundle_revision v WHERE (p_job IS NULL OR v.job_id=p_job) AND (p_revision IS NULL OR v.revision_id=p_revision) ORDER BY v.revision_id DESC LOOP
  BEGIN r:=organization_master.bundle_read(p_actor,b.job_id,b.revision_id);EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT IN ('ACCESS_DENIED','NOT_FOUND') THEN RAISE;END IF;CONTINUE;END;
  access:=jsonb_build_object('canRead',true,'canPreauthorize',EXISTS(SELECT 1 FROM organization_master.bundle_administrator WHERE actor=p_actor) AND EXISTS(SELECT 1 FROM vnext_control.actor_grant g WHERE g.actor_code=p_actor AND g.scope='SYNTHETIC' AND g.permission='WRITE'));
  FOREACH permission IN ARRAY ARRAY['WRITE','REVIEW'] LOOP
   allowed:=true;BEGIN PERFORM organization_master.bundle_authorize(p_actor,b.job_id,b.revision_id,permission);EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'ACCESS_DENIED' THEN RAISE;END IF;allowed:=false;END;
   IF permission='REVIEW' AND identity=r->>'makerIdentity' THEN allowed:=false;END IF;
   access:=access||jsonb_build_object(CASE permission WHEN 'WRITE' THEN 'canWrite' ELSE 'canReview' END,allowed);
  END LOOP;
  IF b.revision_id::text IS DISTINCT FROM r->>'currentRevisionId' THEN access:=access||jsonb_build_object('canWrite',false,'canReview',false,'canPreauthorize',false);END IF;
  access:=access||jsonb_build_object('canPlan',(access->>'canWrite')::boolean AND identity=r->>'makerIdentity');
  SELECT (details->>'requestId')::uuid INTO request FROM organization_master.bundle_control_event WHERE revision_id=b.revision_id AND kind='PLAN';
  SELECT * INTO c FROM governance_catalog.apply_candidate WHERE input->>'jobId'=b.job_id::text AND input->>'revisionId'=b.revision_id::text AND input->>'requestId'=request::text ORDER BY recorded_at DESC LIMIT 1;
  SELECT actor_code INTO approved FROM governance_catalog.apply_approval WHERE candidate_id=c.id;
  state:=CASE WHEN EXISTS(SELECT 1 FROM governance_catalog.apply_commit WHERE candidate_id=c.id) THEN 'COMMITTED' WHEN approved IS NOT NULL THEN 'APPROVED' WHEN c.id IS NOT NULL THEN 'CANDIDATE' WHEN EXISTS(SELECT 1 FROM organization_master.bundle_control_event WHERE revision_id=b.revision_id AND kind='LEGAL_VERIFY') THEN 'VERIFIED' ELSE 'STAGED' END;
  result:=result||jsonb_build_array(jsonb_build_object('jobId',b.job_id,'revisionId',b.revision_id,'currentRevision',b.revision_id::text=r->>'currentRevisionId','maker',r->>'makerActor','campus',b.campus,'state',state,'requestId',request,'candidateId',c.id,'approvedBy',approved,'access',access));IF jsonb_array_length(result)>=100 THEN EXIT;END IF;
 END LOOP;RETURN result;
END $$;
REVOKE ALL ON FUNCTION organization_master.workspace_bundles(text,uuid,uuid) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION organization_master.workspace_preview_access(p_actor text,p_metadata jsonb,p_digest text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF p_metadata->>'domain' IS DISTINCT FROM 'BUNDLE' OR p_metadata->>'hasPayload' IS DISTINCT FROM 'true' OR p_digest IS NULL OR p_digest!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 PERFORM organization_master.workspace_authorize(p_actor,p_metadata,'READ');
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,'00000000-0000-0000-0000-000000000000','WORKSPACE_PREVIEW_READ','PROTECTED_EDITING_PREVIEW',p_digest);
END $$;
REVOKE ALL ON FUNCTION organization_master.workspace_preview_access(text,jsonb,text) FROM PUBLIC,hdi_prototype;
