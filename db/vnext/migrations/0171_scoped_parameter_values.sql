SELECT pg_advisory_xact_lock(901002);

CREATE TABLE governance_catalog.parameter_value (
 id uuid PRIMARY KEY DEFAULT uuidv7(),parameter_id uuid NOT NULL REFERENCES governance_catalog.parameter(id),
 scope_context jsonb NOT NULL CHECK(jsonb_typeof(scope_context)='object'),scope_digest text NOT NULL,
 UNIQUE(parameter_id,scope_digest)
);
CREATE TABLE governance_catalog.parameter_value_version (
 id uuid PRIMARY KEY DEFAULT uuidv7(),value_id uuid NOT NULL REFERENCES governance_catalog.parameter_value(id),
 number bigint NOT NULL CHECK(number>0),definition_version_id uuid NOT NULL REFERENCES governance_catalog.parameter_version(id),
 definition_digest text NOT NULL CHECK(definition_digest ~ '^[a-f0-9]{64}$'),value jsonb NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('METADATA','BOOLEAN_GATE_V1')),evidence_id uuid NOT NULL REFERENCES governance_catalog.protected_artifact(id),
 valid_from timestamp NOT NULL,valid_to timestamp,review_digest text NOT NULL CHECK(review_digest ~ '^[a-f0-9]{64}$'),
 maker_identity text NOT NULL,recorded_at timestamp NOT NULL,
 UNIQUE(value_id,number),CHECK(valid_to IS NULL OR valid_to>valid_from)
);
CREATE TABLE governance_catalog.parameter_value_approval (
 version_id uuid PRIMARY KEY REFERENCES governance_catalog.parameter_value_version(id),
 actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,review_digest text NOT NULL,
 recorded_at timestamp NOT NULL
);
DO $tables$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['parameter_value','parameter_value_version','parameter_value_approval'] LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON governance_catalog.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',tab);
  EXECUTE format('ALTER TABLE governance_catalog.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON governance_catalog.%I FROM PUBLIC,hdi_prototype',tab);
  EXECUTE format('GRANT SELECT ON governance_catalog.%I TO hdi_prototype',tab);
 END LOOP;
END $tables$;

CREATE FUNCTION governance_catalog.parameter_value_scope_access(p_actor text,p_definition uuid,p_scope jsonb,p_permission text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u jsonb;c jsonb;identity text;key text;BEGIN
 IF p_permission NOT IN ('READ','WRITE','REVIEW') OR jsonb_typeof(p_scope) IS DISTINCT FROM 'object'
  OR NOT p_scope ?& ARRAY['unit','campus','subject','services','capabilityType','careSetting']
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_scope) k WHERE k NOT IN ('unit','campus','subject','services','capabilityType','careSetting')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR key IN SELECT unnest(ARRAY['unit','campus','subject']) LOOP
  IF jsonb_typeof(p_scope->key) IS DISTINCT FROM 'object' OR NOT (p_scope->key) ?& ARRAY['owner','id']
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_scope->key) k WHERE k NOT IN ('owner','id'))
   OR coalesce(p_scope->key->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 END LOOP;
 IF p_scope->'unit'->>'owner' IS DISTINCT FROM 'care-organization/unit' OR p_scope->'campus'->>'owner' IS DISTINCT FROM 'organization-master/campus'
  OR p_scope->'subject'->>'owner' IS DISTINCT FROM 'organization-master'
  OR jsonb_typeof(p_scope->'capabilityType') IS DISTINCT FROM 'string' OR jsonb_typeof(p_scope->'careSetting') IS DISTINCT FROM 'string'
  OR p_scope->>'capabilityType' NOT IN ('REGISTER','ORDER','EXECUTE','CONSULT','ADMIT','DISPENSE','REPORT')
  OR p_scope->>'careSetting' NOT IN ('OUTPATIENT','INPATIENT','EMERGENCY','EXAMINATION','DAYCARE','INTERNET') THEN RAISE EXCEPTION 'PARAMETER_SCOPE_REQUIRED';END IF;
 IF jsonb_typeof(p_scope->'services') IS DISTINCT FROM 'array' OR jsonb_array_length(p_scope->'services') NOT BETWEEN 1 AND 100
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_scope->'services') v WHERE jsonb_typeof(v)<>'string' OR length(v#>>'{}') NOT BETWEEN 1 AND 64)
  OR (SELECT count(*)<>count(DISTINCT v) FROM jsonb_array_elements(p_scope->'services') v) THEN RAISE EXCEPTION 'PARAMETER_SCOPE_REQUIRED';END IF;
 IF p_permission<>'READ' AND NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=p_actor AND active AND principal_kind='HUMAN') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC',p_permission);
 PERFORM governance_catalog.parameter_require_access(p_actor,'SYNTHETIC',p_definition,p_permission);
 c:=organization_master.campus_snapshot(p_actor,(p_scope->'campus'->>'id')::uuid);
 PERFORM organization_master.snapshot(p_actor,(p_scope->'subject'->>'id')::uuid,c->>'scope');
 u:=care_organization.snapshot(p_actor,(p_scope->'unit'->>'id')::uuid);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(u->'bindings') b WHERE b->>'campusId'=p_scope->'campus'->>'id' AND b->>'subjectId'=p_scope->'subject'->>'id') THEN RAISE EXCEPTION 'PARAMETER_SCOPE_REQUIRED';END IF;
 RETURN identity;
