-- Nursing owns independent handover confirmation. Existing facts and outcome ledgers are unchanged.
SELECT pg_advisory_xact_lock(901002);
CREATE TABLE care_organization.nursing_handover_confirmation(
 id uuid PRIMARY KEY DEFAULT uuidv7(),
 input_id uuid NOT NULL REFERENCES care_organization.ward_nursing_input(id),
 actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,
 binding jsonb NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 material_digest text NOT NULL CHECK(material_digest ~ '^[a-f0-9]{64}$'),material_fingerprint text NOT NULL CHECK(material_fingerprint ~ '^[a-f0-9]{64}$'),
 campus_id uuid NOT NULL REFERENCES organization_master.campus(id),ward_id uuid NOT NULL REFERENCES care_organization.ward_unit(id),
 source_nursing_id uuid NOT NULL REFERENCES care_organization.nursing_unit(id),successor_nursing_id uuid NOT NULL REFERENCES care_organization.nursing_unit(id),
 source_version_id uuid NOT NULL REFERENCES governance_catalog.version(id),scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 UNIQUE(identity_code,request_id),CHECK(source_nursing_id<>successor_nursing_id)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON care_organization.nursing_handover_confirmation FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
ALTER TABLE care_organization.nursing_handover_confirmation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON care_organization.nursing_handover_confirmation FROM PUBLIC,hdi_prototype;

CREATE FUNCTION care_organization.nursing_handover_binding(p_binding jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE result jsonb:=p_binding;h jsonb;coverage jsonb;members jsonb;identifier text;
BEGIN
 PERFORM care_organization.nursing_closed(result,ARRAY['inputId','inputDigest','row','handover']);
 IF jsonb_typeof(result->'row') IS DISTINCT FROM 'number' OR coalesce(result->>'row','') !~ '^[1-9][0-9]{0,2}$' OR (result->>'row')::integer>100 OR jsonb_typeof(result->'inputDigest') IS DISTINCT FROM 'string' OR coalesce(result->>'inputDigest','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 h:=result->'handover';PERFORM care_organization.nursing_closed(h,ARRAY['kind','source','successorSourceAlias','successorNursing','coverage','cutover','ruleReference','ruleVersion','evidenceId','confirmed']);
 PERFORM care_organization.nursing_closed(h->'source',ARRAY['owner','id','expectedHead']);PERFORM care_organization.nursing_closed(h->'successorNursing',ARRAY['owner','id']);
 IF h->>'kind' IS DISTINCT FROM 'CONFIRMED_HANDOVER' OR h->'confirmed' IS DISTINCT FROM 'true'::jsonb OR h->'source'->>'owner' IS DISTINCT FROM 'care-organization/ward-nursing-coverage' OR h->'successorNursing'->>'owner' IS DISTINCT FROM 'care-organization/nursing'
  OR jsonb_typeof(h->'source'->'expectedHead') IS DISTINCT FROM 'string' OR coalesce(h->'source'->>'expectedHead','') !~ '^[1-9][0-9]{0,18}$' OR jsonb_typeof(h->'successorSourceAlias') IS DISTINCT FROM 'string' OR length(btrim(coalesce(h->>'successorSourceAlias','')))<1 OR length(coalesce(h->>'successorSourceAlias',''))>64
  OR jsonb_typeof(h->'ruleReference') IS DISTINCT FROM 'string' OR jsonb_typeof(h->'ruleVersion') IS DISTINCT FROM 'string'
  OR length(btrim(coalesce(h->>'ruleReference',''))) NOT BETWEEN 1 AND 2000 OR length(btrim(coalesce(h->>'ruleVersion',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'HANDOVER_NOT_CONFIRMED';END IF;
 FOREACH identifier IN ARRAY ARRAY[result->>'inputId',h->'source'->>'id',h->'successorNursing'->>'id',h->>'evidenceId'] LOOP
  IF coalesce(identifier,'') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 END LOOP;
 IF jsonb_typeof(h->'cutover') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'LOCAL_TIME_REQUIRED';END IF;
 h:=jsonb_set(h,'{cutover}',to_jsonb(to_char(care_organization.ward_nursing_local_time(h->>'cutover'),'YYYY-MM-DD"T"HH24:MI:SS.US')));
 coverage:=h->'coverage';
 IF coverage->>'kind'='WHOLE_WARD' THEN PERFORM care_organization.nursing_closed(coverage,ARRAY['kind']);
 ELSIF coverage->>'kind'='PARTITIONS' THEN
  PERFORM care_organization.nursing_closed(coverage,ARRAY['kind','scopeSetId','version','partitionIds']);
  IF jsonb_typeof(coverage->'version') IS DISTINCT FROM 'string' OR coalesce(coverage->>'version','') !~ '^[1-9][0-9]{0,18}$' OR coalesce(coverage->>'scopeSetId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR jsonb_typeof(coverage->'partitionIds') IS DISTINCT FROM 'array' OR jsonb_array_length(coverage->'partitionIds') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'UNKNOWN_COVERAGE_SCOPE';END IF;
  FOR identifier IN SELECT value FROM jsonb_array_elements_text(coverage->'partitionIds') LOOP IF coalesce(identifier,'') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'UNKNOWN_COVERAGE_SCOPE';END IF;END LOOP;
  SELECT jsonb_agg(id ORDER BY id) INTO members FROM jsonb_array_elements_text(coverage->'partitionIds') m(id);
  IF (SELECT count(DISTINCT id) FROM jsonb_array_elements_text(members) m(id))<>jsonb_array_length(members) THEN RAISE EXCEPTION 'UNKNOWN_COVERAGE_SCOPE';END IF;
  coverage:=jsonb_set(coverage,'{partitionIds}',members);
 ELSE RAISE EXCEPTION 'UNKNOWN_COVERAGE_SCOPE';END IF;
 h:=jsonb_set(h,'{coverage}',coverage);RETURN jsonb_set(result,'{handover}',h);
END $$;

-- Actorless normalization and this context reader are private to the signed/read guards.
CREATE FUNCTION care_organization.nursing_handover_context(p_actor text,p_binding jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb:=care_organization.nursing_handover_binding(p_binding);h jsonb:=b->'handover';r care_organization.ward_nursing_input;j jsonb;source care_organization.ward_nursing;head care_organization.ward_nursing_version;declaration care_organization.ward_nursing_version;terminal_at timestamp;proof jsonb;successor uuid:=(h->'successorNursing'->>'id')::uuid;cutover timestamp:=care_organization.ward_nursing_local_time(h->>'cutover');source_version uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 r:=jsonb_populate_record(NULL::care_organization.ward_nursing_input,care_organization.ward_nursing_input_read(p_actor,(b->>'inputId')::uuid,'READ_RESTRICTED'));
 IF r.digest IS DISTINCT FROM b->>'inputDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 IF EXISTS(SELECT 1 FROM care_organization.ward_nursing_withdrawal WHERE input_id=r.id) THEN RAISE EXCEPTION 'INPUT_WITHDRAWN';END IF;
 j:=care_organization.ward_nursing_job_read(p_actor,r.id);
 IF r.job_revision IS DISTINCT FROM (j->>'currentRevisionId')::uuid OR j->'contract'->>'dataset' IS DISTINCT FROM 'ORG11' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 PERFORM care_organization.ward_nursing_snapshot(p_actor,(h->'source'->>'id')::uuid);
 SELECT * INTO source FROM care_organization.ward_nursing WHERE id=(h->'source'->>'id')::uuid;
 SELECT * INTO head FROM care_organization.ward_nursing_version WHERE ward_nursing_id=source.id ORDER BY number DESC LIMIT 1;
 SELECT * INTO declaration FROM care_organization.ward_nursing_version WHERE ward_nursing_id=source.id AND action IN ('CREATE','REVISE') ORDER BY number DESC LIMIT 1;
 IF head.id IS NULL OR declaration.id IS NULL OR head.number::text IS DISTINCT FROM h->'source'->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
 SELECT min(valid_from) INTO terminal_at FROM care_organization.ward_nursing_version WHERE ward_nursing_id=source.id AND action='END';
 IF source.scope IS DISTINCT FROM r.scope OR source.nursing_unit_id=successor OR cutover<declaration.valid_from OR cutover>coalesce(declaration.valid_to,'infinity'::timestamp) OR cutover>coalesce(terminal_at,'infinity'::timestamp)
  OR NOT care_organization.ward_nursing_scope_contains(declaration.facts->'coverageScope',h->'coverage') OR NOT care_organization.ward_nursing_scope_contains(h->'coverage',declaration.facts->'coverageScope') THEN RAISE EXCEPTION 'HANDOVER_NOT_CONFIRMED';END IF;
 PERFORM care_organization.nursing_snapshot(p_actor,source.nursing_unit_id);PERFORM care_organization.nursing_snapshot(p_actor,successor);
 IF NOT EXISTS(SELECT 1 FROM care_organization.nursing_unit_binding WHERE unit_id=successor AND campus_id=source.campus_id) THEN RAISE EXCEPTION 'NURSING_ANCHOR_MISMATCH';END IF;
 source_version:=(j->'contract'->'definition'->>'sourceVersionId')::uuid;IF source_version IS NULL THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 proof:=governance_catalog.registration_evidence(p_actor,(h->>'evidenceId')::uuid,source_version,r.scope);
 RETURN jsonb_build_object('binding',b,'makerIdentity',r.identity_code,'campusId',source.campus_id,'wardId',source.ward_id,'sourceNursingId',source.nursing_unit_id,'successorNursingId',successor,'sourceVersionId',source_version,'scope',r.scope,'materialFingerprint',encode(sha256(convert_to(proof::text,'UTF8')),'hex'));
END $$;

CREATE FUNCTION care_organization.nursing_handover_confirm(p_ticket text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;k bytea;ip bytea:=decode(repeat('36',64),'hex');op bytea:=decode(repeat('5c',64),'hex');i integer;context jsonb;identity text;existing care_organization.nursing_handover_confirmation;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);SELECT decode(key_hex,'hex') INTO k FROM vnext_control.nursing_write_authority WHERE singleton;
 IF k IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ip:=set_byte(ip,i,get_byte(ip,i)#get_byte(k,i));op:=set_byte(op,i,get_byte(op,i)#get_byte(k,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(op||sha256(ip||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM care_organization.nursing_closed(t,ARRAY['operation','actor','transaction','requestId','binding','reason','digest','materialDigest']);
 IF t->>'operation' IS DISTINCT FROM 'CONFIRM_COVERAGE_HANDOVER' OR jsonb_typeof(t->'digest') IS DISTINCT FROM 'string' OR coalesce(t->>'digest','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(t->'materialDigest') IS DISTINCT FROM 'string' OR coalesce(t->>'materialDigest','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(t->'reason') IS DISTINCT FROM 'string' OR length(btrim(coalesce(t->>'reason',''))) NOT BETWEEN 1 AND 2000 OR coalesce(t->>'requestId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 context:=care_organization.nursing_handover_context(t->>'actor',t->'binding');
 identity:=care_organization.nursing_authorize(t->>'actor',(context->>'campusId')::uuid,'REVIEW');
 IF identity=context->>'makerIdentity' THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
 SELECT * INTO existing FROM care_organization.nursing_handover_confirmation WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
 IF FOUND THEN
  IF existing.binding IS DISTINCT FROM context->'binding' OR existing.digest IS DISTINCT FROM t->>'digest' OR existing.material_digest IS DISTINCT FROM t->>'materialDigest' OR existing.reason IS DISTINCT FROM t->>'reason' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
 ELSE
  INSERT INTO care_organization.nursing_handover_confirmation(input_id,actor,identity_code,request_id,binding,digest,material_digest,material_fingerprint,campus_id,ward_id,source_nursing_id,successor_nursing_id,source_version_id,scope,reason)
   VALUES((context->'binding'->>'inputId')::uuid,t->>'actor',identity,(t->>'requestId')::uuid,context->'binding',t->>'digest',t->>'materialDigest',context->>'materialFingerprint',(context->>'campusId')::uuid,(context->>'wardId')::uuid,(context->>'sourceNursingId')::uuid,(context->>'successorNursingId')::uuid,(context->>'sourceVersionId')::uuid,context->>'scope',t->>'reason') RETURNING * INTO existing;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(t->>'actor',existing.id,'NURSING_HANDOVER_CONFIRM','INDEPENDENT_NURSING_OWNER',existing.digest);
 END IF;
 RETURN jsonb_build_object('confirmationId',existing.id,'digest',existing.digest,'recordedAt',to_char(existing.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
END $$;

CREATE FUNCTION care_organization.nursing_handover_confirmation_read(p_actor text,p_id uuid,p_digest text,p_binding jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE confirmation care_organization.nursing_handover_confirmation;context jsonb;reviewer_context jsonb;identity text;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 SELECT * INTO confirmation FROM care_organization.nursing_handover_confirmation WHERE id=p_id;
 IF NOT FOUND OR confirmation.digest IS DISTINCT FROM p_digest OR confirmation.binding IS DISTINCT FROM care_organization.nursing_handover_binding(p_binding) THEN RAISE EXCEPTION 'NURSING_HANDOVER_CONFIRMATION_REQUIRED';END IF;
 context:=care_organization.nursing_handover_context(p_actor,confirmation.binding);
 identity:=care_organization.nursing_authorize(confirmation.actor,confirmation.campus_id,'REVIEW');
 IF identity IS DISTINCT FROM confirmation.identity_code OR identity=context->>'makerIdentity' THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
 reviewer_context:=care_organization.nursing_handover_context(confirmation.actor,confirmation.binding);
 IF context IS DISTINCT FROM reviewer_context OR confirmation.material_fingerprint IS DISTINCT FROM context->>'materialFingerprint'
  OR confirmation.campus_id::text IS DISTINCT FROM context->>'campusId' OR confirmation.ward_id::text IS DISTINCT FROM context->>'wardId'
  OR confirmation.source_nursing_id::text IS DISTINCT FROM context->>'sourceNursingId' OR confirmation.successor_nursing_id::text IS DISTINCT FROM context->>'successorNursingId'
  OR confirmation.source_version_id::text IS DISTINCT FROM context->>'sourceVersionId' OR confirmation.scope IS DISTINCT FROM context->>'scope' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 RETURN jsonb_build_object('confirmationId',confirmation.id,'digest',confirmation.digest,'recordedAt',to_char(confirmation.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'materialDigest',confirmation.material_digest,'sourceVersionId',confirmation.source_version_id,'campus',confirmation.scope,'evidenceId',confirmation.binding->'handover'->>'evidenceId');
END $$;

ALTER FUNCTION care_organization.ward_nursing_mutate(text,text) RENAME TO ward_nursing_mutate_0199;
REVOKE ALL ON FUNCTION care_organization.ward_nursing_mutate_0199(text,text) FROM PUBLIC,hdi_prototype;
DO $$ DECLARE r record;BEGIN
 FOR r IN SELECT rolname FROM pg_roles WHERE rolname ~ '^hdi_(owner|validation)_[a-f0-9]{16}$' LOOP EXECUTE format('REVOKE ALL ON FUNCTION care_organization.ward_nursing_mutate_0199(text,text) FROM %I',r.rolname);END LOOP;
END $$;
CREATE FUNCTION care_organization.ward_nursing_mutate(p_ticket text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;k bytea;ip bytea:=decode(repeat('36',64),'hex');op bytea:=decode(repeat('5c',64),'hex');i integer;r care_organization.ward_nursing_input;w jsonb;confirmation_row jsonb;h jsonb;proof jsonb;expected jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);SELECT decode(key_hex,'hex') INTO k FROM vnext_control.ward_nursing_write_authority WHERE singleton;
 IF k IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ip:=set_byte(ip,i,get_byte(ip,i)#get_byte(k,i));op:=set_byte(op,i,get_byte(op,i)#get_byte(k,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(op||sha256(ip||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF t->>'operation'='APPLY' THEN
  PERFORM care_organization.ward_nursing_closed(t,ARRAY['operation','actor','transaction','inputId','writes','writeIndex','writesDigest','candidateId','digest','recordAt','recordAtProof']);
  -- The base guard still authorizes every committed replay and every subsequent result slot.
  IF NOT EXISTS(SELECT 1 FROM care_organization.ward_nursing_change WHERE input_id=(t->>'inputId')::uuid) THEN
   IF jsonb_typeof(t->'writes') IS DISTINCT FROM 'array' OR (t->>'writeIndex')::integer<>1 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;
   r:=jsonb_populate_record(NULL::care_organization.ward_nursing_input,care_organization.ward_nursing_input_read(t->>'actor',(t->>'inputId')::uuid,'WRITE'));
   FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP
    IF w->>'action'='CREATE' AND w->'facts'->'handover'->>'kind'='CONFIRMED_HANDOVER' THEN
     h:=w->'facts'->'handover';proof:=h->'nursingConfirmation';
     IF proof IS NULL THEN RAISE EXCEPTION 'NURSING_HANDOVER_CONFIRMATION_REQUIRED';END IF;
     PERFORM care_organization.nursing_closed(proof,ARRAY['id','digest']);
     -- Nursing authenticated the original input row. Sorted writes and file source rows are different coordinates.
     SELECT binding->'row' INTO confirmation_row FROM care_organization.nursing_handover_confirmation WHERE id=(proof->>'id')::uuid;
     IF confirmation_row IS NULL THEN RAISE EXCEPTION 'NURSING_HANDOVER_CONFIRMATION_REQUIRED';END IF;
     expected:=jsonb_build_object('inputId',r.id,'inputDigest',r.digest,'row',confirmation_row,'handover',h-'nursingConfirmation');
     PERFORM care_organization.nursing_handover_confirmation_read(t->>'actor',(proof->>'id')::uuid,proof->>'digest',expected);
    END IF;
   END LOOP;
  END IF;
 END IF;
 RETURN care_organization.ward_nursing_mutate_0199(p_ticket,p_signature);
END $$;
REVOKE ALL ON FUNCTION care_organization.nursing_handover_binding(jsonb),care_organization.nursing_handover_context(text,jsonb),care_organization.nursing_handover_confirm(text,text),care_organization.nursing_handover_confirmation_read(text,uuid,text,jsonb),care_organization.ward_nursing_mutate(text,text) FROM PUBLIC,hdi_prototype;
