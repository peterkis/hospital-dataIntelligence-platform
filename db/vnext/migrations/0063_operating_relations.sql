SELECT pg_advisory_xact_lock(901002);
CREATE TABLE organization_master.operating_object(id uuid PRIMARY KEY DEFAULT uuidv7(),kind text NOT NULL CHECK(kind IN ('RELATION','SCOPE')),subject_id uuid NOT NULL REFERENCES organization_master.subject(id),campus_id uuid NOT NULL REFERENCES organization_master.campus(id),scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')));
CREATE TABLE organization_master.operating_version(id uuid PRIMARY KEY DEFAULT uuidv7(),object_id uuid NOT NULL REFERENCES organization_master.operating_object(id),number bigint NOT NULL CHECK(number>0),action text NOT NULL CHECK(action IN ('VERIFY_SCOPE','REVISE_SCOPE','REVOKE_SCOPE','ESTABLISH','REVISE_RELATION','REVALIDATE','CLOSE')),valid_from timestamp NOT NULL,valid_to timestamp,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),input_id uuid NOT NULL UNIQUE REFERENCES organization_master.input(id),facts jsonb,basis jsonb NOT NULL,reviewer text NOT NULL REFERENCES vnext_control.actor(code),UNIQUE(object_id,number),CHECK(valid_to IS NULL OR valid_to>valid_from),CHECK(facts IS NULL OR jsonb_typeof(facts)='object'));
CREATE TABLE organization_master.operating_access(actor text NOT NULL REFERENCES vnext_control.actor(code),subject_id uuid NOT NULL REFERENCES organization_master.subject(id),campus_id uuid NOT NULL REFERENCES organization_master.campus(id),permission text NOT NULL CHECK(permission IN ('READ','ESTABLISH','REVISE','REVIEW','CLOSE','READ_RESTRICTED')),PRIMARY KEY(actor,subject_id,campus_id,permission));
CREATE TRIGGER access_lock BEFORE INSERT OR UPDATE OR DELETE ON organization_master.operating_access FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER operating_access_audit AFTER INSERT OR UPDATE OR DELETE ON organization_master.operating_access FOR EACH ROW EXECUTE FUNCTION organization_master.audit_access();
CREATE TABLE organization_master.operating_input(input_id uuid PRIMARY KEY REFERENCES organization_master.input(id),subject_id uuid NOT NULL REFERENCES organization_master.subject(id),campus_id uuid NOT NULL REFERENCES organization_master.campus(id),kind text NOT NULL CHECK(kind IN ('RELATION','SCOPE')),action text NOT NULL);
CREATE TABLE vnext_control.operating_write_authority(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),key_hex text NOT NULL CHECK(key_hex ~ '^[a-f0-9]{64}$'));
ALTER TABLE vnext_control.operating_write_authority ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vnext_control.operating_write_authority FROM PUBLIC,hdi_prototype;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON vnext_control.operating_write_authority FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
ALTER TABLE organization_master.input DROP CONSTRAINT input_domain_check;
ALTER TABLE organization_master.input ADD CONSTRAINT input_domain_check CHECK(domain IN ('ORG01','ORG02','ORG03'));
DO $target$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('organization_master.input_target_guard()'::regprocedure);
 needle:=' ELSE false END';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'OPERATING_TARGET_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,' WHEN ''ORG03'' THEN EXISTS(SELECT 1 FROM organization_master.operating_object WHERE id=NEW.target AND scope=NEW.campus)'||needle);
 body:=pg_get_functiondef('organization_master.stage(text,jsonb,text,jsonb)'::regprocedure);
 needle:=' i:=organization_master.authorize';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'OPERATING_STAGE_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,' IF coalesce(p_input->>''domain'',''ORG01'') NOT IN (''ORG01'',''ORG02'') THEN RAISE EXCEPTION ''ACCESS_DENIED'';END IF;'||E'
'||needle);
 body:=pg_get_functiondef('organization_master.input_read(text,uuid,text)'::regprocedure);
 needle:=' effective_target:=coalesce';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'OPERATING_INPUT_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,' IF r.domain=''ORG03'' THEN RAISE EXCEPTION ''ACCESS_DENIED'';END IF;'||E'
