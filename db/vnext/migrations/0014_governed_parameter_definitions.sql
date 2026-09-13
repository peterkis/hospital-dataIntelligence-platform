-- GOV09 minimum: immutable, approved value-schema declarations, not operational values.
SELECT pg_advisory_xact_lock(901002);
CREATE TABLE governance_catalog.parameter (
 id uuid PRIMARY KEY DEFAULT uuidv7(), system_object_id uuid NOT NULL REFERENCES governance_catalog.object(id),
 parameter_key text NOT NULL CHECK(parameter_key ~ '^[A-Z0-9_.-]{1,64}$'), UNIQUE(system_object_id,parameter_key)
);
CREATE TABLE governance_catalog.parameter_version (
 id uuid PRIMARY KEY DEFAULT uuidv7(), parameter_id uuid NOT NULL REFERENCES governance_catalog.parameter(id),
 number integer NOT NULL CHECK(number>0), system_version_id uuid NOT NULL REFERENCES governance_catalog.version(id),
 parameter_group text NOT NULL CHECK(parameter_group ~ '^[A-Z0-9_.-]{1,64}$'),
 campus text NOT NULL CHECK(campus IN ('SYNTHETIC_ALL')), purpose text NOT NULL CHECK(purpose='GOV09_METADATA'),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'), owner_role text NOT NULL,
 definition_digest text NOT NULL CHECK(definition_digest ~ '^[a-f0-9]{64}$'),
 maker_identity text NOT NULL, valid_from timestamp NOT NULL, valid_to timestamp,
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 UNIQUE(parameter_id,number), UNIQUE(id,parameter_id), CHECK(valid_to IS NULL OR valid_to>valid_from)
);
CREATE TABLE governance_catalog.parameter_approval (
 id uuid PRIMARY KEY DEFAULT uuidv7(), version_id uuid NOT NULL UNIQUE REFERENCES governance_catalog.parameter_version(id),
 actor_code text NOT NULL REFERENCES vnext_control.actor(code), reviewer_identity text NOT NULL,
 definition_digest text NOT NULL, recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp())
);
CREATE TABLE governance_catalog.parameter_grant (
 actor_code text NOT NULL REFERENCES vnext_control.actor(code), parameter_id uuid NOT NULL REFERENCES governance_catalog.parameter(id),
 permission text NOT NULL CHECK(permission IN ('READ','WRITE','REVIEW')), PRIMARY KEY(actor_code,parameter_id,permission)
);
CREATE TRIGGER parameter_immutable BEFORE UPDATE OR DELETE ON governance_catalog.parameter FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE TRIGGER parameter_version_immutable BEFORE UPDATE OR DELETE ON governance_catalog.parameter_version FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE TRIGGER parameter_approval_immutable BEFORE UPDATE OR DELETE ON governance_catalog.parameter_approval FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE TRIGGER parameter_grant_lock BEFORE INSERT OR UPDATE OR DELETE ON governance_catalog.parameter_grant FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE FUNCTION governance_catalog.audit_parameter_grant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control AS $$ BEGIN
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES('PARAMETER_GRANT_CONTROL',CASE WHEN TG_OP='DELETE' THEN OLD.parameter_id ELSE NEW.parameter_id END,'PARAMETER_GRANT_'||TG_OP,'CONTROLLED_AUTHORIZATION',encode(sha256(convert_to(jsonb_build_object('before',to_jsonb(OLD),'after',to_jsonb(NEW))::text,'UTF8')),'hex')); RETURN NULL;
END $$;
CREATE TRIGGER parameter_grant_audit AFTER INSERT OR UPDATE OR DELETE ON governance_catalog.parameter_grant FOR EACH ROW EXECUTE FUNCTION governance_catalog.audit_parameter_grant();
ALTER TABLE governance_catalog.parameter ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_catalog.parameter_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_catalog.parameter_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_catalog.parameter_grant ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON governance_catalog.parameter,governance_catalog.parameter_version,governance_catalog.parameter_approval,governance_catalog.parameter_grant FROM PUBLIC,hdi_prototype;
GRANT SELECT ON governance_catalog.parameter,governance_catalog.parameter_version,governance_catalog.parameter_approval,governance_catalog.parameter_grant TO hdi_prototype;

