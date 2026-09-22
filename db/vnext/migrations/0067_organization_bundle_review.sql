SELECT pg_advisory_xact_lock(901002);
CREATE TABLE vnext_control.bundle_write_authority(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),key_hex text NOT NULL CHECK(key_hex~'^[a-f0-9]{64}$'));
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON vnext_control.bundle_write_authority FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
ALTER TABLE vnext_control.bundle_write_authority ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vnext_control.bundle_write_authority FROM PUBLIC,hdi_prototype;
CREATE TABLE organization_master.bundle_administrator(actor text PRIMARY KEY REFERENCES vnext_control.actor(code));
CREATE TRIGGER access_lock BEFORE INSERT OR UPDATE OR DELETE ON organization_master.bundle_administrator FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE FUNCTION organization_master.bundle_admin_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES('VNEXT_GRANT_CONTROL','00000000-0000-0000-0000-000000000000','ORG_BUNDLE_ADMIN_'||TG_OP,'CONTROLLED_AUTHORIZATION',encode(sha256(convert_to(jsonb_build_object('before',to_jsonb(OLD),'after',to_jsonb(NEW))::text,'UTF8')),'hex'));RETURN NULL;
END $$;
CREATE TRIGGER access_audit AFTER INSERT OR UPDATE OR DELETE ON organization_master.bundle_administrator FOR EACH ROW EXECUTE FUNCTION organization_master.bundle_admin_audit();
ALTER TABLE organization_master.bundle_administrator ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON organization_master.bundle_administrator FROM PUBLIC,hdi_prototype;
CREATE TABLE organization_master.bundle_control_event(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id uuid NOT NULL UNIQUE DEFAULT uuidv7(),job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),revision_id uuid NOT NULL REFERENCES organization_master.bundle_revision(revision_id),
 actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('GRANT','LEGAL_READ','LEGAL_VERIFY')),
 digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),details jsonb NOT NULL,
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp())
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON organization_master.bundle_control_event FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
ALTER TABLE organization_master.bundle_control_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON organization_master.bundle_control_event,organization_master.bundle_control_event_sequence_seq FROM PUBLIC,hdi_prototype;
CREATE FUNCTION organization_master.bundle_control_state(p_actor text,p_job uuid,p_revision uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM organization_master.bundle_read(p_actor,p_job,p_revision);
 RETURN jsonb_build_object('grants',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.sequence) FROM (SELECT DISTINCT ON (details->>'resource',details->>'grantee',details->>'permission') * FROM organization_master.bundle_control_event WHERE revision_id=p_revision AND kind='GRANT' ORDER BY details->>'resource',details->>'grantee',details->>'permission',sequence DESC) e),'[]'),'verification',(SELECT to_jsonb(e) FROM organization_master.bundle_control_event e WHERE revision_id=p_revision AND kind='LEGAL_VERIFY' ORDER BY sequence DESC LIMIT 1));
END $$;
CREATE FUNCTION organization_master.bundle_control(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;r jsonb;identity text;prior vnext_control.outcome;digest text;result jsonb;item jsonb;event_id uuid;
BEGIN
 SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.bundle_write_authority WHERE singleton;
 IF secret IS NULL OR t->>'domain' IS DISTINCT FROM 'ORG_BUNDLE_CONTROL_V1' OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM pg_advisory_xact_lock(901002);r:=organization_master.bundle_read(t->>'actor',(t->>'jobId')::uuid,(t->>'revisionId')::uuid);
 IF r->>'currentRevisionId' IS DISTINCT FROM t->>'revisionId' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 identity:=vnext_control.authorize(t->>'actor','SYNTHETIC',CASE WHEN t->>'action'='GRANT' THEN 'WRITE' ELSE 'REVIEW' END);
 IF t->>'action'='GRANT' THEN
  IF NOT EXISTS(SELECT 1 FROM organization_master.bundle_administrator WHERE actor=t->>'actor') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 ELSIF t->>'action' IN ('LEGAL_READ','LEGAL_VERIFY') THEN
  IF identity=r->>'makerIdentity' THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
 ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 digest:=encode(sha256(convert_to((t-ARRAY['transaction','domain','actor'])::text,'UTF8')),'hex');
 SELECT o.* INTO prior FROM vnext_control.request_identity ri JOIN vnext_control.outcome o ON o.actor_code=ri.original_actor_code AND o.request_id=ri.request_id WHERE ri.identity_code=identity AND ri.request_id=(t->>'requestId')::uuid;
 IF FOUND THEN IF prior.input_digest<>digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN prior.result;END IF;
 IF t->>'action'='GRANT' THEN
  FOR item IN SELECT value FROM jsonb_array_elements(t->'grants') LOOP
   IF item->>'resource'!~'^[a-f0-9]{64}$' OR item->>'permission' NOT IN ('READ','CREATE','REVISE','REVIEW') OR jsonb_typeof(item->'allowed') IS DISTINCT FROM 'boolean' OR NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=item->>'grantee' AND active) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
   INSERT INTO organization_master.bundle_control_event(job_id,revision_id,actor,identity_code,kind,digest,details) VALUES((t->>'jobId')::uuid,(t->>'revisionId')::uuid,t->>'actor',identity,'GRANT',digest,item) RETURNING id INTO event_id;
  END LOOP;
 ELSE
  IF t->>'basisDigest'!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF t->>'action'='LEGAL_VERIFY' AND NOT EXISTS(SELECT 1 FROM organization_master.bundle_control_event e WHERE e.revision_id=(t->>'revisionId')::uuid AND e.identity_code=identity AND e.kind='LEGAL_READ' AND e.digest=t->>'basisDigest') THEN RAISE EXCEPTION 'CANDIDATE_REVIEW_REQUIRED';END IF;
  INSERT INTO organization_master.bundle_control_event(job_id,revision_id,actor,identity_code,kind,digest,details) VALUES((t->>'jobId')::uuid,(t->>'revisionId')::uuid,t->>'actor',identity,t->>'action',t->>'basisDigest',jsonb_build_object('materialBindings',t->'materialBindings')) RETURNING id INTO event_id;
 END IF;
 result:=jsonb_build_object('eventId',event_id,'status',CASE t->>'action' WHEN 'LEGAL_VERIFY' THEN 'VERIFIED' WHEN 'LEGAL_READ' THEN 'READ' ELSE 'AUTHORIZED' END);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(t->>'actor',(t->>'revisionId')::uuid,'ORG_BUNDLE_'||(t->>'action'),'ORG_BUNDLE_V1',digest);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(t->>'actor',(t->>'requestId')::uuid,digest,result);INSERT INTO vnext_control.request_identity VALUES(identity,(t->>'requestId')::uuid,t->>'actor');RETURN result;
END $$;
REVOKE ALL ON FUNCTION organization_master.bundle_admin_audit(),organization_master.bundle_control_state(text,uuid,uuid),organization_master.bundle_control(text,text) FROM PUBLIC,hdi_prototype;