'||needle);
END $target$;
CREATE FUNCTION organization_master.operating_authorize(p_actor text,p_subject uuid,p_campus uuid,p_permission text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;sc text;oc text;BEGIN
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC',CASE WHEN p_permission IN ('READ','READ_RESTRICTED') THEN 'READ' WHEN p_permission='REVIEW' THEN 'REVIEW' ELSE 'WRITE' END);
 SELECT scope INTO sc FROM organization_master.campus WHERE id=p_campus;SELECT campus INTO oc FROM organization_master.subject WHERE id=p_subject;
 IF sc IS NULL OR oc IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM organization_master.authorize(p_actor,p_subject,oc,'READ');PERFORM organization_master.authorize(p_actor,p_campus,sc,'READ');
 IF NOT EXISTS(SELECT 1 FROM organization_master.operating_access WHERE actor=p_actor AND subject_id=p_subject AND campus_id=p_campus AND permission=p_permission) OR NOT EXISTS(SELECT 1 FROM organization_master.operating_access WHERE actor=p_actor AND subject_id=p_subject AND campus_id=p_campus AND permission='READ') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 RETURN jsonb_build_object('identity',identity,'scope',sc);
END $$;
CREATE FUNCTION organization_master.operating_stage(p_actor text,p_input jsonb,p_digest text,p_envelope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE auth jsonb;r organization_master.input;j governance_catalog.import_job;o organization_master.operating_object;action text:=p_input->>'action';permission text;target uuid:=(p_input->>'target')::uuid;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF action NOT IN ('VERIFY_SCOPE','REVISE_SCOPE','REVOKE_SCOPE','ESTABLISH','REVISE_RELATION','REVALIDATE','CLOSE') OR (p_input->>'kind') IS DISTINCT FROM (CASE WHEN action IN ('VERIFY_SCOPE','REVISE_SCOPE','REVOKE_SCOPE') THEN 'SCOPE' ELSE 'RELATION' END) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 permission:=CASE WHEN action IN ('VERIFY_SCOPE','ESTABLISH') THEN 'ESTABLISH' WHEN action IN ('REVOKE_SCOPE','CLOSE') THEN 'CLOSE' ELSE 'REVISE' END;
 auth:=organization_master.operating_authorize(p_actor,(p_input->>'subjectId')::uuid,(p_input->>'campusId')::uuid,permission);
 IF (action IN ('VERIFY_SCOPE','ESTABLISH')) IS DISTINCT FROM (target IS NULL) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF target IS NOT NULL THEN SELECT * INTO o FROM organization_master.operating_object WHERE id=target;IF o.id IS NULL OR o.subject_id::text IS DISTINCT FROM p_input->>'subjectId' OR o.campus_id::text IS DISTINCT FROM p_input->>'campusId' OR o.kind IS DISTINCT FROM p_input->>'kind' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;END IF;
 SELECT * INTO r FROM organization_master.input WHERE identity_code=auth->>'identity' AND request_id=(p_input->>'requestId')::uuid;
 IF FOUND THEN IF r.domain<>'ORG03' OR r.digest<>p_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision);END IF;
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=(p_input->>'jobId')::uuid;
 IF j.submitter_identity IS DISTINCT FROM auth->>'identity' OR j.current_revision_id IS DISTINCT FROM (p_input->>'revisionId')::uuid THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));IF j.profile<>'CORE' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 INSERT INTO organization_master.input(domain,job_id,job_revision,maker,identity_code,request_id,digest,campus,target,envelope) VALUES('ORG03',j.id,j.current_revision_id,p_actor,auth->>'identity',(p_input->>'requestId')::uuid,p_digest,auth->>'scope',target,p_envelope) RETURNING * INTO r;
 INSERT INTO organization_master.operating_input VALUES(r.id,(p_input->>'subjectId')::uuid,(p_input->>'campusId')::uuid,p_input->>'kind',action);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'OPERATING_INPUT','MANUAL_CORE',p_digest);
 RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision);
END $$;
CREATE FUNCTION organization_master.operating_input_read(p_actor text,p_id uuid,p_permission text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r organization_master.input;m organization_master.operating_input;permission text;BEGIN
 SELECT * INTO r FROM organization_master.input WHERE id=p_id;IF r.domain IS DISTINCT FROM 'ORG03' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 SELECT * INTO m FROM organization_master.operating_input WHERE input_id=r.id;
 permission:=CASE WHEN p_permission='WRITE' THEN CASE WHEN m.action IN ('VERIFY_SCOPE','ESTABLISH') THEN 'ESTABLISH' WHEN m.action IN ('REVOKE_SCOPE','CLOSE') THEN 'CLOSE' ELSE 'REVISE' END ELSE p_permission END;
 PERFORM organization_master.operating_authorize(p_actor,m.subject_id,m.campus_id,permission);
 IF p_permission='READ_RESTRICTED' THEN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'OPERATING_READ_RESTRICTED','IDENTITY_VERIFY',r.digest);END IF;
 RETURN jsonb_build_object('domain',r.domain,'id',r.id,'revision',r.revision,'digest',r.digest,'campus',r.campus,'target',r.target,'envelope',r.envelope,'subjectId',m.subject_id,'campusId',m.campus_id,'kind',m.kind,'action',m.action,'jobId',r.job_id,'jobRevision',r.job_revision,'makerIdentity',r.identity_code,'withdrawn',EXISTS(SELECT 1 FROM organization_master.withdrawal WHERE input_id=r.id),'currentRevision',(SELECT current_revision_id FROM governance_catalog.import_job WHERE id=r.job_id));
