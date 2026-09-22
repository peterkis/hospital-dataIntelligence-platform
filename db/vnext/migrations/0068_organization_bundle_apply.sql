SELECT pg_advisory_xact_lock(901002);
ALTER TABLE organization_master.bundle_control_event DROP CONSTRAINT bundle_control_event_kind_check;
ALTER TABLE organization_master.bundle_control_event ADD CONSTRAINT bundle_control_event_kind_check CHECK(kind IN ('GRANT','LEGAL_READ','LEGAL_VERIFY','PLAN'));
CREATE UNIQUE INDEX bundle_single_plan ON organization_master.bundle_control_event(revision_id) WHERE kind='PLAN';
CREATE TABLE organization_master.bundle_child(
 input_id uuid PRIMARY KEY REFERENCES organization_master.input(id),candidate_id uuid NOT NULL REFERENCES governance_catalog.apply_candidate(id),
 step_key text NOT NULL,legal_review_id uuid NOT NULL REFERENCES organization_master.bundle_control_event(id),command_digest text NOT NULL CHECK(command_digest~'^[a-f0-9]{64}$'),
 UNIQUE(candidate_id,step_key)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON organization_master.bundle_child FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
ALTER TABLE organization_master.bundle_child ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON organization_master.bundle_child FROM PUBLIC,hdi_prototype;
CREATE FUNCTION organization_master.bundle_authorize(p_actor text,p_job uuid,p_revision uuid,p_permission text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;binding jsonb;identity text;BEGIN
 IF p_permission NOT IN ('READ','WRITE','REVIEW') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 r:=organization_master.bundle_read(p_actor,p_job,p_revision);identity:=vnext_control.authorize(p_actor,'SYNTHETIC',p_permission);
 FOR binding IN SELECT value FROM jsonb_array_elements(r->'bindings') LOOP PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',(binding->>'contractVersionId')::uuid,p_permission);END LOOP;
 RETURN identity;
END $$;
CREATE FUNCTION organization_master.bundle_plan_request(p_actor text,p_job uuid,p_revision uuid,p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;identity text;BEGIN
 PERFORM pg_advisory_xact_lock(901002);r:=organization_master.bundle_read(p_actor,p_job,p_revision);identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE');
 IF identity IS DISTINCT FROM r->>'makerIdentity' OR p_revision::text IS DISTINCT FROM r->>'currentRevisionId' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 INSERT INTO organization_master.bundle_control_event(job_id,revision_id,actor,identity_code,kind,digest,details) VALUES(p_job,p_revision,p_actor,identity,'PLAN',encode(sha256(convert_to(p_request::text,'UTF8')),'hex'),jsonb_build_object('requestId',p_request)) ON CONFLICT DO NOTHING;
 IF (SELECT details->>'requestId' FROM organization_master.bundle_control_event WHERE revision_id=p_revision AND kind='PLAN') IS DISTINCT FROM p_request::text THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
END $$;
-- Session data is not authority: every use verifies a transaction-bound service HMAC.
CREATE FUNCTION organization_master.bundle_context(p_actor text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE frame jsonb;ticket text;t jsonb;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;c governance_catalog.apply_candidate;a governance_catalog.apply_approval;r jsonb;legal organization_master.bundle_control_event;BEGIN
 IF coalesce(current_setting('hdi.org_bundle',true),'')='' THEN RETURN NULL;END IF;
 frame:=current_setting('hdi.org_bundle')::jsonb;ticket:=frame->>'ticket';t:=ticket::jsonb;
 SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.bundle_write_authority WHERE singleton;
 IF secret IS NULL OR t->>'domain' IS DISTINCT FROM 'ORG_BUNDLE_COMMAND_V1' OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text OR t->>'actor' IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF frame->>'signature' IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM pg_advisory_xact_lock(901002);PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','WRITE');
 SELECT * INTO c FROM governance_catalog.apply_candidate WHERE id=(t->>'candidateId')::uuid;
 SELECT * INTO a FROM governance_catalog.apply_approval WHERE candidate_id=c.id;
 IF c.id IS NULL OR a.candidate_id IS NULL OR c.digest IS DISTINCT FROM t->>'digest' OR c.input->>'jobId' IS DISTINCT FROM t->>'jobId' OR c.input->>'revisionId' IS DISTINCT FROM t->>'revisionId' THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 r:=organization_master.bundle_read(p_actor,(t->>'jobId')::uuid,(t->>'revisionId')::uuid);IF r->>'currentRevisionId' IS DISTINCT FROM t->>'revisionId' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 PERFORM governance_catalog.apply_record(a.actor_code,'CHECK_APPROVAL',jsonb_build_object('candidateId',c.id));
 SELECT * INTO legal FROM organization_master.bundle_control_event WHERE revision_id=(t->>'revisionId')::uuid AND kind='LEGAL_VERIFY' ORDER BY sequence DESC LIMIT 1;
 IF legal.id::text IS DISTINCT FROM t->>'legalReviewId' OR legal.identity_code=c.maker_identity OR vnext_control.authorize(legal.actor,'SYNTHETIC','REVIEW') IS DISTINCT FROM legal.identity_code THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 RETURN t||jsonb_build_object('approver',a.actor_code,'verifier',legal.actor);
END $$;
CREATE FUNCTION organization_master.bundle_require_stage(p_actor text,p_input jsonb,p_digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb;metadata jsonb;BEGIN
 SELECT r.metadata INTO metadata FROM governance_catalog.import_input_revision r WHERE r.id=(p_input->>'revisionId')::uuid AND r.job_id=(p_input->>'jobId')::uuid;
 IF metadata->>'parserPolicy' IS DISTINCT FROM 'STRICT_ORG_BUNDLE_V1' THEN RETURN NULL;END IF;
 t:=organization_master.bundle_context(p_actor);
 IF t IS NULL OR t->>'phase' IS DISTINCT FROM 'STAGE' OR t->>'jobId' IS DISTINCT FROM p_input->>'jobId' OR t->>'revisionId' IS DISTINCT FROM p_input->>'revisionId' OR t->>'stageRequestId' IS DISTINCT FROM p_input->>'requestId' OR t->>'inputDigest' IS DISTINCT FROM p_digest THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;RETURN t;
END $$;
CREATE FUNCTION organization_master.bundle_bind_child(p_actor text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb;r organization_master.input;BEGIN
 t:=organization_master.bundle_context(p_actor);IF t IS NULL OR t->>'phase'<>'COMMAND' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 SELECT * INTO r FROM organization_master.input WHERE id=(t->>'inputId')::uuid;
 IF r.job_id::text IS DISTINCT FROM t->>'jobId' OR r.job_revision::text IS DISTINCT FROM t->>'revisionId' OR r.domain IS DISTINCT FROM t->>'dataset' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 INSERT INTO organization_master.bundle_child VALUES(r.id,(t->>'candidateId')::uuid,t->>'step',(t->>'legalReviewId')::uuid,t->>'commandDigest');
END $$;
CREATE FUNCTION organization_master.bundle_require_command(p_actor text,p_input uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb;r organization_master.input;metadata jsonb;BEGIN
 SELECT * INTO r FROM organization_master.input WHERE id=p_input;SELECT x.metadata INTO metadata FROM governance_catalog.import_input_revision x WHERE x.id=r.job_revision;
 IF metadata->>'parserPolicy' IS DISTINCT FROM 'STRICT_ORG_BUNDLE_V1' THEN RETURN NULL;END IF;
 t:=organization_master.bundle_context(p_actor);
 IF t IS NULL OR t->>'phase' IS DISTINCT FROM 'COMMAND' OR t->>'inputId' IS DISTINCT FROM p_input::text OR t->'command' IS DISTINCT FROM p_command OR NOT EXISTS(SELECT 1 FROM organization_master.bundle_child b WHERE b.input_id=p_input AND b.candidate_id=(t->>'candidateId')::uuid AND b.command_digest=t->>'commandDigest') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 RETURN t;
END $$;
CREATE FUNCTION organization_master.bundle_materialize_pair(p_actor text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb;target_subject uuid;target_campus uuid;g record;permission text;BEGIN
 t:=organization_master.bundle_context(p_actor);IF t IS NULL OR t->>'phase' IS DISTINCT FROM 'PAIR' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 target_subject:=(t->'command'->'subject'->>'id')::uuid;target_campus:=(t->'command'->'campus'->>'id')::uuid;
 IF (t->>'newSubject')::boolean AND NOT EXISTS(SELECT 1 FROM organization_master.version v JOIN organization_master.input i ON i.id=v.input_id WHERE v.subject_id=target_subject AND v.number=1 AND i.job_id=(t->>'jobId')::uuid AND i.job_revision=(t->>'revisionId')::uuid) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF (t->>'newCampus')::boolean AND NOT EXISTS(SELECT 1 FROM organization_master.campus_event v JOIN organization_master.input i ON i.id=v.input_id WHERE v.campus_id=target_campus AND v.number=1 AND i.job_id=(t->>'jobId')::uuid AND i.job_revision=(t->>'revisionId')::uuid) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF NOT ((t->>'newSubject')::boolean OR (t->>'newCampus')::boolean) THEN RETURN;END IF;
 FOR g IN SELECT DISTINCT ON (details->>'grantee',details->>'permission') details FROM organization_master.bundle_control_event WHERE revision_id=(t->>'revisionId')::uuid AND kind='GRANT' AND details->>'resource'=t->>'resource' ORDER BY details->>'grantee',details->>'permission',sequence DESC LOOP
  IF NOT (g.details->>'allowed')::boolean THEN CONTINUE;END IF;
  permission:=CASE g.details->>'permission' WHEN 'CREATE' THEN 'ESTABLISH' WHEN 'REVISE' THEN 'REVISE' WHEN 'REVIEW' THEN 'REVIEW' ELSE 'READ' END;
  INSERT INTO organization_master.operating_access VALUES(g.details->>'grantee',target_subject,target_campus,permission) ON CONFLICT DO NOTHING;
  IF permission='REVIEW' THEN INSERT INTO organization_master.operating_access VALUES(g.details->>'grantee',target_subject,target_campus,'READ_RESTRICTED') ON CONFLICT DO NOTHING;END IF;
 END LOOP;
END $$;
CREATE FUNCTION organization_master.bundle_committed_facts(p_actor text,p_job uuid,p_revision uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;f jsonb;parent jsonb;BEGIN
 PERFORM organization_master.bundle_read(p_actor,p_job,p_revision);
 SELECT o.result->'facts' INTO result FROM governance_catalog.apply_candidate c JOIN governance_catalog.apply_commit a ON a.candidate_id=c.id JOIN vnext_control.outcome o ON o.actor_code=a.actor_code AND o.request_id=a.request_id WHERE c.input->>'jobId'=p_job::text AND c.input->>'revisionId'=p_revision::text AND c.input->>'requestId'=p_request::text;
 IF result IS NULL THEN RETURN NULL;END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(result) LOOP
  IF f->>'owner'='organization-master' THEN PERFORM organization_master.qualification_snapshot(p_actor,(f->>'id')::uuid);
  ELSIF f->>'owner'='organization-master/campus' THEN PERFORM organization_master.campus_snapshot(p_actor,(f->>'id')::uuid);
  ELSIF f->>'owner' IN ('organization-master/license-scope','organization-master/operating-relation') THEN PERFORM organization_master.operating_snapshot(p_actor,(f->>'id')::uuid,CASE WHEN f->>'owner'='organization-master/license-scope' THEN 'SCOPE' ELSE 'RELATION' END);
  ELSE SELECT value INTO parent FROM jsonb_array_elements(result) WHERE value->>'owner'='organization-master' AND value->'source'->>'row'=f->'source'->>'row';IF parent IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;PERFORM organization_master.qualification_snapshot(p_actor,(parent->>'id')::uuid);
  END IF;
 END LOOP;RETURN result;
END $$;
DO $patch$
DECLARE body text;needle text;guard text;
BEGIN
 body:=pg_get_functiondef('organization_master.stage(text,jsonb,text,jsonb)'::regprocedure);
 needle:=' IF j.submitter_identity IS DISTINCT FROM i OR';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_STAGE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,' IF (organization_master.bundle_require_stage(p_actor,p_input,p_digest) IS NULL AND j.submitter_identity IS DISTINCT FROM i) OR');
 body:=replace(body,$needle$ PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));$needle$,$replacement$ IF organization_master.bundle_require_stage(p_actor,p_input,p_digest) IS NULL THEN PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));END IF;$replacement$);EXECUTE body;
 body:=pg_get_functiondef('organization_master.operating_stage(text,jsonb,text,jsonb)'::regprocedure);
 needle:=' IF j.submitter_identity IS DISTINCT FROM auth->>''identity'' OR';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_STAGE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,' IF (organization_master.bundle_require_stage(p_actor,p_input,p_digest) IS NULL AND j.submitter_identity IS DISTINCT FROM auth->>''identity'') OR');
 body:=replace(body,$needle$ PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));$needle$,$replacement$ IF organization_master.bundle_require_stage(p_actor,p_input,p_digest) IS NULL THEN PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));END IF;$replacement$);EXECUTE body;

 body:=pg_get_functiondef('organization_master.write(text,uuid,jsonb,jsonb)'::regprocedure);
 needle:=' r organization_master.input;';
 -- Keep manual rules in the same writers; bundle calls add an exact signed context.
 body:=replace(body,'DECLARE r organization_master.input;','DECLARE bundle jsonb;r organization_master.input;');
 IF position('DECLARE bundle jsonb;' IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_WRITE_BASELINE_MISMATCH';END IF;
 needle:=' PERFORM pg_advisory_xact_lock(901002);';
 body:=replace(body,needle,needle||'bundle:=organization_master.bundle_require_command(p_actor,p_input,p_command);IF bundle IS NOT NULL AND bundle->''identifierKeys'' IS DISTINCT FROM p_keys THEN RAISE EXCEPTION ''ACCESS_DENIED'';END IF;');
 body:=replace(body,'AND campus=r.campus;','AND campus=r.campus AND (bundle IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(bundle->''objectGrants'') g WHERE g->>''actor''=organization_master.access.actor AND g->>''permission''=organization_master.access.permission));');EXECUTE body;

 body:=pg_get_functiondef('organization_master.campus_write_approved(text,text)'::regprocedure);
 body:=replace(body,' r organization_master.input;', ' bundle jsonb;r organization_master.input;');
 needle:=' IF r.domain IS DISTINCT FROM ''ORG02'' THEN';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_CAMPUS_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,' bundle:=organization_master.bundle_require_command(p_actor,p_input,p_command);'||needle);
 needle:='c.input->>''jobId'' IS DISTINCT FROM r.id::text OR c.input->>''revisionId'' IS DISTINCT FROM r.revision::text';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_CAMPUS_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'(bundle IS NULL AND (c.input->>''jobId'' IS DISTINCT FROM r.id::text OR c.input->>''revisionId'' IS DISTINCT FROM r.revision::text)) OR (bundle IS NOT NULL AND (c.id::text IS DISTINCT FROM bundle->>''candidateId'' OR c.digest IS DISTINCT FROM bundle->>''digest''))');
 body:=replace(body,'AND campus=r.campus;','AND campus=r.campus AND (bundle IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(bundle->''objectGrants'') g WHERE g->>''actor''=organization_master.access.actor AND g->>''permission''=organization_master.access.permission));');EXECUTE body;

 body:=pg_get_functiondef('organization_master.operating_write(text,text)'::regprocedure);
 body:=replace(body,'DECLARE ticket jsonb', 'DECLARE bundle jsonb;ticket jsonb');
 needle:=' kind:=r->>''kind'';';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_OPERATING_BASELINE_MISMATCH';END IF;
 guard:='bundle:=organization_master.bundle_require_command(ticket->>''actor'',(ticket->>''inputId'')::uuid,c);';
 body:=replace(body,' SELECT * INTO candidate FROM',guard||' SELECT * INTO candidate FROM');
 needle:='candidate.input->>''jobId'' IS DISTINCT FROM r->>''id'' OR candidate.input->>''revisionId'' IS DISTINCT FROM r->>''revision''';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_OPERATING_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'(bundle IS NULL AND (candidate.input->>''jobId'' IS DISTINCT FROM r->>''id'' OR candidate.input->>''revisionId'' IS DISTINCT FROM r->>''revision'')) OR (bundle IS NOT NULL AND (candidate.id::text IS DISTINCT FROM bundle->>''candidateId'' OR candidate.digest IS DISTINCT FROM bundle->>''digest''))');
 body:=replace(body,'ticket->''basis'',a.actor_code)', 'ticket->''basis'',CASE WHEN bundle IS NOT NULL AND kind=''SCOPE'' THEN bundle->>''verifier'' ELSE a.actor_code END)');EXECUTE body;

 body:=pg_get_functiondef('governance_catalog.apply_record(text,text,jsonb)'::regprocedure);
 needle:='IF p_action=''COMMIT'' THEN';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_COMMIT_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,needle||$commit$
  IF EXISTS(SELECT 1 FROM organization_master.bundle_revision WHERE job_id=(c.input->>'jobId')::uuid AND revision_id=(c.input->>'revisionId')::uuid) THEN
   IF organization_master.bundle_context(p_actor)->>'phase' IS DISTINCT FROM 'COMMIT' OR organization_master.bundle_context(p_actor)->>'candidateId' IS DISTINCT FROM c.id::text OR organization_master.bundle_context(p_actor)->'facts' IS DISTINCT FROM p_input->'facts' OR (SELECT count(*) FROM organization_master.bundle_child WHERE candidate_id=c.id)<>jsonb_array_length(p_input->'facts') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  END IF;
$commit$);
END $patch$;
REVOKE ALL ON FUNCTION organization_master.bundle_authorize(text,uuid,uuid,text),organization_master.bundle_require_stage(text,jsonb,text),organization_master.bundle_plan_request(text,uuid,uuid,uuid),organization_master.bundle_context(text),organization_master.bundle_bind_child(text),organization_master.bundle_require_command(text,uuid,jsonb),organization_master.bundle_materialize_pair(text),organization_master.bundle_committed_facts(text,uuid,uuid,uuid) FROM PUBLIC,hdi_prototype;
