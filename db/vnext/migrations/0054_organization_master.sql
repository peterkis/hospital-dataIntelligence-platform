SELECT pg_advisory_xact_lock(901002);
CREATE SCHEMA organization_master;
CREATE TABLE organization_master.subject(id uuid PRIMARY KEY DEFAULT uuidv7(), campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')));
-- Exact object grants reuse the existing actor authority and its serialization lock.
-- Zero UUID is an explicit creation policy, never a wildcard on existing subjects.
CREATE TABLE organization_master.access(actor text NOT NULL REFERENCES vnext_control.actor(code),subject_id uuid NOT NULL,campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),permission text NOT NULL CHECK(permission IN ('READ','WRITE','REVIEW','READ_RESTRICTED')),PRIMARY KEY(actor,subject_id,campus,permission));
CREATE TRIGGER access_lock BEFORE INSERT OR UPDATE OR DELETE ON organization_master.access FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TABLE organization_master.input(id uuid PRIMARY KEY DEFAULT uuidv7(),revision uuid NOT NULL DEFAULT uuidv7(),job_id uuid NOT NULL,job_revision uuid NOT NULL,maker text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),campus text NOT NULL,target uuid REFERENCES organization_master.subject(id),envelope jsonb NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),FOREIGN KEY(job_id,job_revision) REFERENCES governance_catalog.import_input_revision(job_id,id));
CREATE TABLE organization_master.withdrawal(input_id uuid PRIMARY KEY REFERENCES organization_master.input(id),actor text NOT NULL,request_id uuid NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()));
CREATE TABLE organization_master.input_request(input_id uuid PRIMARY KEY REFERENCES organization_master.input(id),request_id uuid NOT NULL);
CREATE TABLE organization_master.version(id uuid PRIMARY KEY DEFAULT uuidv7(),subject_id uuid NOT NULL REFERENCES organization_master.subject(id),number bigint NOT NULL,legal_name text NOT NULL,entity_nature text NOT NULL,authority text,legal_address text,registration_evidence uuid NOT NULL REFERENCES governance_catalog.protected_artifact(id),valid_from timestamp NOT NULL,valid_to timestamp,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),input_id uuid NOT NULL REFERENCES organization_master.input(id),UNIQUE(subject_id,number),CHECK(valid_to IS NULL OR valid_to>valid_from));
CREATE TABLE organization_master.identifier(kind text NOT NULL CHECK(kind IN ('UNIFIED_CREDIT_CODE','INSTITUTION_CODE','LICENSE')),namespace text NOT NULL,lookup_digest text NOT NULL CHECK(lookup_digest ~ '^[a-f0-9]{64}$'),subject_id uuid NOT NULL REFERENCES organization_master.subject(id),input_id uuid NOT NULL REFERENCES organization_master.input(id),PRIMARY KEY(kind,namespace,lookup_digest));
CREATE TABLE organization_master.license(id uuid PRIMARY KEY DEFAULT uuidv7(),subject_id uuid NOT NULL REFERENCES organization_master.subject(id));
CREATE TABLE organization_master.license_version(id uuid PRIMARY KEY DEFAULT uuidv7(),license_id uuid NOT NULL REFERENCES organization_master.license(id),number bigint NOT NULL,valid_from timestamp NOT NULL,valid_to timestamp,end_kind text NOT NULL CHECK(end_kind IN ('FINITE','VERIFIED_UNBOUNDED','UNKNOWN')),evidence uuid NOT NULL REFERENCES governance_catalog.protected_artifact(id),authority text NOT NULL,revoked boolean NOT NULL DEFAULT false,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),input_id uuid NOT NULL REFERENCES organization_master.input(id),UNIQUE(license_id,number),CHECK(valid_to IS NULL OR valid_to>valid_from),CHECK((end_kind='FINITE')=(valid_to IS NOT NULL)));
CREATE TABLE organization_master.verification(id uuid PRIMARY KEY DEFAULT uuidv7(),subject_id uuid NOT NULL REFERENCES organization_master.subject(id),subject_version uuid NOT NULL REFERENCES organization_master.version(id),licenses uuid[] NOT NULL,valid_from timestamp NOT NULL,valid_to timestamp,evidence uuid NOT NULL REFERENCES governance_catalog.protected_artifact(id),input_id uuid NOT NULL REFERENCES organization_master.input(id),recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),CHECK(valid_to IS NULL OR valid_to>valid_from));
ALTER TABLE organization_master.version ADD COLUMN identifier_keys jsonb NOT NULL DEFAULT '[]';
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['subject','input','input_request','withdrawal','version','identifier','license','license_version','verification'] LOOP
 EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON organization_master.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['subject','access','input','input_request','withdrawal','version','identifier','license','license_version','verification'] LOOP
 EXECUTE format('ALTER TABLE organization_master.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
END $$;
CREATE FUNCTION organization_master.allowed(p_actor text,p_subject uuid,p_campus text,p_permission text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM organization_master.access WHERE actor=p_actor AND subject_id=coalesce(p_subject,'00000000-0000-0000-0000-000000000000'::uuid) AND campus=p_campus AND permission=p_permission)
$$;
CREATE FUNCTION organization_master.authorize(p_actor text,p_subject uuid,p_campus text,p_permission text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i text; BEGIN
 i:=vnext_control.authorize(p_actor,'SYNTHETIC',CASE WHEN p_permission='READ_RESTRICTED' THEN 'READ' ELSE p_permission END);
 IF NOT organization_master.allowed(p_actor,p_subject,p_campus,p_permission) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 RETURN i;
END $$;
CREATE FUNCTION organization_master.stage(p_actor text,p_input jsonb,p_digest text,p_envelope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i text; r organization_master.input; j governance_catalog.import_job; target uuid:=(p_input->>'target')::uuid; BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 i:=organization_master.authorize(p_actor,target,p_input->>'campus','WRITE');
 PERFORM organization_master.authorize(p_actor,target,p_input->>'campus','READ');
 SELECT * INTO r FROM organization_master.input WHERE identity_code=i AND request_id=(p_input->>'requestId')::uuid;
 IF FOUND THEN IF r.digest<>p_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF; RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision); END IF;
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=(p_input->>'jobId')::uuid;
 IF j.submitter_identity IS DISTINCT FROM i OR j.current_revision_id IS DISTINCT FROM (p_input->>'revisionId')::uuid THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));
 IF j.profile<>'CORE' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
 INSERT INTO organization_master.input(job_id,job_revision,maker,identity_code,request_id,digest,campus,target,envelope) VALUES(j.id,j.current_revision_id,p_actor,i,(p_input->>'requestId')::uuid,p_digest,p_input->>'campus',target,p_envelope) RETURNING * INTO r;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'ORGANIZATION_INPUT','MANUAL_CORE',p_digest);
 RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision);