CREATE FUNCTION governance_catalog.parameter_require_access(p_actor text,p_scope text,p_version uuid,p_permission text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE ver governance_catalog.parameter_version; system_ver governance_catalog.version;
BEGIN
 SELECT * INTO ver FROM governance_catalog.parameter_version WHERE id=p_version;
 SELECT * INTO system_ver FROM governance_catalog.version WHERE id=ver.system_version_id;
 IF ver.id IS NULL OR NOT EXISTS(SELECT 1 FROM governance_catalog.parameter_grant WHERE actor_code=p_actor AND parameter_id=ver.parameter_id AND permission=p_permission) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 PERFORM vnext_control.authorize(p_actor,p_scope,p_permission);
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=system_ver.object_id AND kind='SOURCE' AND scope=p_scope) OR NOT vnext_control.definition_allowed(p_actor,system_ver.object_id,system_ver.payload,'METADATA') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF p_permission<>'READ' THEN PERFORM vnext_control.require_object(p_actor,p_scope,system_ver.object_id,p_permission,'METADATA',system_ver.payload); END IF;
 PERFORM vnext_control.require_source_access(p_actor,p_scope,system_ver.object_id,system_ver.id);
END $$;
CREATE FUNCTION governance_catalog.parameter_require_reference(p_actor text,p_scope text,p_version uuid,p_digest text,p_period tsrange) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE ver governance_catalog.parameter_version;
BEGIN
 PERFORM governance_catalog.parameter_require_access(p_actor,p_scope,p_version,'READ');
 SELECT * INTO STRICT ver FROM governance_catalog.parameter_version WHERE id=p_version;
 IF p_digest IS DISTINCT FROM ver.definition_digest OR NOT EXISTS(SELECT 1 FROM governance_catalog.parameter_approval WHERE version_id=ver.id AND definition_digest=ver.definition_digest) THEN RAISE EXCEPTION 'PARAMETER_NOT_APPROVED'; END IF;
 IF NOT tsrange(ver.valid_from,ver.valid_to,'[)') @> p_period OR NOT governance_catalog.source_valid_spans(ver.system_version_id,timezone('Asia/Shanghai',clock_timestamp())) @> p_period THEN RAISE EXCEPTION 'PARAMETER_PERIOD_NOT_COVERED'; END IF;
END $$;

