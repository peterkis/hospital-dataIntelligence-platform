-- Contract metadata belongs to the existing catalog owner. No ORG/PER facts.
SELECT pg_advisory_xact_lock(901002);
CREATE TABLE governance_catalog.import_contract (
 id uuid PRIMARY KEY DEFAULT uuidv7(), dataset_id uuid NOT NULL REFERENCES governance_catalog.object(id),
 profile text NOT NULL CHECK(profile IN ('CORE','FULL')), UNIQUE(dataset_id,profile)
);
CREATE TABLE governance_catalog.import_contract_version (
 id uuid PRIMARY KEY DEFAULT uuidv7(), contract_id uuid NOT NULL REFERENCES governance_catalog.import_contract(id),
 number integer NOT NULL CHECK(number>0), dataset_version_id uuid NOT NULL REFERENCES governance_catalog.version(id),
 source_snapshot_id uuid NOT NULL REFERENCES governance_catalog.source_snapshot(id),
 schemas jsonb NOT NULL CHECK(jsonb_typeof(schemas)='object'),
 semantics_digest text NOT NULL CHECK(semantics_digest ~ '^[a-f0-9]{64}$'),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
 maker_identity text NOT NULL, valid_from timestamp NOT NULL, valid_to timestamp,
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 UNIQUE(contract_id,number), UNIQUE(id,contract_id), CHECK(valid_to IS NULL OR valid_to>valid_from)
);
CREATE TABLE governance_catalog.import_contract_event (
 head bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, contract_id uuid NOT NULL,
 version_id uuid NOT NULL, status text NOT NULL CHECK(status IN ('DRAFT','APPROVED','PUBLISHED','RETIRED')),
 actor_code text NOT NULL REFERENCES vnext_control.actor(code),
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 FOREIGN KEY(version_id,contract_id) REFERENCES governance_catalog.import_contract_version(id,contract_id)
);
CREATE INDEX import_contract_event_head ON governance_catalog.import_contract_event(contract_id,head DESC);
CREATE TRIGGER import_contract_immutable BEFORE UPDATE OR DELETE ON governance_catalog.import_contract FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE TRIGGER import_contract_version_immutable BEFORE UPDATE OR DELETE ON governance_catalog.import_contract_version FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE TRIGGER import_contract_event_immutable BEFORE UPDATE OR DELETE ON governance_catalog.import_contract_event FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();

CREATE FUNCTION governance_catalog.contract_time(value text) RETURNS timestamp LANGUAGE plpgsql SET search_path=pg_catalog,governance_catalog AS $$
DECLARE parsed timestamp;
BEGIN
 parsed:=governance_catalog.local_time(value);
 IF to_char(parsed,'YYYY-MM-DD"T"HH24:MI:SS')<>left(value,19) THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED'; END IF;
 RETURN parsed;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED';
END $$;