END $$;
CREATE FUNCTION organization_master.input_read(p_actor text,p_id uuid,p_permission text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r organization_master.input; effective_target uuid; BEGIN
 SELECT * INTO r FROM organization_master.input WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 effective_target:=coalesce(r.target,(SELECT subject_id FROM organization_master.version WHERE input_id=r.id LIMIT 1));
 PERFORM organization_master.authorize(p_actor,effective_target,r.campus,p_permission);
 IF p_permission='READ_RESTRICTED' THEN
  PERFORM organization_master.authorize(p_actor,effective_target,r.campus,'READ');
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'ORGANIZATION_READ_RESTRICTED','IDENTITY_VERIFY',r.digest);
 END IF;
 RETURN jsonb_build_object('id',r.id,'revision',r.revision,'digest',r.digest,'campus',r.campus,'target',r.target,'envelope',r.envelope,'jobId',r.job_id,'jobRevision',r.job_revision,'makerIdentity',r.identity_code,'withdrawn',EXISTS(SELECT 1 FROM organization_master.withdrawal WHERE input_id=r.id),'currentRevision',(SELECT current_revision_id FROM governance_catalog.import_job WHERE id=r.job_id));
END $$;
CREATE FUNCTION organization_master.plan_input(p_actor text,p_id uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r organization_master.input; BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 SELECT * INTO r FROM organization_master.input WHERE id=p_id;
 IF organization_master.authorize(p_actor,r.target,r.campus,'WRITE') IS DISTINCT FROM r.identity_code THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 INSERT INTO organization_master.input_request VALUES(r.id,p_request) ON CONFLICT DO NOTHING;
 IF (SELECT request_id FROM organization_master.input_request WHERE input_id=r.id) IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
 IF EXISTS(SELECT 1 FROM governance_catalog.apply_candidate c WHERE c.input->>'jobId'=r.id::text AND c.input->>'requestId'<>p_request::text) THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
 RETURN organization_master.input_read(p_actor,p_id,'READ');
END $$;
CREATE FUNCTION organization_master.evidence(p_actor text,p_artifact uuid,p_source uuid,p_version uuid,p_campus text,p_from timestamp,p_to timestamp,p_as_of timestamp DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; BEGIN
 result:=governance_catalog.registration_evidence(p_actor,p_artifact,p_version,p_campus);
 PERFORM vnext_control.require_object(p_actor,'SYNTHETIC',p_source,'READ','SYNTHETIC_REFERENCE');
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_version AND o.id=p_source AND o.kind='SOURCE' AND o.scope='SYNTHETIC') OR NOT (tsrange(p_from,p_to,'[)') <@ governance_catalog.source_valid_spans(p_version,coalesce(p_as_of,timezone('Asia/Shanghai',clock_timestamp())))) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
 RETURN result;
END $$;
-- Catalog owns protected material. This finite review port extends access beyond the
-- submitter only with explicit current contract and protected READ grants.
CREATE FUNCTION governance_catalog.registration_evidence(p_actor text,p_artifact uuid,p_source_version uuid,p_campus text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a governance_catalog.protected_artifact; j governance_catalog.import_job; c governance_catalog.import_contract_version; dataset uuid; result jsonb; BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 SELECT * INTO a FROM governance_catalog.protected_artifact WHERE id=p_artifact;
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=a.job_id;
 SELECT * INTO c FROM governance_catalog.import_contract_version WHERE id=j.contract_version_id;
 SELECT object_id INTO dataset FROM governance_catalog.version WHERE id=c.dataset_version_id;
 IF a.id IS NULL OR a.kind NOT IN ('RAW_CELL','RAW_FILE') OR a.campus<>p_campus OR a.purpose<>'IDENTITY_VERIFY' OR a.expires_at<=timezone('Asia/Shanghai',clock_timestamp()) OR NOT EXISTS(SELECT 1 FROM governance_catalog.protected_payload WHERE artifact_id=a.id) THEN RAISE EXCEPTION 'PAYLOAD_UNAVAILABLE'; END IF;
 IF c.definition->>'sourceVersionId' IS DISTINCT FROM p_source_version::text THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
 PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',c.id,'READ');
 IF NOT EXISTS(SELECT 1 FROM vnext_control.protected_grant WHERE actor_code=p_actor AND dataset_id=dataset AND campus=p_campus AND purpose='IDENTITY_VERIFY' AND permission='READ') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT jsonb_build_object('artifactId',a.id,'sourceVersion',p_source_version,'expiresAt',a.expires_at,'binding',jsonb_build_array(a.job_id,a.revision_id,a.kind,a.campus,a.purpose,a.request_id),'envelope',jsonb_build_object('keyId',p.key_id,'nonce',encode(p.nonce,'hex'),'tag',encode(p.tag,'hex'),'ciphertext',encode(p.ciphertext,'hex'))) INTO result FROM governance_catalog.protected_payload p WHERE artifact_id=a.id;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,a.id,'REGISTRATION_EVIDENCE_READ','IDENTITY_VERIFY',encode(sha256(convert_to(jsonb_build_array(a.id,p_source_version)::text,'UTF8')),'hex'));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.registration_evidence(text,uuid,uuid,text) FROM PUBLIC,hdi_prototype;
CREATE FUNCTION organization_master.snapshot(p_actor text,p_id uuid,p_campus text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM organization_master.authorize(p_actor,p_id,p_campus,'READ');
 RETURN jsonb_build_object('versions',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY number) FROM organization_master.version v WHERE subject_id=p_id),'[]'),'licenses',coalesce((SELECT jsonb_agg(to_jsonb(v)||jsonb_build_object('subject_id',l.subject_id) ORDER BY v.license_id,v.number) FROM organization_master.license_version v JOIN organization_master.license l ON l.id=v.license_id WHERE l.subject_id=p_id),'[]'),'verifications',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY recorded_at,id) FROM organization_master.verification v WHERE subject_id=p_id),'[]'),'identifierKinds',coalesce((SELECT jsonb_agg(DISTINCT kind) FROM organization_master.identifier WHERE subject_id=p_id),'[]'));