END $$;

CREATE FUNCTION governance_catalog.parameter_value_access(p_actor text,p_id uuid,p_permission text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v governance_catalog.parameter_value;d uuid;BEGIN
 SELECT * INTO v FROM governance_catalog.parameter_value WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT definition_version_id INTO d FROM governance_catalog.parameter_value_version WHERE value_id=p_id ORDER BY number DESC LIMIT 1;
 PERFORM governance_catalog.parameter_value_scope_access(p_actor,d,v.scope_context,p_permission);
END $$;

CREATE FUNCTION governance_catalog.parameter_value_read(p_actor text,p_input jsonb,p_history boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE anchor governance_catalog.parameter_value;v record;cutoff timestamp;result jsonb:='[]';BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR NOT p_input ? 'id'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('id','versionId','recordAsOf')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 PERFORM governance_catalog.parameter_value_access(p_actor,(p_input->>'id')::uuid,'READ');
 SELECT * INTO STRICT anchor FROM governance_catalog.parameter_value WHERE id=(p_input->>'id')::uuid;
 cutoff:=CASE WHEN p_input->>'recordAsOf' IS NULL THEN timezone('Asia/Shanghai',clock_timestamp()) ELSE governance_catalog.contract_time(p_input->>'recordAsOf') END;
 FOR v IN SELECT d.*,a.recorded_at AS approved_at FROM governance_catalog.parameter_value_version d LEFT JOIN governance_catalog.parameter_value_approval a ON a.version_id=d.id AND a.recorded_at<=cutoff
  WHERE d.value_id=anchor.id AND d.recorded_at<=cutoff AND (p_input->>'versionId' IS NULL OR d.id=(p_input->>'versionId')::uuid)
  AND (p_history OR p_input->>'versionId' IS NOT NULL OR d.number=(SELECT max(x.number) FROM governance_catalog.parameter_value_version x WHERE x.value_id=anchor.id AND x.recorded_at<=cutoff)) ORDER BY d.number LOOP
  PERFORM governance_catalog.parameter_require_access(p_actor,'SYNTHETIC',v.definition_version_id,'READ');
  result:=result||jsonb_build_array(jsonb_build_object('id',anchor.id,'parameterId',anchor.parameter_id,'versionId',v.id,'head',v.number::text,'definitionVersionId',v.definition_version_id,'definitionDigest',v.definition_digest,
   'applicability',anchor.scope_context,'value',v.value,'purpose',v.purpose,'evidenceId',v.evidence_id,'validFrom',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),
   'recordedAt',to_char(v.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'approvedAt',to_char(v.approved_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'status',CASE WHEN v.approved_at IS NULL THEN 'DRAFT' ELSE 'APPROVED' END,'reviewDigest',v.review_digest));
 END LOOP;
 IF p_input->>'versionId' IS NOT NULL AND result='[]'::jsonb THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 RETURN result;
END $$;

CREATE FUNCTION governance_catalog.parameter_value_command(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE action text:=p_input->>'action';identity text;permission text;req uuid;request_digest text;prior vnext_control.outcome;
 anchor governance_catalog.parameter_value;v governance_catalog.parameter_value_version;d governance_catalog.parameter_version;applicability jsonb;
 from_b timestamp;to_b timestamp;record_r timestamp;val jsonb;content text;review_digest text;result jsonb;kind text;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR coalesce(action,'') NOT IN ('CREATE','REVISE','APPROVE')
  OR NOT p_input ?& ARRAY['action','requestId','reason'] OR length(coalesce(p_input->>'reason','')) NOT BETWEEN 1 AND 2000
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('action','requestId','reason') AND NOT
   ((action='CREATE' AND k IN ('definitionVersionId','definitionDigest','value','purpose','validFrom','validTo','evidenceId','applicability'))
    OR (action='REVISE' AND k IN ('target','expectedHead','definitionVersionId','definitionDigest','value','purpose','validFrom','validTo','evidenceId'))
    OR (action='APPROVE' AND k IN ('target','versionId','reviewDigest')))) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 permission:=CASE WHEN action='APPROVE' THEN 'REVIEW' ELSE 'WRITE' END;
 IF NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=p_actor AND active AND principal_kind='HUMAN') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC',permission);req:=(p_input->>'requestId')::uuid;
 request_digest:=encode(sha256(convert_to(jsonb_build_object('owner','GOV09_VALUE','input',p_input)::text,'UTF8')),'hex');
 SELECT o.* INTO prior FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=req;
 IF FOUND THEN
  IF prior.input_digest<>request_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
  PERFORM governance_catalog.parameter_value_access(p_actor,(prior.result->>'id')::uuid,permission);
  PERFORM governance_catalog.parameter_require_access(p_actor,'SYNTHETIC',(prior.result->>'definitionVersionId')::uuid,permission);
  RETURN prior.result;
 END IF;
 record_r:=timezone('Asia/Shanghai',clock_timestamp());
 IF action='CREATE' THEN applicability:=p_input->'applicability';ELSE
  SELECT * INTO anchor FROM governance_catalog.parameter_value WHERE id=(p_input->>'target')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  PERFORM governance_catalog.parameter_value_access(p_actor,anchor.id,permission);applicability:=anchor.scope_context;
  SELECT * INTO v FROM governance_catalog.parameter_value_version WHERE value_id=anchor.id AND (action='REVISE' OR id=(p_input->>'versionId')::uuid) ORDER BY number DESC LIMIT 1;
  IF v.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  IF action='REVISE' AND p_input->>'expectedHead' IS DISTINCT FROM v.number::text THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
 END IF;
 SELECT * INTO d FROM governance_catalog.parameter_version WHERE id=CASE WHEN action='APPROVE' THEN v.definition_version_id ELSE (p_input->>'definitionVersionId')::uuid END;
 IF d.id IS NULL THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 PERFORM governance_catalog.parameter_value_scope_access(p_actor,d.id,applicability,permission);
 IF action IN ('CREATE','REVISE') THEN
  IF NOT p_input ?& ARRAY['definitionVersionId','definitionDigest','value','purpose','validFrom','validTo','evidenceId'] THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF anchor.id IS NOT NULL AND anchor.parameter_id<>d.parameter_id THEN RAISE EXCEPTION 'PARAMETER_SCOPE_REQUIRED';END IF;
  IF p_input->>'definitionDigest' IS DISTINCT FROM d.definition_digest OR NOT EXISTS(SELECT 1 FROM governance_catalog.parameter_approval WHERE version_id=d.id AND recorded_at<=record_r) THEN RAISE EXCEPTION 'PARAMETER_NOT_APPROVED';END IF;
  IF (SELECT parameter_key FROM governance_catalog.parameter WHERE id=d.parameter_id) ~* '(PASSWORD|TOKEN|SECRET|PRIVATE_KEY|CREDENTIAL)' THEN RAISE EXCEPTION 'PARAMETER_VALUE_FORBIDDEN';END IF;
  from_b:=governance_catalog.contract_time(p_input->>'validFrom');to_b:=CASE WHEN p_input->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(p_input->>'validTo') END;
  IF to_b IS NOT NULL AND to_b<=from_b THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
  IF NOT tsrange(d.valid_from,d.valid_to,'[)') @> tsrange(from_b,to_b,'[)') OR NOT governance_catalog.source_valid_spans(d.system_version_id,record_r) @> tsrange(from_b,to_b,'[)') THEN RAISE EXCEPTION 'PARAMETER_PERIOD_NOT_COVERED';END IF;
  val:=p_input->'value';kind:=d.definition->>'valueType';
  IF jsonb_typeof(val) IS DISTINCT FROM 'object' OR NOT val ?& ARRAY['type','value'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(val) k WHERE k NOT IN ('type','value')) OR val->>'type' IS DISTINCT FROM kind THEN RAISE EXCEPTION 'PARAMETER_VALUE_INVALID';END IF;
  content:=val->>'value';
  IF kind='TEXT' AND content ~* '(-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer[[:space:]]+[A-Za-z0-9._-]+|sk-[A-Za-z0-9_-]{16,}|^(password|token|credential)[[:space:]]*[:=]|^(SELECT|INSERT|UPDATE|DELETE|DROP|EXECUTE)[[:space:]].*;|^\$\{.*\}$)' THEN RAISE EXCEPTION 'PARAMETER_VALUE_FORBIDDEN';END IF;
  IF (kind='BOOLEAN' AND jsonb_typeof(val->'value') IS DISTINCT FROM 'boolean')
   OR (kind IN ('TEXT','INTEGER','DECIMAL') AND (jsonb_typeof(val->'value') IS DISTINCT FROM 'string' OR length(content)>256))
   OR (kind='INTEGER' AND content !~ '^-?(0|[1-9][0-9]*)$') OR (kind='DECIMAL' AND content !~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$')
   OR (jsonb_array_length(d.definition->'enumValues')>0 AND NOT (d.definition->'enumValues') ? content)
   OR coalesce(p_input->>'purpose','') NOT IN ('METADATA','BOOLEAN_GATE_V1') OR (p_input->>'purpose'='BOOLEAN_GATE_V1' AND kind<>'BOOLEAN') THEN RAISE EXCEPTION 'PARAMETER_VALUE_INVALID';END IF;
  PERFORM governance_catalog.registration_evidence_access(p_actor,(p_input->>'evidenceId')::uuid,d.system_version_id,organization_master.campus_snapshot(p_actor,(applicability->'campus'->>'id')::uuid)->>'scope');
  IF action='CREATE' THEN
   applicability:=jsonb_set(applicability,'{services}',(SELECT jsonb_agg(s ORDER BY s) FROM jsonb_array_elements_text(applicability->'services') s));
   INSERT INTO governance_catalog.parameter_value(parameter_id,scope_context,scope_digest) VALUES(d.parameter_id,applicability,encode(sha256(convert_to(applicability::text,'UTF8')),'hex')) RETURNING * INTO anchor;
  END IF;
  review_digest:=encode(sha256(convert_to(jsonb_build_object('scope',applicability,'definition',d.id,'definitionDigest',d.definition_digest,'value',val,'purpose',p_input->>'purpose','from',from_b,'to',to_b,'evidence',p_input->>'evidenceId')::text,'UTF8')),'hex');
  INSERT INTO governance_catalog.parameter_value_version(value_id,number,definition_version_id,definition_digest,value,purpose,evidence_id,valid_from,valid_to,review_digest,maker_identity,recorded_at)
   VALUES(anchor.id,coalesce(v.number,0)+1,d.id,d.definition_digest,val,p_input->>'purpose',(p_input->>'evidenceId')::uuid,from_b,to_b,review_digest,identity,record_r) RETURNING * INTO v;
 ELSE
  IF identity=v.maker_identity THEN RAISE EXCEPTION 'SELF_REVIEW_FORBIDDEN';END IF;
  IF p_input->>'reviewDigest' IS DISTINCT FROM v.review_digest THEN RAISE EXCEPTION 'REVIEW_DIGEST_MISMATCH';END IF;
  PERFORM governance_catalog.parameter_require_reference(p_actor,'SYNTHETIC',d.id,v.definition_digest,tsrange(v.valid_from,v.valid_to,'[)'));
  PERFORM governance_catalog.registration_evidence_access(p_actor,v.evidence_id,d.system_version_id,organization_master.campus_snapshot(p_actor,(applicability->'campus'->>'id')::uuid)->>'scope');
  INSERT INTO governance_catalog.parameter_value_approval(version_id,actor,identity_code,review_digest,recorded_at) VALUES(v.id,p_actor,identity,v.review_digest,record_r) ON CONFLICT DO NOTHING;
 END IF;
 result:=governance_catalog.parameter_value_read(p_actor,jsonb_build_object('id',anchor.id,'versionId',v.id),false)->0;
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(p_actor,req,request_digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,p_actor);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,anchor.id,'PARAMETER_VALUE_'||action,'GOV09_SCOPED_VALUE',request_digest);
 RETURN result;
END $$;

CREATE FUNCTION governance_catalog.parameter_value_evaluate(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE from_b timestamp;to_b timestamp;cutoff timestamp;v governance_catalog.parameter_value_version;d governance_catalog.parameter_version;current_definition uuid;item jsonb;reason text;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR NOT p_input ?& ARRAY['id','validFrom','validTo']
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('id','versionId','recordAsOf','validFrom','validTo')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 PERFORM governance_catalog.parameter_value_access(p_actor,(p_input->>'id')::uuid,'READ');
 from_b:=governance_catalog.contract_time(p_input->>'validFrom');to_b:=CASE WHEN p_input->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(p_input->>'validTo') END;
 IF to_b IS NOT NULL AND to_b<=from_b THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 cutoff:=CASE WHEN p_input->>'recordAsOf' IS NULL THEN timezone('Asia/Shanghai',clock_timestamp()) ELSE governance_catalog.contract_time(p_input->>'recordAsOf') END;
 SELECT x.* INTO v FROM governance_catalog.parameter_value_version x JOIN governance_catalog.parameter_value_approval a ON a.version_id=x.id AND a.recorded_at<=cutoff
  WHERE x.value_id=(p_input->>'id')::uuid AND x.recorded_at<=cutoff ORDER BY x.number DESC LIMIT 1;
 IF v.id IS NULL THEN RETURN jsonb_build_object('item',NULL,'covered',false,'currentDefinitionVersionId',NULL,'reason','PARAMETER_NOT_APPROVED');END IF;
 SELECT * INTO STRICT d FROM governance_catalog.parameter_version WHERE id=v.definition_version_id;
 SELECT pv.id INTO current_definition FROM governance_catalog.parameter_version pv JOIN governance_catalog.parameter_approval a ON a.version_id=pv.id AND a.recorded_at<=cutoff WHERE pv.parameter_id=d.parameter_id AND pv.recorded_at<=cutoff ORDER BY pv.number DESC LIMIT 1;
 item:=governance_catalog.parameter_value_read(p_actor,jsonb_build_object('id',p_input->>'id','versionId',v.id,'recordAsOf',to_char(cutoff,'YYYY-MM-DD"T"HH24:MI:SS.US')),false)->0;
 reason:=CASE WHEN (p_input->>'versionId' IS NOT NULL AND p_input->>'versionId'<>v.id::text) OR current_definition<>d.id THEN 'PARAMETER_ADOPTION_CHANGED'
  WHEN NOT tsrange(v.valid_from,v.valid_to,'[)') @> tsrange(from_b,to_b,'[)') OR NOT tsrange(d.valid_from,d.valid_to,'[)') @> tsrange(from_b,to_b,'[)') OR NOT governance_catalog.source_valid_spans(d.system_version_id,cutoff) @> tsrange(from_b,to_b,'[)') THEN 'PARAMETER_PERIOD_NOT_COVERED' ELSE 'SATISFIED' END;
 RETURN jsonb_build_object('item',item,'covered',reason='SATISFIED','currentDefinitionVersionId',current_definition,'reason',reason);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.parameter_value_scope_access(text,uuid,jsonb,text),governance_catalog.parameter_value_access(text,uuid,text),governance_catalog.parameter_value_read(text,jsonb,boolean),governance_catalog.parameter_value_command(text,jsonb),governance_catalog.parameter_value_evaluate(text,jsonb) FROM PUBLIC,hdi_prototype;