CREATE FUNCTION governance_catalog.contract_schemas(definition jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE field_value jsonb; field_schema jsonb; properties jsonb:='{}'; required_fields jsonb:='[]'; row_schema jsonb;
BEGIN
 FOR field_value IN SELECT value FROM jsonb_array_elements(definition->'fields') LOOP
  field_schema:=jsonb_build_object('type','string','x-privacy',field_value->>'privacy','x-condition',field_value->>'condition');
  IF jsonb_array_length(field_value->'enumValues')>0 THEN field_schema:=field_schema||jsonb_build_object('enum',field_value->'enumValues'); END IF;
  CASE field_value->>'type'
   WHEN 'integer' THEN field_schema:=field_schema||jsonb_build_object('pattern','^-?(0|[1-9][0-9]*)$');
   WHEN 'decimal' THEN field_schema:=field_schema||jsonb_build_object('pattern','^-?(0|[1-9][0-9]*)(\.[0-9]+)?$');
   WHEN 'date' THEN field_schema:=field_schema||jsonb_build_object('pattern','^\d{4}-\d{2}-\d{2}$');
   WHEN 'datetime' THEN field_schema:=field_schema||jsonb_build_object('pattern','^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$');
   ELSE NULL;
  END CASE;
  IF field_value->>'required'='R' THEN required_fields:=required_fields||jsonb_build_array(field_value->>'code');
  ELSE field_schema:=jsonb_build_object('anyOf',jsonb_build_array(field_schema,jsonb_build_object('type','null'))); END IF;
  properties:=properties||jsonb_build_object(field_value->>'code',field_schema);
 END LOOP;
 row_schema:=jsonb_build_object('type','object','properties',properties,'required',required_fields,'additionalProperties',false);
 RETURN jsonb_build_object('sourceRowSchema',row_schema,
  'createSchema',jsonb_build_object('type','object','properties',jsonb_build_object('operation',jsonb_build_object('const','CREATE'),'sourceAlias',jsonb_build_object('type','string','minLength',1,'maxLength',256),'values',row_schema),'required',jsonb_build_array('operation','sourceAlias','values'),'additionalProperties',false),
  'updateSchema',jsonb_build_object('type','object','properties',jsonb_build_object('operation',jsonb_build_object('const','UPDATE'),'platformRef',jsonb_build_object('type','string','format','uuid'),'expectedVersion',jsonb_build_object('type','integer','minimum',1),'values',row_schema),'required',jsonb_build_array('operation','platformRef','expectedVersion','values'),'additionalProperties',false),
  'limitations',jsonb_build_array('STRUCTURAL_SCHEMA_ONLY','CONDITIONAL_AND_REFERENCE_OWNER_VALIDATION_REQUIRED','NO_BUSINESS_APPLY'));
END $$;
REVOKE ALL ON FUNCTION governance_catalog.contract_time(text),governance_catalog.contract_schemas(jsonb) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.contract_definition(p_definition jsonb,p_dataset_version uuid,p_profile text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE field_value jsonb; original jsonb; dataset jsonb; entry jsonb;
BEGIN
 IF jsonb_typeof(p_definition) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_definition) k WHERE k NOT IN ('ruleVersion','templateVersion','fields','codeSets','rules','references','sourceVersionId'))
 OR NOT p_definition ?& ARRAY['ruleVersion','templateVersion','fields','codeSets','rules','references','sourceVersionId'] THEN RAISE EXCEPTION 'CLOSED_DEFINITION_REQUIRED'; END IF;
 IF coalesce(p_definition->>'ruleVersion','') !~ '^[A-Z0-9_.-]{1,64}$' OR coalesce(p_definition->>'templateVersion','') !~ '^[A-Z0-9_.-]{1,64}$'
 OR jsonb_typeof(p_definition->'fields') IS DISTINCT FROM 'array' OR jsonb_array_length(p_definition->'fields') NOT BETWEEN 1 AND 100
 OR jsonb_typeof(p_definition->'codeSets') IS DISTINCT FROM 'array' OR jsonb_typeof(p_definition->'rules') IS DISTINCT FROM 'array' OR jsonb_typeof(p_definition->'references') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_CONTRACT_DEFINITION'; END IF;
 SELECT payload INTO dataset FROM governance_catalog.version WHERE id=p_dataset_version;
 IF dataset IS NULL THEN RAISE EXCEPTION 'UNKNOWN_DATASET_VERSION'; END IF;
 IF (SELECT count(*)<>count(DISTINCT value->>'code') FROM jsonb_array_elements(p_definition->'fields')) THEN RAISE EXCEPTION 'DUPLICATE_FIELD'; END IF;
 FOR field_value IN SELECT value FROM jsonb_array_elements(p_definition->'fields') LOOP
  IF jsonb_typeof(field_value) IS DISTINCT FROM 'object' OR NOT field_value ?& ARRAY['code','type','required','privacy','condition','enumValues'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(field_value) k WHERE k NOT IN ('code','type','required','privacy','condition','enumValues')) THEN RAISE EXCEPTION 'CLOSED_FIELD_REQUIRED'; END IF;
  SELECT value->'original' INTO original FROM jsonb_array_elements(dataset->'fields') WHERE value->'original'->>'code'=field_value->>'code';
  IF original IS NULL THEN RAISE EXCEPTION 'UNKNOWN_FIELD'; END IF;
  IF (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(field_value->'enumValues')) THEN RAISE EXCEPTION 'DUPLICATE_ENUM'; END IF;
  IF field_value->>'type' IS DISTINCT FROM original->>'type' OR field_value->>'required' IS DISTINCT FROM original->>'required' OR field_value->>'privacy' IS DISTINCT FROM original->>'privacy'
  OR coalesce(field_value->>'condition','') NOT IN ('ALWAYS','OPTIONAL','UNRESOLVED','MANUAL_EVIDENCE') OR jsonb_typeof(field_value->'enumValues') IS DISTINCT FROM 'array'
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(field_value->'enumValues') x WHERE jsonb_typeof(x)<>'string' OR length(x#>>'{}') NOT BETWEEN 1 AND 256)
  OR (field_value->>'required'='C' AND field_value->>'condition' NOT IN ('UNRESOLVED','MANUAL_EVIDENCE'))
  OR (field_value->>'required'='R' AND field_value->>'condition'<>'ALWAYS') OR (field_value->>'required'='O' AND field_value->>'condition'<>'OPTIONAL') THEN RAISE EXCEPTION 'INVALID_FIELD_ENUM'; END IF;
 END LOOP;
 IF p_profile='FULL' AND jsonb_array_length(p_definition->'fields')<>jsonb_array_length(dataset->'fields') THEN RAISE EXCEPTION 'FULL_FIELD_OMISSION'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_definition->'codeSets') LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR NOT entry ?& ARRAY['field','codeSystem','version','status','codes','validFrom','validTo','sourceVersionId']
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) k WHERE k NOT IN ('field','codeSystem','version','status','codes','validFrom','validTo','sourceVersionId')) THEN RAISE EXCEPTION 'CLOSED_CODESET_REQUIRED'; END IF;
  IF coalesce(entry->>'status','') NOT IN ('CANDIDATE','SYNTHETIC_ADOPTED') OR coalesce(entry->>'codeSystem','') !~ '^[A-Z0-9_.-]{1,64}$' OR coalesce(entry->>'version','') !~ '^[A-Z0-9_.-]{1,64}$'
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_definition->'fields') x WHERE x->>'code'=entry->>'field' AND x->'enumValues'=entry->'codes') OR jsonb_typeof(entry->'codes') IS DISTINCT FROM 'array' OR jsonb_array_length(entry->'codes')=0 THEN RAISE EXCEPTION 'CODESET_AUTHORITY_INVALID'; END IF;
  IF entry->>'status'='SYNTHETIC_ADOPTED' AND entry->>'codeSystem' !~ '^SYNTHETIC_' THEN RAISE EXCEPTION 'CODESET_AUTHORITY_INVALID'; END IF;
  PERFORM governance_catalog.contract_time(entry->>'validFrom');
  IF entry->>'validTo' IS NOT NULL AND governance_catalog.contract_time(entry->>'validTo')<=governance_catalog.contract_time(entry->>'validFrom') THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD'; END IF;
 END LOOP;
 IF (SELECT count(*)<>count(DISTINCT value->>'field') FROM jsonb_array_elements(p_definition->'codeSets')) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_definition->'fields') f WHERE jsonb_array_length(f->'enumValues')>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_definition->'codeSets') c WHERE c->>'field'=f->>'code')) THEN RAISE EXCEPTION 'CODESET_REQUIRED'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_definition->'rules') LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR NOT entry ?& ARRAY['id','field','text','status','version'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) k WHERE k NOT IN ('id','field','text','status','version')) THEN RAISE EXCEPTION 'CLOSED_RULE_REQUIRED'; END IF;
  IF coalesce(entry->>'status','')<>'UNRESOLVED' OR coalesce(entry->>'id','') !~ '^[A-Z0-9_-]{1,64}$' OR coalesce(entry->>'version','') !~ '^[A-Z0-9_.-]{1,64}$' OR length(coalesce(entry->>'text','')) NOT BETWEEN 1 AND 2000
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_definition->'fields') f WHERE f->>'code'=entry->>'field') THEN RAISE EXCEPTION 'INVALID_RULE_VERSION'; END IF;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_definition->'references') LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR NOT entry ?& ARRAY['field','target','status'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) k WHERE k NOT IN ('field','target','status','parameterVersionId','parameterDigest')) THEN RAISE EXCEPTION 'CLOSED_REFERENCE_REQUIRED'; END IF;
  IF coalesce(entry->>'status','') NOT IN ('BLOCKED_DEPENDENCY','DECLARED_PARAMETER') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(dataset->'fields') f WHERE f->'original'->>'code'=entry->>'field' AND f->'original'->>'ref'=entry->>'target' AND coalesce(f->'original'->>'ref','')<>'') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_definition->'fields') f WHERE f->>'code'=entry->>'field') THEN RAISE EXCEPTION 'REFERENCE_INVALID'; END IF;
  IF entry->>'status'='DECLARED_PARAMETER' THEN
   IF entry->>'target' IS DISTINCT FROM 'GOV09.config_id' OR coalesce(entry->>'parameterVersionId','') !~ '^[a-f0-9-]{36}$' OR coalesce(entry->>'parameterDigest','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'REFERENCE_INVALID'; END IF;
  ELSIF entry ?| ARRAY['parameterVersionId','parameterDigest'] THEN RAISE EXCEPTION 'CLOSED_REFERENCE_REQUIRED'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_definition->'fields') selected JOIN LATERAL (SELECT value->'original' AS original FROM jsonb_array_elements(dataset->'fields') WHERE value->'original'->>'code'=selected->>'code') source ON true WHERE coalesce(source.original->>'ref','')<>'' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_definition->'references') r WHERE r->>'field'=selected->>'code' AND r->>'target'=source.original->>'ref')) THEN RAISE EXCEPTION 'REFERENCE_REQUIRED'; END IF;