END $$;
CREATE FUNCTION organization_master.conflict(p_subject uuid,p_keys jsonb) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(p_keys) k JOIN organization_master.identifier i ON i.kind=k->>'kind' AND i.namespace=k->>'namespace' AND i.lookup_digest=k->>'digest' WHERE i.subject_id IS DISTINCT FROM p_subject)
$$;
CREATE FUNCTION organization_master.write(p_actor text,p_input uuid,p_command jsonb,p_keys jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r organization_master.input; s uuid; n bigint; v uuid; l uuid; lv organization_master.license_version; action text:=p_command->>'action'; BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 SELECT * INTO r FROM organization_master.input WHERE id=p_input;
 PERFORM organization_master.authorize(p_actor,r.target,r.campus,'WRITE');
 IF EXISTS(SELECT 1 FROM organization_master.withdrawal WHERE input_id=r.id) THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
 IF EXISTS(SELECT 1 FROM organization_master.version WHERE input_id=r.id) OR EXISTS(SELECT 1 FROM organization_master.license_version WHERE input_id=r.id) OR EXISTS(SELECT 1 FROM organization_master.verification WHERE input_id=r.id) THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
 s:=r.target;
 IF action='CREATE' THEN
  IF s IS NOT NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  INSERT INTO organization_master.subject(campus) VALUES(r.campus) RETURNING id INTO s;
  INSERT INTO organization_master.access SELECT actor,s,campus,permission FROM organization_master.access WHERE subject_id='00000000-0000-0000-0000-000000000000' AND campus=r.campus;
 ELSE
  SELECT max(number) INTO n FROM organization_master.version WHERE subject_id=s;
  IF n::text IS DISTINCT FROM p_command->'target'->>'version' OR s::text IS DISTINCT FROM p_command->'target'->>'id' THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
 END IF;
 IF organization_master.conflict(s,p_keys) THEN RAISE EXCEPTION 'IDENTIFIER_CONFLICT'; END IF;
 IF action IN ('ADD_LICENSE','REVISE_LICENSE') AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_keys) k JOIN organization_master.identifier i ON i.kind='LICENSE' AND i.namespace=k->>'namespace' AND i.lookup_digest=k->>'digest' WHERE action='ADD_LICENSE' OR NOT EXISTS(SELECT 1 FROM organization_master.license_version x WHERE x.input_id=i.input_id AND x.license_id=(p_command->'licenseTarget'->>'id')::uuid)) THEN RAISE EXCEPTION 'IDENTIFIER_CONFLICT'; END IF;
 INSERT INTO organization_master.identifier SELECT k->>'kind',k->>'namespace',k->>'digest',s,r.id FROM jsonb_array_elements(p_keys) k ON CONFLICT DO NOTHING;
 IF action IN ('CREATE','REVISE') THEN
  SELECT coalesce(max(number),0)+1 INTO n FROM organization_master.version WHERE subject_id=s;
  INSERT INTO organization_master.version(subject_id,number,legal_name,entity_nature,authority,legal_address,registration_evidence,valid_from,valid_to,input_id,identifier_keys) VALUES(s,n,p_command->'facts'->>'legalName',p_command->'facts'->>'entityNature',p_command->'facts'->>'authority',p_command->'facts'->>'legalAddress',(p_command->'facts'->>'registrationEvidence')::uuid,(p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,r.id,p_keys) RETURNING id INTO v;
 ELSIF action IN ('ADD_LICENSE','REVISE_LICENSE','REVOKE_LICENSE') THEN
  IF action='ADD_LICENSE' THEN INSERT INTO organization_master.license(subject_id) VALUES(s) RETURNING id INTO l; n:=1;
  ELSE
   SELECT x.* INTO lv FROM organization_master.license_version x JOIN organization_master.license y ON y.id=x.license_id WHERE y.subject_id=s AND x.license_id=(p_command->'licenseTarget'->>'id')::uuid ORDER BY x.number DESC LIMIT 1;
   IF lv.number::text IS DISTINCT FROM p_command->'licenseTarget'->>'version' THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
   l:=lv.license_id;n:=lv.number+1;
  END IF;
  IF action='REVOKE_LICENSE' THEN
   INSERT INTO organization_master.license_version(license_id,number,valid_from,valid_to,end_kind,evidence,authority,revoked,input_id) VALUES(l,n,lv.valid_from,lv.valid_to,lv.end_kind,lv.evidence,lv.authority,true,r.id) RETURNING id INTO v;
  ELSE
   INSERT INTO organization_master.license_version(license_id,number,valid_from,valid_to,end_kind,evidence,authority,input_id) VALUES(l,n,(p_command->'license'->>'validFrom')::timestamp,(p_command->'license'->>'validTo')::timestamp,p_command->'license'->>'endKind',(p_command->'license'->>'evidence')::uuid,p_command->'license'->>'authority',r.id) RETURNING id INTO v;
  END IF;
  RETURN jsonb_build_object('owner','organization-master/license','id',l,'version',n::text);
 ELSIF action='VERIFY_REGISTRATION' THEN
  INSERT INTO organization_master.verification(subject_id,subject_version,licenses,valid_from,valid_to,evidence,input_id) SELECT s,(SELECT id FROM organization_master.version WHERE subject_id=s ORDER BY number DESC LIMIT 1),ARRAY(SELECT x.id FROM organization_master.license_version x JOIN jsonb_array_elements(p_command->'licenseTargets') t ON x.license_id=(t->>'id')::uuid AND x.number=(t->>'version')::bigint),(p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,(p_command->>'evidence')::uuid,r.id RETURNING id INTO v;
  RETURN jsonb_build_object('owner','organization-master/verification','id',v,'version','1');
 ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 RETURN jsonb_build_object('owner','organization-master','id',s,'version',n::text);
END $$;
CREATE FUNCTION organization_master.read(p_actor text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 IF p_input ? 'id' AND NOT EXISTS(SELECT 1 FROM organization_master.subject s WHERE s.id=(p_input->>'id')::uuid AND organization_master.allowed(p_actor,s.id,s.campus,'READ')) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT coalesce(jsonb_agg(row ORDER BY sid,num),'[]') INTO result FROM (
 SELECT v.subject_id sid,v.number num,jsonb_build_object('id',v.subject_id,'version',v.number::text,'versionId',v.id,'legalName',v.legal_name,'entityNature',v.entity_nature,'authority',v.authority,'legalAddress',v.legal_address,'validFrom',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordedAt',to_char(v.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')) row
 FROM organization_master.version v JOIN organization_master.subject s ON s.id=v.subject_id
 WHERE organization_master.allowed(p_actor,s.id,s.campus,'READ') AND (NOT p_input ? 'id' OR s.id=(p_input->>'id')::uuid)
 AND (NOT p_input ? 'after' OR s.id>(p_input->>'after')::uuid)
 AND (NOT p_input ? 'afterVersion' OR v.number>(p_input->>'afterVersion')::bigint)
 AND v.recorded_at<=coalesce((p_input->>'asOf')::timestamp,timezone('Asia/Shanghai',clock_timestamp()))
 AND (p_input->>'mode'<>'EXACT' OR v.number=(p_input->>'version')::bigint)
 AND (p_input->>'mode' IN ('HISTORY','EXACT') OR (tsrange(v.valid_from,v.valid_to,'[)') @> coalesce((p_input->>'businessAt')::timestamp,timezone('Asia/Shanghai',clock_timestamp())) AND NOT EXISTS(SELECT 1 FROM organization_master.version later WHERE later.subject_id=v.subject_id AND later.number>v.number AND later.recorded_at<=coalesce((p_input->>'asOf')::timestamp,timezone('Asia/Shanghai',clock_timestamp())) AND tsrange(later.valid_from,later.valid_to,'[)') @> coalesce((p_input->>'businessAt')::timestamp,timezone('Asia/Shanghai',clock_timestamp())))))
 ORDER BY v.subject_id,v.number LIMIT coalesce((p_input->>'limit')::integer,100)) rows;
 RETURN result;
END $$;
CREATE FUNCTION organization_master.withdraw(p_actor text,p_id uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r organization_master.input; identity text; digest text; prior vnext_control.outcome; result jsonb; BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 SELECT * INTO r FROM organization_master.input WHERE id=p_id;
 identity:=organization_master.authorize(p_actor,r.target,r.campus,'WRITE');
 digest:=encode(sha256(convert_to(jsonb_build_array('ORGANIZATION_WITHDRAW',p_id)::text,'UTF8')),'hex');
 SELECT o.* INTO prior FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=p_request;
 IF FOUND THEN IF prior.input_digest<>digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF; RETURN prior.result; END IF;
 IF EXISTS(SELECT 1 FROM governance_catalog.apply_candidate c JOIN governance_catalog.apply_commit x ON x.candidate_id=c.id WHERE c.input->>'jobId'=r.id::text) THEN RAISE EXCEPTION 'ALREADY_COMMITTED'; END IF;
 INSERT INTO organization_master.withdrawal VALUES(r.id,p_actor,p_request,timezone('Asia/Shanghai',clock_timestamp())) ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'ORGANIZATION_WITHDRAW','NON_EXPANSIVE',r.digest);
 result:=jsonb_build_object('inputId',r.id,'status','WITHDRAWN');
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(p_actor,p_request,digest,result);
 INSERT INTO vnext_control.request_identity VALUES(identity,p_request,p_actor);
 RETURN result;
END $$;
CREATE FUNCTION organization_master.qualification_snapshot(p_actor text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE campus text; BEGIN
 SELECT s.campus INTO campus FROM organization_master.subject s WHERE s.id=p_id;
 IF campus IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 RETURN organization_master.snapshot(p_actor,p_id,campus);
END $$;
CREATE FUNCTION organization_master.audit_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES('VNEXT_GRANT_CONTROL',CASE WHEN TG_OP='DELETE' THEN OLD.subject_id ELSE NEW.subject_id END,'ORGANIZATION_GRANT_'||TG_OP,'CONTROLLED_AUTHORIZATION',encode(sha256(convert_to(jsonb_build_object('before',to_jsonb(OLD),'after',to_jsonb(NEW))::text,'UTF8')),'hex'));
 RETURN NULL;
END $$;
CREATE TRIGGER access_audit AFTER INSERT OR UPDATE OR DELETE ON organization_master.access FOR EACH ROW EXECUTE FUNCTION organization_master.audit_access();
REVOKE ALL ON SCHEMA organization_master FROM PUBLIC,hdi_prototype;
REVOKE ALL ON ALL TABLES IN SCHEMA organization_master FROM PUBLIC,hdi_prototype;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA organization_master FROM PUBLIC,hdi_prototype;
-- RLS denies row reads; metadata access permits database-derived types.
GRANT USAGE ON SCHEMA organization_master TO hdi_prototype;
GRANT SELECT ON ALL TABLES IN SCHEMA organization_master TO hdi_prototype;