END $$;
CREATE FUNCTION organization_master.operating_plan(p_actor text,p_id uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(901002);r:=organization_master.operating_input_read(p_actor,p_id,'WRITE');
 IF r->>'makerIdentity' IS DISTINCT FROM vnext_control.authorize(p_actor,'SYNTHETIC','WRITE') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 INSERT INTO organization_master.input_request VALUES(p_id,p_request) ON CONFLICT DO NOTHING;
 IF (SELECT request_id FROM organization_master.input_request WHERE input_id=p_id) IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
 RETURN r;
END $$;
CREATE FUNCTION organization_master.operating_withdraw(p_actor text,p_id uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;identity text;digest text;prior vnext_control.outcome;result jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(901002);r:=organization_master.operating_input_read(p_actor,p_id,'WRITE');identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE');
 digest:=encode(sha256(convert_to(jsonb_build_array('OPERATING_WITHDRAW',p_id)::text,'UTF8')),'hex');
 SELECT o.* INTO prior FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=p_request;
 IF FOUND THEN IF prior.input_digest<>digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN prior.result;END IF;
 IF EXISTS(SELECT 1 FROM governance_catalog.apply_candidate c JOIN governance_catalog.apply_commit x ON x.candidate_id=c.id WHERE c.input->>'jobId'=p_id::text) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
 INSERT INTO organization_master.withdrawal VALUES(p_id,p_actor,p_request,timezone('Asia/Shanghai',clock_timestamp())) ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,p_id,'OPERATING_WITHDRAW','NON_EXPANSIVE',r->>'digest');
 result:=jsonb_build_object('inputId',p_id,'status','WITHDRAWN');INSERT INTO vnext_control.outcome VALUES(p_actor,p_request,digest,result);INSERT INTO vnext_control.request_identity VALUES(identity,p_request,p_actor);RETURN result;
END $$;
CREATE FUNCTION organization_master.operating_snapshot(p_actor text,p_id uuid,p_kind text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o organization_master.operating_object;BEGIN
 SELECT * INTO o FROM organization_master.operating_object WHERE id=p_id AND kind=p_kind;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM organization_master.operating_authorize(p_actor,o.subject_id,o.campus_id,'READ');
 RETURN to_jsonb(o)||jsonb_build_object('versions',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY number) FROM organization_master.operating_version v WHERE object_id=o.id),'[]'));