END $$;

CREATE FUNCTION governance_catalog.contract_require_access(p_actor text,p_scope text,p_version uuid,p_permission text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE ver governance_catalog.import_contract_version; dataset governance_catalog.version; source_version uuid; source_row governance_catalog.version; parameter_ref jsonb;
BEGIN
 SELECT * INTO ver FROM governance_catalog.import_contract_version WHERE id=p_version;
 SELECT * INTO dataset FROM governance_catalog.version WHERE id=ver.dataset_version_id;
 IF ver.id IS NULL OR dataset.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=dataset.object_id AND kind='DATASET' AND scope=p_scope) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 PERFORM vnext_control.authorize(p_actor,p_scope,p_permission);
 IF p_permission<>'READ' THEN PERFORM vnext_control.require_object(p_actor,p_scope,dataset.object_id,p_permission,'METADATA',dataset.payload); END IF;
 IF NOT vnext_control.definition_allowed(p_actor,dataset.object_id,dataset.payload,'METADATA') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 FOR source_version IN SELECT (ver.definition->>'sourceVersionId')::uuid WHERE ver.definition->>'sourceVersionId' IS NOT NULL UNION SELECT (value->>'sourceVersionId')::uuid FROM jsonb_array_elements(ver.definition->'codeSets') WHERE value->>'sourceVersionId' IS NOT NULL LOOP
  SELECT v.* INTO source_row FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=source_version AND o.kind='SOURCE' AND o.scope=p_scope;
  IF source_row.id IS NULL THEN RAISE EXCEPTION 'SOURCE_REFERENCE_INVALID'; END IF;
  PERFORM vnext_control.require_source_access(p_actor,p_scope,source_row.object_id,source_row.id);
 END LOOP;
 FOR parameter_ref IN SELECT value FROM jsonb_array_elements(ver.definition->'references') WHERE value->>'status'='DECLARED_PARAMETER' LOOP
  PERFORM governance_catalog.parameter_require_access(p_actor,p_scope,(parameter_ref->>'parameterVersionId')::uuid,'READ');
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.contract_require_access(text,text,uuid,text) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.contract_command(actor text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE action text:=input->>'action'; sc text:=input->>'scope'; identity text; req uuid; requested_digest text;
 dataset governance_catalog.version; obj governance_catalog.object; contract governance_catalog.import_contract;
 ver governance_catalog.import_contract_version; ev governance_catalog.import_contract_event;
 previous vnext_control.outcome; result jsonb; begin_b timestamp; end_b timestamp; permission text;
 digest text; blockers jsonb:='[]'; next_status text; source_ver governance_catalog.version;
 at_r timestamp; decision text; adoption jsonb; replay_ver governance_catalog.import_contract_version; pinned_source uuid; source_id uuid; impact_context jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 at_r:=timezone('Asia/Shanghai',clock_timestamp());
 permission:=CASE WHEN action='APPROVE' THEN 'REVIEW' WHEN action IN ('PUBLISH','RETIRE') THEN 'PUBLISH' ELSE 'WRITE' END;
 identity:=vnext_control.authorize(actor,sc,permission);
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('action','scope','requestId','reason','datasetVersionId','profile','definition','validFrom','validTo','target','expectedHead','reviewDigest','impactDigest')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 IF coalesce(action,'') NOT IN ('CREATE','REVISE','VALIDATE','APPROVE','PUBLISH','RETIRE') OR coalesce(input->>'reason','') !~ '^[A-Z0-9_]{1,64}$' OR coalesce(input->>'requestId','') !~ '^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('action','scope','requestId','reason') AND NOT
 ((action='CREATE' AND k IN ('datasetVersionId','profile','definition','validFrom','validTo')) OR
  (action='REVISE' AND k IN ('target','expectedHead','datasetVersionId','definition','validFrom','validTo')) OR
  (action='VALIDATE' AND k IN ('target','expectedHead','reviewDigest')) OR
  (action IN ('APPROVE','PUBLISH','RETIRE') AND k IN ('target','expectedHead','reviewDigest','impactDigest')))) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 req:=(input->>'requestId')::uuid;
 IF action='CREATE' THEN
  IF input ?| ARRAY['target','expectedHead','reviewDigest'] OR coalesce(input->>'profile','') NOT IN ('CORE','FULL') THEN RAISE EXCEPTION 'INVALID_CREATE'; END IF;
  SELECT * INTO dataset FROM governance_catalog.version WHERE id=(input->>'datasetVersionId')::uuid;
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k IN ('datasetVersionId','profile','definition','validFrom','validTo')) AND action<>'REVISE' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  SELECT * INTO contract FROM governance_catalog.import_contract WHERE id=(input->>'target')::uuid;
  SELECT * INTO ev FROM governance_catalog.import_contract_event WHERE contract_id=contract.id ORDER BY head DESC LIMIT 1;
  SELECT * INTO ver FROM governance_catalog.import_contract_version WHERE id=ev.version_id;
  SELECT * INTO dataset FROM governance_catalog.version WHERE id=ver.dataset_version_id;
 END IF;
 SELECT * INTO obj FROM governance_catalog.object WHERE id=dataset.object_id AND kind='DATASET' AND scope=sc;
 IF obj.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 PERFORM vnext_control.require_object(actor,sc,obj.id,permission,'METADATA',dataset.payload);
 IF NOT vnext_control.definition_allowed(actor,obj.id,dataset.payload,'METADATA') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 requested_digest:=encode(sha256(convert_to(jsonb_build_object('owner','IMPORT_CONTRACT','input',input)::text,'UTF8')),'hex');
 SELECT o.* INTO previous FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=req;
 IF FOUND THEN
  IF previous.input_digest<>requested_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
  SELECT * INTO STRICT replay_ver FROM governance_catalog.import_contract_version WHERE id=(previous.result->>'versionId')::uuid AND contract_id=(previous.result->>'id')::uuid;
  PERFORM governance_catalog.contract_require_access(actor,sc,replay_ver.id,permission);
  FOR pinned_source IN SELECT (replay_ver.definition->>'sourceVersionId')::uuid WHERE replay_ver.definition->>'sourceVersionId' IS NOT NULL UNION SELECT (value->>'sourceVersionId')::uuid FROM jsonb_array_elements(replay_ver.definition->'codeSets') WHERE value->>'sourceVersionId' IS NOT NULL LOOP
   SELECT object_id INTO source_id FROM governance_catalog.version WHERE id=pinned_source;
   PERFORM vnext_control.require_source_access(actor,sc,source_id,pinned_source);
  END LOOP;
  RETURN previous.result;
 END IF;
 IF action<>'CREATE' AND input->>'expectedHead' IS DISTINCT FROM ev.head::text THEN RAISE EXCEPTION 'STALE_HEAD'; END IF;
 IF action='RETIRE' THEN
  SELECT * INTO ev FROM governance_catalog.import_contract_event WHERE contract_id=contract.id AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1;
  IF ev.head IS NULL OR ev.status<>'PUBLISHED' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
  SELECT * INTO ver FROM governance_catalog.import_contract_version WHERE id=ev.version_id;
 END IF;
 IF action<>'CREATE' THEN PERFORM governance_catalog.contract_require_access(actor,sc,ver.id,permission); END IF;
 IF action IN ('CREATE','REVISE') THEN
  IF action='REVISE' THEN
   IF input ? 'profile' OR input ? 'reviewDigest' THEN RAISE EXCEPTION 'FIXED_DATASET_REFERENCE_REQUIRED'; END IF;
   IF input ? 'datasetVersionId' THEN
    SELECT * INTO dataset FROM governance_catalog.version WHERE id=(input->>'datasetVersionId')::uuid AND object_id=contract.dataset_id;
    IF dataset.id IS NULL THEN RAISE EXCEPTION 'FIXED_DATASET_REFERENCE_REQUIRED'; END IF;
    PERFORM vnext_control.require_object(actor,sc,obj.id,'WRITE','METADATA',dataset.payload);
    IF NOT vnext_control.definition_allowed(actor,obj.id,dataset.payload,'METADATA') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
   END IF;
   IF ev.status='RETIRED' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
   IF EXISTS(SELECT 1 FROM governance_catalog.import_contract_version v WHERE v.contract_id=contract.id AND v.definition->>'ruleVersion'=input->'definition'->>'ruleVersion') THEN RAISE EXCEPTION 'IMMUTABLE_RULE_VERSION'; END IF;
  END IF;
  PERFORM governance_catalog.contract_definition(input->'definition',dataset.id,coalesce(contract.profile,input->>'profile'));
  begin_b:=governance_catalog.contract_time(input->>'validFrom');
  end_b:=CASE WHEN input->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(input->>'validTo') END;
  IF end_b IS NOT NULL AND end_b<=begin_b THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD'; END IF;
  FOR adoption IN SELECT value FROM jsonb_array_elements(input->'definition'->'references') WHERE value->>'status'='DECLARED_PARAMETER' LOOP
   PERFORM governance_catalog.parameter_require_reference(actor,sc,(adoption->>'parameterVersionId')::uuid,adoption->>'parameterDigest',tsrange(begin_b,end_b,'[)'));
  END LOOP;
  IF input->'definition'->>'sourceVersionId' IS NOT NULL THEN
   SELECT v.* INTO source_ver FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=(input->'definition'->>'sourceVersionId')::uuid AND o.kind='SOURCE' AND o.scope=sc;
   IF source_ver.id IS NULL THEN RAISE EXCEPTION 'SOURCE_REFERENCE_INVALID'; END IF;
   PERFORM vnext_control.require_source_access(actor,sc,source_ver.object_id,source_ver.id);
  END IF;
  FOR pinned_source IN SELECT (value->>'sourceVersionId')::uuid FROM jsonb_array_elements(input->'definition'->'codeSets') LOOP
   SELECT v.* INTO source_ver FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=pinned_source AND o.kind='SOURCE' AND o.scope=sc;
   IF source_ver.id IS NULL THEN RAISE EXCEPTION 'SOURCE_REFERENCE_INVALID'; END IF;
   PERFORM vnext_control.require_source_access(actor,sc,source_ver.object_id,source_ver.id);
  END LOOP;
  IF action='CREATE' THEN
   IF EXISTS(SELECT 1 FROM governance_catalog.import_contract WHERE dataset_id=obj.id AND profile=input->>'profile') THEN RAISE EXCEPTION 'CONTRACT_EXISTS'; END IF;
   INSERT INTO governance_catalog.import_contract(dataset_id,profile) VALUES(obj.id,input->>'profile') RETURNING * INTO contract;
  END IF;
  INSERT INTO governance_catalog.import_contract_version(contract_id,number,dataset_version_id,source_snapshot_id,schemas,semantics_digest,definition,maker_identity,valid_from,valid_to) VALUES(contract.id,coalesce(ver.number,0)+1,dataset.id,(SELECT id FROM governance_catalog.source_snapshot WHERE source_key='P0_02_CONTRACT_DRAFTS'),governance_catalog.contract_schemas(input->'definition'),(SELECT encode(sha256(convert_to(string_agg(id||':'||sha256,'|' ORDER BY id),'UTF8')),'hex') FROM vnext_control.migration),input->'definition',identity,begin_b,end_b) RETURNING * INTO ver;
  next_status:='DRAFT';
 ELSE
  IF action<>'RETIRE' THEN
   IF jsonb_array_length(ver.definition->'rules')>0 THEN blockers:=blockers||jsonb_build_array('UNRESOLVED_RULE'); END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(ver.definition->'references') WHERE value->>'status'='BLOCKED_DEPENDENCY') THEN blockers:=blockers||jsonb_build_array('REFERENCE_NOT_READY'); END IF;
   FOR adoption IN SELECT value FROM jsonb_array_elements(ver.definition->'references') WHERE value->>'status'='DECLARED_PARAMETER' LOOP
    PERFORM governance_catalog.parameter_require_reference(actor,sc,(adoption->>'parameterVersionId')::uuid,adoption->>'parameterDigest',tsrange(ver.valid_from,ver.valid_to,'[)'));
   END LOOP;
   FOR adoption IN SELECT value FROM jsonb_array_elements(ver.definition->'codeSets') LOOP
    IF adoption->>'status'<>'SYNTHETIC_ADOPTED' THEN blockers:=blockers||jsonb_build_array('CODESET_NOT_ADOPTED'); END IF;
    IF NOT tsrange(governance_catalog.contract_time(adoption->>'validFrom'),CASE WHEN adoption->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(adoption->>'validTo') END,'[)') @> tsrange(ver.valid_from,ver.valid_to,'[)') THEN blockers:=blockers||jsonb_build_array('CODESET_PERIOD_NOT_COVERED'); END IF;
    SELECT v.* INTO source_ver FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=(adoption->>'sourceVersionId')::uuid AND o.kind='SOURCE' AND o.scope=sc;
    IF source_ver.id IS NULL THEN RAISE EXCEPTION 'SOURCE_REFERENCE_INVALID'; END IF;
    PERFORM vnext_control.require_source_access(actor,sc,source_ver.object_id,source_ver.id);
    IF NOT governance_catalog.source_valid_spans(source_ver.id,at_r) @> tsrange(ver.valid_from,ver.valid_to,'[)') THEN blockers:=blockers||jsonb_build_array('CODESET_SOURCE_NOT_READY'); END IF;
   END LOOP;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(ver.definition->'fields') f WHERE f->>'condition' IN ('UNRESOLVED','MANUAL_EVIDENCE')) THEN blockers:=blockers||jsonb_build_array('UNRESOLVED_REQUIRED_CONDITION'); END IF;
   IF NOT EXISTS(SELECT 1 FROM governance_catalog.definition_spans(obj.id,at_r) s WHERE s.version_id=dataset.id AND s.effective_span @> tsrange(ver.valid_from,ver.valid_to,'[)')) THEN blockers:=blockers||jsonb_build_array('DATASET_PERIOD_NOT_COVERED'); END IF;
   IF ver.definition->>'sourceVersionId' IS NULL THEN blockers:=blockers||jsonb_build_array('SOURCE_NOT_READY');
   ELSE
    SELECT * INTO source_ver FROM governance_catalog.version WHERE id=(ver.definition->>'sourceVersionId')::uuid;
    PERFORM vnext_control.require_source_access(actor,sc,source_ver.object_id,source_ver.id);
    IF NOT governance_catalog.source_valid_spans(source_ver.id,at_r) @> tsrange(ver.valid_from,ver.valid_to,'[)') THEN blockers:=blockers||jsonb_build_array('SOURCE_PERIOD_NOT_COVERED'); END IF;
   END IF;
  END IF;
  IF action IN ('APPROVE','PUBLISH') AND blockers<>'[]'::jsonb THEN RAISE EXCEPTION 'CONTRACT_VALIDATION_BLOCKED'; END IF;
  IF action='APPROVE' THEN
   IF identity=ver.maker_identity THEN RAISE EXCEPTION 'SELF_REVIEW_FORBIDDEN'; END IF;
   IF ev.status NOT IN ('DRAFT','APPROVED') THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
   next_status:='APPROVED';
  ELSIF action='PUBLISH' THEN
   IF identity=ver.maker_identity THEN RAISE EXCEPTION 'SELF_REVIEW_FORBIDDEN'; END IF;
   IF ev.status NOT IN ('APPROVED','PUBLISHED') THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
   IF ev.status='APPROVED' THEN
    PERFORM governance_catalog.contract_require_access(ev.actor_code,sc,ver.id,'REVIEW');
    next_status:='PUBLISHED';
   END IF;
  ELSIF action='RETIRE' THEN
   IF identity=ver.maker_identity THEN RAISE EXCEPTION 'SELF_REVIEW_FORBIDDEN'; END IF;
   PERFORM governance_catalog.contract_require_access(actor,sc,ver.id,'REVIEW');
   IF ev.status<>'PUBLISHED' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
   next_status:='RETIRED';
  END IF;
 END IF;
 IF action IN ('APPROVE','PUBLISH','RETIRE','VALIDATE') THEN
  impact_context:=governance_catalog.contract_change_impact(actor,sc,contract.id,CASE WHEN action='RETIRE' THEN 'RETIRE' ELSE 'PUBLISH' END)-'head';
  IF (input ? 'impactDigest' OR (action IN ('APPROVE','RETIRE') AND jsonb_array_length(impact_context->'closing')>0)) AND input->>'impactDigest' IS DISTINCT FROM impact_context->>'impactDigest' THEN RAISE EXCEPTION 'CONTRACT_IMPACT_REVIEW_MISMATCH'; END IF;
  IF action='PUBLISH' AND ev.status='APPROVED' AND ev.approval_context IS DISTINCT FROM impact_context THEN RAISE EXCEPTION 'CONTRACT_IMPACT_REVIEW_MISMATCH'; END IF;
 END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('definition',ver.definition,'schemas',ver.schemas,'semanticsDigest',ver.semantics_digest,'datasetVersionId',ver.dataset_version_id,'sourceSnapshotId',ver.source_snapshot_id,'validFrom',ver.valid_from,'validTo',ver.valid_to,'profile',contract.profile)::text,'UTF8')),'hex');
 IF (action IN ('APPROVE','PUBLISH','RETIRE') OR (action='VALIDATE' AND input ? 'reviewDigest')) AND input->>'reviewDigest' IS DISTINCT FROM digest THEN RAISE EXCEPTION 'REVIEW_DIGEST_MISMATCH'; END IF;
 IF next_status IS NOT NULL THEN
  INSERT INTO governance_catalog.import_contract_event(contract_id,version_id,status,actor_code,approval_context) VALUES(contract.id,ver.id,next_status,actor,impact_context) RETURNING * INTO ev;
 END IF;
 decision:=CASE WHEN blockers='[]'::jsonb THEN 'ACCEPT' ELSE 'REVIEW' END;
 result:=jsonb_build_object('id',contract.id,'versionId',ver.id,'version',ver.number,'datasetVersionId',ver.dataset_version_id,'head',ev.head::text,'status',ev.status,'reviewDigest',digest,'decision',decision,'blockers',blockers,'adapterReadiness','NOT_READY','recordedAt',to_char(ev.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(actor,req,requested_digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,actor);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,contract.id,'CONTRACT_'||action,input->>'reason',requested_digest);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.contract_definition(jsonb,uuid,text),governance_catalog.contract_command(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.contract_command(text,jsonb) TO hdi_prototype;
CREATE FUNCTION governance_catalog.contract_read(actor text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE cutoff timestamp; at_b timestamp; item record; result jsonb:='[]'; source_version uuid; source_object uuid;
 mode text:=input->>'mode'; sc text:=input->>'scope'; source_content jsonb; source_hash text;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 PERFORM vnext_control.authorize(actor,sc,'READ');
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('scope','mode','target','asOf','businessAt')) OR coalesce(mode,'') NOT IN ('CURRENT','HISTORY','EFFECTIVE') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 IF (mode='HISTORY' AND input->>'target' IS NULL) OR (mode='EFFECTIVE' AND input->>'businessAt' IS NULL) OR (mode<>'EFFECTIVE' AND input ? 'businessAt') THEN RAISE EXCEPTION 'INVALID_READ_MODE'; END IF;
 cutoff:=CASE WHEN input->>'asOf' IS NULL THEN timezone('Asia/Shanghai',clock_timestamp()) ELSE governance_catalog.contract_time(input->>'asOf') END;
 IF mode='EFFECTIVE' THEN at_b:=governance_catalog.contract_time(input->>'businessAt'); END IF;
 SELECT content,sha256 INTO source_content,source_hash FROM governance_catalog.source_snapshot WHERE source_key='P0_02_CONTRACT_DRAFTS';
 FOR item IN
  SELECT c.id,c.profile,o.code,e.head,e.status,e.recorded_at,v.id AS version_id,v.number,v.dataset_version_id,v.source_snapshot_id,v.schemas,v.semantics_digest,v.definition,v.valid_from,v.valid_to,d.object_id,d.payload
  FROM governance_catalog.import_contract c JOIN governance_catalog.object o ON o.id=c.dataset_id
  JOIN governance_catalog.import_contract_event e ON e.contract_id=c.id
  JOIN governance_catalog.import_contract_version v ON v.id=e.version_id
  JOIN governance_catalog.version d ON d.id=v.dataset_version_id
  WHERE o.scope=sc AND (input->>'target' IS NULL OR c.id=(input->>'target')::uuid) AND e.recorded_at<=cutoff
  AND (mode='HISTORY' OR e.head=(SELECT max(current_event.head) FROM governance_catalog.import_contract_event current_event WHERE current_event.contract_id=c.id AND current_event.recorded_at<=cutoff AND (mode='CURRENT' OR current_event.status IN ('PUBLISHED','RETIRED'))))
  ORDER BY o.code,c.profile,e.head
 LOOP
  SELECT content,sha256 INTO source_content,source_hash FROM governance_catalog.source_snapshot WHERE id=item.source_snapshot_id;
  IF NOT vnext_control.definition_allowed(actor,item.object_id,item.payload,'METADATA') THEN
   IF input->>'target' IS NOT NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
   CONTINUE;
  END IF;
  IF mode='EFFECTIVE' AND (item.status<>'PUBLISHED' OR NOT tsrange(item.valid_from,item.valid_to,'[)') @> at_b) THEN CONTINUE; END IF;
  PERFORM governance_catalog.contract_require_access(actor,sc,item.version_id,'READ');
  FOR source_version IN SELECT (item.definition->>'sourceVersionId')::uuid WHERE item.definition->>'sourceVersionId' IS NOT NULL UNION SELECT (value->>'sourceVersionId')::uuid FROM jsonb_array_elements(item.definition->'codeSets') WHERE value->>'sourceVersionId' IS NOT NULL LOOP
   SELECT object_id INTO source_object FROM governance_catalog.version WHERE id=source_version;
   PERFORM vnext_control.require_source_access(actor,sc,source_object,source_version);
  END LOOP;
  result:=result||jsonb_build_array(jsonb_build_object('id',item.id,'profile',item.profile,'dataset',item.code,'datasetVersionId',item.dataset_version_id,'versionId',item.version_id,'version',item.number,'head',item.head::text,'status',item.status,'definition',item.definition,
   'validFrom',to_char(item.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(item.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordedAt',to_char(item.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'adapterReadiness','NOT_READY',
   'schemas',item.schemas,'semanticsDigest',item.semantics_digest,
   'reviewDigest',encode(sha256(convert_to(jsonb_build_object('definition',item.definition,'schemas',item.schemas,'semanticsDigest',item.semantics_digest,'datasetVersionId',item.dataset_version_id,'sourceSnapshotId',item.source_snapshot_id,'validFrom',item.valid_from,'validTo',item.valid_to,'profile',item.profile)::text,'UTF8')),'hex'),
   'sourceDraftDigest',source_hash,'sourcePolicies',(SELECT value->'sourcePolicies' FROM jsonb_array_elements(source_content->'drafts') WHERE value->>'dataset'=item.code)));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.contract_read(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.contract_read(text,jsonb) TO hdi_prototype;
REVOKE ALL ON governance_catalog.import_contract,governance_catalog.import_contract_version,governance_catalog.import_contract_event FROM PUBLIC,hdi_prototype;
ALTER TABLE governance_catalog.import_contract ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_catalog.import_contract_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_catalog.import_contract_event ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON governance_catalog.import_contract,governance_catalog.import_contract_version,governance_catalog.import_contract_event TO hdi_prototype;