CREATE FUNCTION governance_catalog.parameter_command(actor text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE action text:=input->>'action'; sc text:=input->>'scope'; permission text; identity text; req uuid; request_digest text; existing vnext_control.outcome;
 obj governance_catalog.parameter; ver governance_catalog.parameter_version; system_ver governance_catalog.version; approval governance_catalog.parameter_approval;
 begin_b timestamp; end_b timestamp; definition jsonb:=input->'definition'; digest text; enum_value jsonb; result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 permission:=CASE WHEN action='APPROVE' THEN 'REVIEW' ELSE 'WRITE' END;identity:=vnext_control.authorize(actor,sc,permission);
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('action','scope','requestId','reason','systemVersionId','parameterKey','group','campus','definition','validFrom','validTo','target','expectedCurrentVersion','versionId','reviewDigest')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 IF coalesce(action,'') NOT IN ('CREATE','REVISE','APPROVE') OR coalesce(input->>'reason','') !~ '^[A-Z0-9_]{1,64}$' OR coalesce(input->>'requestId','') !~ '^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('action','scope','requestId','reason') AND NOT
 ((action='CREATE' AND k IN ('systemVersionId','parameterKey','group','campus','definition','validFrom','validTo')) OR
  (action='REVISE' AND k IN ('target','expectedCurrentVersion','systemVersionId','group','campus','definition','validFrom','validTo')) OR
  (action='APPROVE' AND k IN ('target','versionId','reviewDigest')))) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 req:=(input->>'requestId')::uuid;request_digest:=encode(sha256(convert_to(jsonb_build_object('owner','GOV09_DEFINITION','input',input)::text,'UTF8')),'hex');
 SELECT o.* INTO existing FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=req;
 IF FOUND THEN
  IF existing.input_digest<>request_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
  PERFORM governance_catalog.parameter_require_access(actor,sc,(existing.result->>'versionId')::uuid,permission);RETURN existing.result;
 END IF;
 IF action='CREATE' THEN
  IF coalesce(input->>'parameterKey','') !~ '^[A-Z0-9_.-]{1,64}$' THEN RAISE EXCEPTION 'INVALID_PARAMETER_KEY'; END IF;
  SELECT * INTO system_ver FROM governance_catalog.version WHERE id=(input->>'systemVersionId')::uuid;
 ELSE
  SELECT * INTO obj FROM governance_catalog.parameter WHERE id=(input->>'target')::uuid;
  SELECT * INTO ver FROM governance_catalog.parameter_version WHERE parameter_id=obj.id AND (action='REVISE' OR id=(input->>'versionId')::uuid) ORDER BY number DESC LIMIT 1;
  PERFORM governance_catalog.parameter_require_access(actor,sc,ver.id,permission);
  IF action='REVISE' AND input->>'expectedCurrentVersion' IS DISTINCT FROM ver.id::text THEN RAISE EXCEPTION 'STALE_HEAD'; END IF;
  SELECT * INTO system_ver FROM governance_catalog.version WHERE id=CASE WHEN action='REVISE' THEN (input->>'systemVersionId')::uuid ELSE ver.system_version_id END AND object_id=obj.system_object_id;
 END IF;
 IF system_ver.id IS NULL OR NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=system_ver.object_id AND kind='SOURCE' AND scope=sc) THEN RAISE EXCEPTION 'SOURCE_REFERENCE_INVALID'; END IF;
 PERFORM vnext_control.require_object(actor,sc,system_ver.object_id,permission,'METADATA',system_ver.payload);
 PERFORM vnext_control.require_source_access(actor,sc,system_ver.object_id,system_ver.id);
 IF action IN ('CREATE','REVISE') THEN
  IF input->>'campus' IS DISTINCT FROM 'SYNTHETIC_ALL' OR input->>'campus' IS DISTINCT FROM system_ver.payload->>'deploymentScope' OR coalesce(input->>'group','') !~ '^[A-Z0-9_.-]{1,64}$' THEN RAISE EXCEPTION 'PARAMETER_SCOPE_REQUIRED'; END IF;
  IF jsonb_typeof(definition) IS DISTINCT FROM 'object' OR NOT definition ?& ARRAY['kind','valueType','enumValues','description'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(definition) k WHERE k NOT IN ('kind','valueType','enumValues','description')) THEN RAISE EXCEPTION 'CLOSED_PARAMETER_SCHEMA_REQUIRED'; END IF;
  IF definition->>'kind' IS DISTINCT FROM 'VALUE_SCHEMA_V1' OR coalesce(definition->>'valueType','') NOT IN ('TEXT','INTEGER','DECIMAL','BOOLEAN') OR jsonb_typeof(definition->'enumValues') IS DISTINCT FROM 'array' OR jsonb_array_length(definition->'enumValues')>128 OR jsonb_typeof(definition->'description') IS DISTINCT FROM 'string' OR length(coalesce(definition->>'description','')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'PARAMETER_SCHEMA_INVALID'; END IF;
  FOR enum_value IN SELECT value FROM jsonb_array_elements(definition->'enumValues') LOOP
   IF jsonb_typeof(enum_value)<>'string' OR length(enum_value#>>'{}') NOT BETWEEN 1 AND 256 OR
    (definition->>'valueType'='BOOLEAN' AND enum_value#>>'{}' NOT IN ('true','false')) OR
    (definition->>'valueType'='INTEGER' AND enum_value#>>'{}' !~ '^-?(0|[1-9][0-9]*)$') OR
    (definition->>'valueType'='DECIMAL' AND enum_value#>>'{}' !~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$') THEN RAISE EXCEPTION 'PARAMETER_SCHEMA_INVALID'; END IF;
  END LOOP;
  IF (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(definition->'enumValues')) THEN RAISE EXCEPTION 'DUPLICATE_ENUM'; END IF;
  begin_b:=governance_catalog.contract_time(input->>'validFrom');end_b:=CASE WHEN input->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(input->>'validTo') END;
  IF end_b IS NOT NULL AND end_b<=begin_b THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD'; END IF;
  IF NOT governance_catalog.source_valid_spans(system_ver.id,timezone('Asia/Shanghai',clock_timestamp())) @> tsrange(begin_b,end_b,'[)') THEN RAISE EXCEPTION 'SOURCE_PERIOD_NOT_COVERED'; END IF;
  IF action='CREATE' THEN
   IF EXISTS(SELECT 1 FROM governance_catalog.parameter WHERE system_object_id=system_ver.object_id AND parameter_key=input->>'parameterKey') THEN RAISE EXCEPTION 'PARAMETER_EXISTS'; END IF;
   INSERT INTO governance_catalog.parameter(system_object_id,parameter_key) VALUES(system_ver.object_id,input->>'parameterKey') RETURNING * INTO obj;
   -- One-time explicit parameter grants derive only from this exact owner source.
   INSERT INTO governance_catalog.parameter_grant(actor_code,parameter_id,permission)
   SELECT DISTINCT g.actor_code,obj.id,g.permission FROM vnext_control.object_grant g JOIN vnext_control.actor a ON a.code=g.actor_code AND a.active JOIN vnext_control.actor_grant coarse ON coarse.actor_code=a.code AND coarse.scope=sc AND coarse.permission=g.permission
   WHERE g.object_id=system_ver.object_id AND g.scope=sc AND g.object_kind='SOURCE' AND g.campus=input->>'campus' AND g.field_group='DEFINITION' AND g.purpose='METADATA' AND g.permission IN ('READ','WRITE','REVIEW');
  END IF;
  digest:=encode(sha256(convert_to(jsonb_build_object('systemVersionId',system_ver.id,'systemObjectId',obj.system_object_id,'key',obj.parameter_key,'group',input->>'group','campus',input->>'campus','purpose','GOV09_METADATA','definition',definition,'ownerRole',system_ver.payload->>'businessOwnerRole','validFrom',begin_b,'validTo',end_b)::text,'UTF8')),'hex');
  INSERT INTO governance_catalog.parameter_version(parameter_id,number,system_version_id,parameter_group,campus,purpose,definition,owner_role,definition_digest,maker_identity,valid_from,valid_to)
  VALUES(obj.id,coalesce(ver.number,0)+1,system_ver.id,input->>'group',input->>'campus','GOV09_METADATA',definition,system_ver.payload->>'businessOwnerRole',digest,identity,begin_b,end_b) RETURNING * INTO ver;
 ELSE
  IF identity=ver.maker_identity THEN RAISE EXCEPTION 'SELF_REVIEW_FORBIDDEN'; END IF;
  IF input->>'reviewDigest' IS DISTINCT FROM ver.definition_digest THEN RAISE EXCEPTION 'REVIEW_DIGEST_MISMATCH'; END IF;
  IF NOT governance_catalog.source_valid_spans(system_ver.id,timezone('Asia/Shanghai',clock_timestamp())) @> tsrange(ver.valid_from,ver.valid_to,'[)') THEN RAISE EXCEPTION 'SOURCE_PERIOD_NOT_COVERED'; END IF;
  INSERT INTO governance_catalog.parameter_approval(version_id,actor_code,reviewer_identity,definition_digest) VALUES(ver.id,actor,identity,ver.definition_digest) ON CONFLICT(version_id) DO NOTHING;
  SELECT * INTO STRICT approval FROM governance_catalog.parameter_approval WHERE version_id=ver.id;
 END IF;
 result:=jsonb_build_object('id',obj.id,'versionId',ver.id,'version',ver.number,'status',CASE WHEN approval.id IS NULL THEN 'DRAFT' ELSE 'APPROVED' END,'reviewDigest',ver.definition_digest,'recordedAt',to_char(coalesce(approval.recorded_at,ver.recorded_at),'YYYY-MM-DD"T"HH24:MI:SS.US'),'runtimeReadiness','NOT_READY');
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(actor,req,request_digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,actor);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,obj.id,'PARAMETER_'||action,input->>'reason',request_digest);
 RETURN result;
END $$;

CREATE FUNCTION governance_catalog.parameter_read(actor text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE ver record; cutoff timestamp; result jsonb:='[]';
BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM vnext_control.authorize(actor,input->>'scope','READ');
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('scope','target','versionId','asOf','mode')) OR coalesce(input->>'mode','CURRENT') NOT IN ('CURRENT','APPROVED') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 cutoff:=CASE WHEN input->>'asOf' IS NULL THEN timezone('Asia/Shanghai',clock_timestamp()) ELSE governance_catalog.contract_time(input->>'asOf') END;
 FOR ver IN SELECT v.*,p.parameter_key,p.system_object_id,a.id AS approval_id,a.recorded_at AS approval_at FROM governance_catalog.parameter_version v JOIN governance_catalog.parameter p ON p.id=v.parameter_id JOIN governance_catalog.object system ON system.id=p.system_object_id LEFT JOIN governance_catalog.parameter_approval a ON a.version_id=v.id AND a.recorded_at<=cutoff
 WHERE system.scope=input->>'scope' AND v.recorded_at<=cutoff AND (input->>'target' IS NULL OR p.id=(input->>'target')::uuid) AND
 ((input->>'versionId' IS NOT NULL AND v.id=(input->>'versionId')::uuid AND (coalesce(input->>'mode','CURRENT')='CURRENT' OR a.id IS NOT NULL)) OR
  (input->>'versionId' IS NULL AND v.number=(SELECT max(candidate.number) FROM governance_catalog.parameter_version candidate WHERE candidate.parameter_id=p.id AND candidate.recorded_at<=cutoff AND (coalesce(input->>'mode','CURRENT')='CURRENT' OR EXISTS(SELECT 1 FROM governance_catalog.parameter_approval approved WHERE approved.version_id=candidate.id AND approved.recorded_at<=cutoff))))) ORDER BY p.parameter_key LOOP
  IF NOT EXISTS(SELECT 1 FROM governance_catalog.parameter_grant WHERE actor_code=actor AND parameter_id=ver.parameter_id AND permission='READ') THEN
   IF input->>'versionId' IS NOT NULL OR input->>'target' IS NOT NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;CONTINUE;
  END IF;
  PERFORM governance_catalog.parameter_require_access(actor,input->>'scope',ver.id,'READ');
  result:=result||jsonb_build_array(jsonb_build_object('id',ver.parameter_id,'versionId',ver.id,'version',ver.number,'systemVersionId',ver.system_version_id,'systemObjectId',ver.system_object_id,'parameterKey',ver.parameter_key,'group',ver.parameter_group,'campus',ver.campus,'purpose',ver.purpose,'ownerRole',ver.owner_role,'definition',ver.definition,'reviewDigest',ver.definition_digest,'validFrom',to_char(ver.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(ver.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordedAt',to_char(coalesce(ver.approval_at,ver.recorded_at),'YYYY-MM-DD"T"HH24:MI:SS.US'),'status',CASE WHEN ver.approval_id IS NULL THEN 'DRAFT' ELSE 'APPROVED' END,'runtimeReadiness','NOT_READY'));
 END LOOP;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION governance_catalog.contract_source_versions(p_version uuid) RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
 SELECT (definition->>'sourceVersionId')::uuid FROM governance_catalog.import_contract_version WHERE id=p_version AND definition->>'sourceVersionId' IS NOT NULL
 UNION SELECT (item->>'sourceVersionId')::uuid FROM governance_catalog.import_contract_version v CROSS JOIN LATERAL jsonb_array_elements(v.definition->'codeSets') item WHERE v.id=p_version AND item->>'sourceVersionId' IS NOT NULL
 UNION SELECT pv.system_version_id FROM governance_catalog.import_contract_version v CROSS JOIN LATERAL jsonb_array_elements(v.definition->'references') item JOIN governance_catalog.parameter_version pv ON pv.id=(item->>'parameterVersionId')::uuid WHERE v.id=p_version AND item->>'status'='DECLARED_PARAMETER'
$$;
REVOKE ALL ON FUNCTION governance_catalog.audit_parameter_grant(),governance_catalog.parameter_require_access(text,text,uuid,text),governance_catalog.parameter_require_reference(text,text,uuid,text,tsrange),governance_catalog.parameter_command(text,jsonb),governance_catalog.parameter_read(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.parameter_command(text,jsonb),governance_catalog.parameter_read(text,jsonb) TO hdi_prototype;