END $$;
CREATE FUNCTION organization_master.operating_pair(p_actor text,p_subject uuid,p_campus uuid,p_kind text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM organization_master.operating_authorize(p_actor,p_subject,p_campus,'READ');
 IF p_kind NOT IN ('SCOPE','RELATION') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 RETURN coalesce((SELECT jsonb_agg(organization_master.operating_snapshot(p_actor,id,p_kind) ORDER BY id) FROM organization_master.operating_object WHERE subject_id=p_subject AND campus_id=p_campus AND kind=p_kind),'[]');
END $$;
CREATE FUNCTION organization_master.operating_primary_conflict(p_actor text,p_campus uuid,p_target uuid,p_from timestamp,p_to timestamp) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM organization_master.authorize(p_actor,p_campus,(SELECT scope FROM organization_master.campus WHERE id=p_campus),'READ');
 RETURN EXISTS(SELECT 1 FROM organization_master.operating_version v JOIN organization_master.operating_object o ON o.id=v.object_id WHERE o.kind='RELATION' AND o.campus_id=p_campus AND o.id IS DISTINCT FROM p_target AND v.facts->>'primary'='Y' AND (tsmultirange(tsrange(v.valid_from,v.valid_to,'[)'))-coalesce((SELECT range_agg(tsrange(n.valid_from,n.valid_to,'[)')) FROM organization_master.operating_version n WHERE n.object_id=v.object_id AND n.number>v.number),'{}'::tsmultirange)) && tsrange(p_from,p_to,'[)'));
END $$;
CREATE FUNCTION organization_master.operating_write(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ticket jsonb:=p_ticket::jsonb;c jsonb:=ticket->'command';r jsonb;o organization_master.operating_object;candidate governance_catalog.apply_candidate;a governance_catalog.apply_approval;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;n bigint;new_id uuid;kind text;BEGIN
 SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.operating_write_authority WHERE singleton;
 IF secret IS NULL OR ticket->>'domain' IS DISTINCT FROM 'ORG03_WRITE_V1' OR ticket->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM pg_advisory_xact_lock(901002);r:=organization_master.operating_input_read(ticket->>'actor',(ticket->>'inputId')::uuid,'WRITE');
 IF c->'subject'->>'id' IS DISTINCT FROM r->>'subjectId' OR c->'campus'->>'id' IS DISTINCT FROM r->>'campusId' OR c->>'action' IS DISTINCT FROM r->>'action' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF (r->>'withdrawn')::boolean OR r->>'currentRevision' IS DISTINCT FROM r->>'jobRevision' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 IF c->'source'->>'recordStatus' IS DISTINCT FROM 'PUBLISHED' OR nullif(btrim(c->'source'->>'approvalRef'),'') IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 SELECT * INTO candidate FROM governance_catalog.apply_candidate WHERE id=(ticket->>'candidateId')::uuid;SELECT * INTO a FROM governance_catalog.apply_approval WHERE candidate_id=candidate.id;
 IF candidate.input->>'jobId' IS DISTINCT FROM r->>'id' OR candidate.input->>'revisionId' IS DISTINCT FROM r->>'revision' OR candidate.digest IS DISTINCT FROM ticket->>'digest' OR a.candidate_id IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 PERFORM governance_catalog.apply_record(a.actor_code,'CHECK_APPROVAL',jsonb_build_object('candidateId',candidate.id));PERFORM organization_master.operating_input_read(a.actor_code,(r->>'id')::uuid,'REVIEW');
 kind:=r->>'kind';
 IF r->>'target' IS NULL THEN
  IF c->>'action' NOT IN ('VERIFY_SCOPE','ESTABLISH') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  INSERT INTO organization_master.operating_object(kind,subject_id,campus_id,scope) VALUES(kind,(r->>'subjectId')::uuid,(r->>'campusId')::uuid,r->>'campus') RETURNING * INTO o;n:=1;
 ELSE
  SELECT * INTO o FROM organization_master.operating_object WHERE id=(r->>'target')::uuid;
  SELECT coalesce(max(number),0)+1 INTO n FROM organization_master.operating_version WHERE object_id=o.id;
  IF o.kind<>kind OR o.subject_id::text<>r->>'subjectId' OR o.campus_id::text<>r->>'campusId' OR o.id::text IS DISTINCT FROM c->'target'->>'id' OR (n-1)::text IS DISTINCT FROM c->'target'->>'expectedVersion' OR c->'target'->>'owner' IS DISTINCT FROM (CASE kind WHEN 'SCOPE' THEN 'organization-master/license-scope' ELSE 'organization-master/operating-relation' END) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  IF EXISTS(SELECT 1 FROM organization_master.operating_version WHERE object_id=o.id AND action IN ('CLOSE','REVOKE_SCOPE')) THEN RAISE EXCEPTION 'OPERATING_CLOSED';END IF;
 END IF;
 IF c->>'action' IN ('CLOSE','REVOKE_SCOPE') AND c->>'validTo' IS NOT NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF kind='RELATION' AND c->'facts'->>'primary'='Y' THEN
  IF c->'facts'->>'role' IS DISTINCT FROM 'OPERATOR' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
  IF organization_master.operating_primary_conflict(ticket->>'actor',o.campus_id,o.id,(c->>'validFrom')::timestamp,(c->>'validTo')::timestamp) THEN RAISE EXCEPTION 'PRIMARY_OPERATOR_CONFLICT';END IF;
 END IF;
 INSERT INTO organization_master.operating_version(object_id,number,action,valid_from,valid_to,input_id,facts,basis,reviewer) VALUES(o.id,n,c->>'action',(c->>'validFrom')::timestamp,(c->>'validTo')::timestamp,(r->>'id')::uuid,c->'facts',ticket->'basis',a.actor_code) RETURNING id INTO new_id;
 RETURN jsonb_build_object('owner',CASE kind WHEN 'SCOPE' THEN 'organization-master/license-scope' ELSE 'organization-master/operating-relation' END,'id',o.id,'version',n::text);
END $$;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['operating_object','operating_version','operating_input'] LOOP EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON organization_master.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',t);END LOOP;
 FOREACH t IN ARRAY ARRAY['operating_object','operating_version','operating_input','operating_access'] LOOP EXECUTE format('ALTER TABLE organization_master.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON organization_master.%I FROM PUBLIC,hdi_prototype',t);END LOOP;
END $$;
REVOKE ALL ON FUNCTION organization_master.operating_authorize(text,uuid,uuid,text),organization_master.operating_stage(text,jsonb,text,jsonb),organization_master.operating_input_read(text,uuid,text),organization_master.operating_plan(text,uuid,uuid),organization_master.operating_withdraw(text,uuid,uuid),organization_master.operating_snapshot(text,uuid,text),organization_master.operating_pair(text,uuid,uuid,text),organization_master.operating_primary_conflict(text,uuid,uuid,timestamp,timestamp),organization_master.operating_write(text,text) FROM PUBLIC,hdi_prototype;
