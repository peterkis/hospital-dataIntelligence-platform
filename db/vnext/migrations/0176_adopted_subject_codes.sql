SELECT pg_advisory_xact_lock(901002);
CREATE TABLE vnext_control.subject_write_authority(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),key_hex text NOT NULL CHECK(key_hex ~ '^[a-f0-9]{64}$'));
CREATE TABLE governance_catalog.subject_code_access(actor text NOT NULL REFERENCES vnext_control.actor(code),permission text NOT NULL CHECK(permission IN ('READ','WRITE','VERIFY','REVIEW')),PRIMARY KEY(actor,permission));
CREATE TABLE governance_catalog.subject_code_system(id uuid PRIMARY KEY DEFAULT uuidv7(),system_code text NOT NULL UNIQUE,source_system_id uuid NOT NULL REFERENCES governance_catalog.object(id),source_alias text NOT NULL,namespace_uri text NOT NULL,UNIQUE(source_system_id,source_alias));
CREATE TABLE governance_catalog.subject_code_version(id uuid PRIMARY KEY DEFAULT uuidv7(),system_id uuid NOT NULL REFERENCES governance_catalog.subject_code_system(id),number bigint NOT NULL CHECK(number>0),metadata jsonb NOT NULL,reason text NOT NULL,maker_identity text NOT NULL,review_digest text NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(system_id,number));
CREATE TABLE governance_catalog.subject_code_outcome(identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(identity_code,request_id));
CREATE TABLE governance_catalog.subject_code_verification(id uuid PRIMARY KEY DEFAULT uuidv7(),version_id uuid NOT NULL REFERENCES governance_catalog.subject_code_version(id),actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,evidence_id uuid NOT NULL REFERENCES governance_catalog.protected_artifact(id),source_reviewed boolean NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()));
CREATE TABLE governance_catalog.subject_code_approval(version_id uuid PRIMARY KEY REFERENCES governance_catalog.subject_code_version(id),verification_id uuid NOT NULL REFERENCES governance_catalog.subject_code_verification(id),actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()));
CREATE FUNCTION governance_catalog.subject_attest(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;k bytea;ip bytea:=decode(repeat('36',64),'hex');op bytea:=decode(repeat('5c',64),'hex');i integer;BEGIN
 SELECT decode(key_hex,'hex') INTO k FROM vnext_control.subject_write_authority;
 IF k IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ip:=set_byte(ip,i,get_byte(ip,i)#get_byte(k,i));op:=set_byte(op,i,get_byte(op,i)#get_byte(k,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(op||sha256(ip||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;RETURN t;
END $$;
CREATE FUNCTION governance_catalog.subject_code_authorize(p_actor text,p_permission text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF p_permission NOT IN ('READ','WRITE','VERIFY','REVIEW') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC',CASE WHEN p_permission IN ('VERIFY','REVIEW') THEN 'REVIEW' ELSE p_permission END);
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.subject_code_access WHERE actor=p_actor AND permission=p_permission) OR (p_permission<>'READ' AND NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=p_actor AND active AND principal_kind='HUMAN')) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;RETURN identity;
END $$;
CREATE FUNCTION governance_catalog.subject_code_read(p_actor text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;r timestamp;entry jsonb;BEGIN
 PERFORM governance_catalog.subject_code_authorize(p_actor,'READ');
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR NOT p_input ? 'id' OR p_input-ARRAY['id','versionId','recordAsOf','history']<>'{}'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 r:=CASE WHEN p_input ? 'recordAsOf' THEN governance_catalog.contract_time(p_input->>'recordAsOf') ELSE timezone('Asia/Shanghai',clock_timestamp()) END;
 SELECT coalesce(jsonb_agg(item ORDER BY number),'[]') INTO result FROM (SELECT v.number,
 v.metadata||jsonb_build_object('id',s.id,'versionId',v.id,'head',v.number::text,'systemCode',s.system_code,'status',CASE WHEN a.version_id IS NOT NULL THEN 'APPROVED' WHEN q.id IS NOT NULL THEN 'REVIEW' ELSE 'DRAFT' END,'reviewDigest',v.review_digest,'recordedAt',to_char(v.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'approvedAt',to_char(a.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'sourceVerification',CASE WHEN q.id IS NULL THEN NULL ELSE jsonb_build_object('id',q.id,'actor',q.actor,'evidenceId',q.evidence_id,'sourceReviewed',q.source_reviewed,'recordedAt',to_char(q.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')) END) item
 FROM governance_catalog.subject_code_version v JOIN governance_catalog.subject_code_system s ON s.id=v.system_id
 LEFT JOIN governance_catalog.subject_code_approval a ON a.version_id=v.id AND a.recorded_at<=r
 LEFT JOIN LATERAL(SELECT q.* FROM governance_catalog.subject_code_verification q WHERE q.version_id=v.id AND q.recorded_at<=r AND (a.version_id IS NULL OR q.id=a.verification_id) ORDER BY q.recorded_at DESC,q.id DESC LIMIT 1) q ON true
 WHERE s.id=(p_input->>'id')::uuid AND v.recorded_at<=r AND (NOT p_input ? 'versionId' OR v.id=(p_input->>'versionId')::uuid)
 ORDER BY v.number DESC LIMIT CASE WHEN coalesce((p_input->>'history')::boolean,false) THEN 100000 ELSE 1 END) items;
 FOR entry IN SELECT value FROM jsonb_array_elements(result) LOOP PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',(entry->>'sourceId')::uuid,(entry->>'sourceVersionId')::uuid);END LOOP;RETURN result;
END $$;
CREATE FUNCTION governance_catalog.subject_code_command(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb;c jsonb;identity text;d text;prior governance_catalog.subject_code_outcome;s uuid;v uuid;result jsonb;from_b timestamp;to_b timestamp;version governance_catalog.subject_code_version;q governance_catalog.subject_code_verification;next_number bigint;keys text[];BEGIN
 PERFORM pg_advisory_xact_lock(901002);t:=governance_catalog.subject_attest(p_ticket,p_signature);
 IF t->>'operation' IS DISTINCT FROM 'CODE_COMMAND' OR t-ARRAY['actor','transaction','operation','command','materialDigest']<>'{}'::jsonb OR t->>'materialDigest' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 c:=t->'command';
 IF c->>'action' NOT IN ('CREATE','REVISE','VERIFY','APPROVE') OR coalesce(c->>'reason','') !~ '\S' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 identity:=governance_catalog.subject_code_authorize(t->>'actor',CASE c->>'action' WHEN 'APPROVE' THEN 'REVIEW' WHEN 'VERIFY' THEN 'VERIFY' ELSE 'WRITE' END);
 d:=encode(sha256(convert_to(c::text,'UTF8')),'hex');SELECT * INTO prior FROM governance_catalog.subject_code_outcome WHERE identity_code=identity AND request_id=(c->>'requestId')::uuid;
 IF FOUND THEN IF prior.digest<>d THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;PERFORM vnext_control.require_source_access(t->>'actor','SYNTHETIC',(prior.result->>'sourceId')::uuid,(prior.result->>'sourceVersionId')::uuid);RETURN prior.result;END IF;
 IF c->>'action' IN ('CREATE','REVISE') THEN
  keys:=ARRAY['action','requestId','reason','sourceId','sourceVersionId','evidenceId','sourcePage','sourceSummary','adoptedOn','label','validFrom','validTo','codes','reference','codeSystemName','namespaceUri','standardDocument','issuer','codeSystemVersion']||CASE WHEN c->>'action'='CREATE' THEN ARRAY['systemCode'] ELSE ARRAY['target','expectedHead'] END;
  IF NOT c ?& keys OR c-keys<>'{}'::jsonb OR c->>'label' IS DISTINCT FROM 'TEST_POLICY_ONLY' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF c->'reference'->>'owner' IS DISTINCT FROM 'governance-catalog/subject-code' OR c->'reference'->>'dataset' IS DISTINCT FROM 'REF01' OR c->'reference'->>'namespace' IS DISTINCT FROM 'REF01.code_system_id' OR (c->'reference')-ARRAY['owner','dataset','namespace','sourceAlias']<>'{}'::jsonb OR coalesce(c->'reference'->>'sourceAlias','') !~ '\S' OR coalesce(c->>'codeSystemVersion','') !~ '\S' THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
  from_b:=governance_catalog.contract_time(c->>'validFrom');to_b:=CASE WHEN c->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(c->>'validTo') END;
  IF to_b<=from_b THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
  PERFORM vnext_control.require_source_access(t->>'actor','SYNTHETIC',(c->>'sourceId')::uuid,(c->>'sourceVersionId')::uuid);
  PERFORM governance_catalog.registration_evidence_access(t->>'actor',(c->>'evidenceId')::uuid,(c->>'sourceVersionId')::uuid,'NORTH');
  IF NOT governance_catalog.source_valid_spans((c->>'sourceVersionId')::uuid,timezone('Asia/Shanghai',clock_timestamp())) @> tsrange(from_b,to_b,'[)') THEN RAISE EXCEPTION 'SOURCE_NOT_READY';END IF;
  IF jsonb_typeof(c->'codes') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'codes') NOT BETWEEN 1 AND 1000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(c->'codes') x GROUP BY x->>'code' HAVING count(*)>1) THEN RAISE EXCEPTION 'SUBJECT_CODE_CONFLICT';END IF;
  IF c->>'action'='CREATE' THEN
   IF EXISTS(SELECT 1 FROM governance_catalog.subject_code_system WHERE system_code=c->>'systemCode') THEN RAISE EXCEPTION 'SUBJECT_CODE_CONFLICT';END IF;
   INSERT INTO governance_catalog.subject_code_system(system_code,source_system_id,source_alias,namespace_uri) VALUES(c->>'systemCode',(c->>'sourceId')::uuid,c->'reference'->>'sourceAlias',c->>'namespaceUri') RETURNING id INTO s;next_number:=1;
  ELSE
   SELECT * INTO version FROM governance_catalog.subject_code_version WHERE system_id=(c->>'target')::uuid ORDER BY number DESC LIMIT 1;
   IF NOT FOUND OR version.number::text IS DISTINCT FROM c->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;s:=version.system_id;IF NOT EXISTS(SELECT 1 FROM governance_catalog.subject_code_system x WHERE x.id=s AND x.source_system_id=(c->>'sourceId')::uuid AND x.source_alias=c->'reference'->>'sourceAlias' AND x.namespace_uri=c->>'namespaceUri') THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;next_number:=version.number+1;
  END IF;
  INSERT INTO governance_catalog.subject_code_version(system_id,number,metadata,reason,maker_identity,review_digest) VALUES(s,next_number,c-ARRAY['action','requestId','reason','systemCode','target','expectedHead'],c->>'reason',identity,encode(sha256(convert_to((c-ARRAY['action','requestId','reason'])::text,'UTF8')),'hex')) RETURNING id INTO v;
 ELSE
  SELECT * INTO version FROM governance_catalog.subject_code_version WHERE id=(c->>'versionId')::uuid AND system_id=(c->>'target')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  IF version.review_digest IS DISTINCT FROM c->>'reviewDigest' OR version.number<>(SELECT max(number) FROM governance_catalog.subject_code_version WHERE system_id=version.system_id) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  IF identity=version.maker_identity THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
  PERFORM vnext_control.require_source_access(t->>'actor','SYNTHETIC',(version.metadata->>'sourceId')::uuid,(version.metadata->>'sourceVersionId')::uuid);
  PERFORM governance_catalog.registration_evidence_access(t->>'actor',(version.metadata->>'evidenceId')::uuid,(version.metadata->>'sourceVersionId')::uuid,'NORTH');
  IF EXISTS(SELECT 1 FROM governance_catalog.subject_code_approval WHERE version_id=version.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
  s:=version.system_id;v:=version.id;
  IF c->>'action'='VERIFY' THEN
   IF c-ARRAY['action','requestId','reason','target','versionId','reviewDigest','evidenceId','sourceReviewed']<>'{}'::jsonb OR jsonb_typeof(c->'sourceReviewed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
   PERFORM governance_catalog.registration_evidence_access(t->>'actor',(c->>'evidenceId')::uuid,(version.metadata->>'sourceVersionId')::uuid,'NORTH');
   INSERT INTO governance_catalog.subject_code_verification(version_id,actor,identity_code,evidence_id,source_reviewed) VALUES(version.id,t->>'actor',identity,(c->>'evidenceId')::uuid,(c->>'sourceReviewed')::boolean);
  ELSE
   IF c-ARRAY['action','requestId','reason','target','versionId','reviewDigest']<>'{}'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
   SELECT * INTO q FROM governance_catalog.subject_code_verification WHERE version_id=version.id ORDER BY recorded_at DESC,id DESC LIMIT 1;
   IF NOT FOUND OR NOT q.source_reviewed THEN RAISE EXCEPTION 'LEGAL_REVIEW_REQUIRED';END IF;
   IF governance_catalog.subject_code_authorize(q.actor,'VERIFY') IS DISTINCT FROM q.identity_code OR q.identity_code=version.maker_identity THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
   PERFORM governance_catalog.registration_evidence_access(t->>'actor',q.evidence_id,(version.metadata->>'sourceVersionId')::uuid,'NORTH');
   from_b:=governance_catalog.contract_time(version.metadata->>'validFrom');to_b:=CASE WHEN version.metadata->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(version.metadata->>'validTo') END;
   IF NOT governance_catalog.source_valid_spans((version.metadata->>'sourceVersionId')::uuid,timezone('Asia/Shanghai',clock_timestamp())) @> tsrange(from_b,to_b,'[)') THEN RAISE EXCEPTION 'SOURCE_NOT_READY';END IF;
   INSERT INTO governance_catalog.subject_code_approval VALUES(version.id,q.id,t->>'actor',identity,timezone('Asia/Shanghai',clock_timestamp()));
   IF to_regprocedure('care_organization.subject_reassess_code(text,uuid,uuid)') IS NOT NULL THEN PERFORM care_organization.subject_reassess_code(t->>'actor',version.system_id,version.id);END IF;
  END IF;
 END IF;
 result:=governance_catalog.subject_code_read(t->>'actor',jsonb_build_object('id',s,'versionId',v))->0;
 INSERT INTO governance_catalog.subject_code_outcome VALUES(identity,(c->>'requestId')::uuid,d,result);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(t->>'actor',s,'SUBJECT_CODE_'||(c->>'action'),'SUBJECT_SOURCE_GOVERNANCE',d);RETURN result;
END $$;
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['subject_code_system','subject_code_version','subject_code_outcome','subject_code_verification','subject_code_approval'] LOOP
 EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON governance_catalog.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',tab);
 EXECUTE format('ALTER TABLE governance_catalog.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('REVOKE ALL ON governance_catalog.%I FROM PUBLIC,hdi_prototype',tab);EXECUTE format('GRANT SELECT ON governance_catalog.%I TO hdi_prototype',tab);END LOOP;
END $$;
REVOKE ALL ON governance_catalog.subject_code_access,vnext_control.subject_write_authority FROM PUBLIC,hdi_prototype;
GRANT SELECT ON governance_catalog.subject_code_access,vnext_control.subject_write_authority TO hdi_prototype;
ALTER TABLE governance_catalog.subject_code_access ENABLE ROW LEVEL SECURITY;ALTER TABLE vnext_control.subject_write_authority ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON FUNCTION governance_catalog.subject_attest(text,text),governance_catalog.subject_code_authorize(text,text),governance_catalog.subject_code_command(text,text),governance_catalog.subject_code_read(text,jsonb) FROM PUBLIC,hdi_prototype;
CREATE FUNCTION governance_catalog.subject_code_coverage(p_actor text,p_pin jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item jsonb;code jsonb;current_version governance_catalog.subject_code_version;current_code jsonb;part record;semantic text;BEGIN
 item:=governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',p_pin->>'systemId','versionId',p_pin->>'versionId','recordAsOf',to_char(p_r,'YYYY-MM-DD"T"HH24:MI:SS.US')))->0;
 IF p_pin->>'owner' IS DISTINCT FROM 'governance-catalog/subject-code' OR item IS NULL OR item->>'head' IS DISTINCT FROM p_pin->>'version' THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 SELECT value INTO code FROM jsonb_array_elements(item->'codes') WHERE value->>'code'=p_pin->>'code';
 IF code IS NULL OR item->>'status' IS DISTINCT FROM 'APPROVED' OR code->>'status' IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'SUBJECT_CODE_REVIEW_REQUIRED';END IF;
 IF NOT tsrange(governance_catalog.contract_time(item->>'validFrom'),CASE WHEN item->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(item->>'validTo') END,'[)') @> tsrange(p_from,p_to,'[)') OR NOT governance_catalog.source_valid_spans((item->>'sourceVersionId')::uuid,p_r) @> tsrange(p_from,p_to,'[)') THEN RAISE EXCEPTION 'SUBJECT_CODE_PERIOD_NOT_COVERED';END IF;
 semantic:=encode(sha256(convert_to((code-ARRAY['name','replacement'])::text,'UTF8')),'hex');
 FOR part IN
  WITH known AS(SELECT v.* FROM governance_catalog.subject_code_version v JOIN governance_catalog.subject_code_approval a ON a.version_id=v.id WHERE v.system_id=(p_pin->>'systemId')::uuid AND v.recorded_at<=p_r AND a.recorded_at<=p_r),
  points AS(SELECT p_from b UNION SELECT p_to WHERE p_to IS NOT NULL UNION SELECT governance_catalog.contract_time(metadata->>'validFrom') FROM known WHERE governance_catalog.contract_time(metadata->>'validFrom')>p_from AND (p_to IS NULL OR governance_catalog.contract_time(metadata->>'validFrom')<p_to) UNION SELECT governance_catalog.contract_time(metadata->>'validTo') FROM known WHERE metadata->>'validTo' IS NOT NULL AND governance_catalog.contract_time(metadata->>'validTo')>p_from AND (p_to IS NULL OR governance_catalog.contract_time(metadata->>'validTo')<p_to)),
  pieces AS(SELECT b,lead(b) OVER(ORDER BY b) e FROM points) SELECT b,e FROM pieces WHERE p_to IS NULL OR b<p_to
 LOOP
  SELECT v.* INTO current_version FROM governance_catalog.subject_code_version v JOIN governance_catalog.subject_code_approval a ON a.version_id=v.id WHERE v.system_id=(p_pin->>'systemId')::uuid AND v.recorded_at<=p_r AND a.recorded_at<=p_r AND governance_catalog.contract_time(v.metadata->>'validFrom')<=part.b ORDER BY governance_catalog.contract_time(v.metadata->>'validFrom') DESC,v.number DESC LIMIT 1;
  IF current_version.id IS NULL OR (current_version.metadata->>'validTo' IS NOT NULL AND governance_catalog.contract_time(current_version.metadata->>'validTo')<=part.b) THEN RAISE EXCEPTION 'SUBJECT_CODE_PERIOD_NOT_COVERED';END IF;
  SELECT value INTO current_code FROM jsonb_array_elements(current_version.metadata->'codes') WHERE value->>'code'=p_pin->>'code';
  IF current_code IS NULL OR current_code->>'status' IS DISTINCT FROM 'ACTIVE' OR encode(sha256(convert_to((current_code-ARRAY['name','replacement'])::text,'UTF8')),'hex')<>semantic THEN RAISE EXCEPTION 'SUBJECT_CODE_REVIEW_REQUIRED';END IF;
  PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',(current_version.metadata->>'sourceId')::uuid,(current_version.metadata->>'sourceVersionId')::uuid);
  IF NOT governance_catalog.source_valid_spans((current_version.metadata->>'sourceVersionId')::uuid,p_r) @> tsrange(part.b,part.e,'[)') THEN RAISE EXCEPTION 'SUBJECT_CODE_PERIOD_NOT_COVERED';END IF;
 END LOOP;
 RETURN jsonb_build_object('adoption',p_pin,'semanticDigest',encode(sha256(convert_to((code-ARRAY['name','replacement'])::text,'UTF8')),'hex'),'sourceVersionId',item->>'sourceVersionId');
END $$;
REVOKE ALL ON FUNCTION governance_catalog.subject_code_coverage(text,jsonb,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;

CREATE TRIGGER subject_key_immutable BEFORE UPDATE OR DELETE ON vnext_control.subject_write_authority FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE FUNCTION governance_catalog.subject_audit_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(coalesce(NEW.actor,OLD.actor),'00000000-0000-0000-0000-000000000176'::uuid,'SUBJECT_CODE_AUTHORIZATION',TG_OP,encode(sha256(convert_to(coalesce(to_jsonb(NEW),to_jsonb(OLD))::text,'UTF8')),'hex'));RETURN coalesce(NEW,OLD);END $$;
CREATE TRIGGER subject_code_access_lock BEFORE INSERT OR UPDATE OR DELETE ON governance_catalog.subject_code_access FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER subject_code_access_audit AFTER INSERT OR UPDATE OR DELETE ON governance_catalog.subject_code_access FOR EACH ROW EXECUTE FUNCTION governance_catalog.subject_audit_access();
REVOKE ALL ON FUNCTION governance_catalog.subject_audit_access() FROM PUBLIC,hdi_prototype;
