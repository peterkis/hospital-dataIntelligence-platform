SELECT pg_advisory_xact_lock(901002);
CREATE TABLE care_organization.lifecycle_input(id uuid PRIMARY KEY DEFAULT uuidv7(),revision uuid NOT NULL DEFAULT uuidv7(),maker text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),envelope jsonb NOT NULL,members jsonb NOT NULL,observation_digest text NOT NULL CHECK(observation_digest ~ '^[a-f0-9]{64}$'),recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id));
CREATE TABLE care_organization.lifecycle_verification(id uuid PRIMARY KEY DEFAULT uuidv7(),input_id uuid NOT NULL REFERENCES care_organization.lifecycle_input(id),actor text NOT NULL REFERENCES vnext_control.actor(code),identity_code text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL,observation_digest text NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(identity_code,request_id),UNIQUE(input_id));
CREATE TABLE care_organization.lifecycle_member(candidate_id uuid NOT NULL REFERENCES governance_catalog.apply_candidate(id),input_id uuid NOT NULL REFERENCES care_organization.lifecycle_input(id),owner text NOT NULL CHECK(owner IN ('UNIT','NURSING','WARD','UNIT_WARD','WARD_NURSING','CAPABILITY','PERMISSION','LOCATION','LOCATION_USE')),member_id uuid NOT NULL,revision uuid NOT NULL,digest text NOT NULL,identity_code text NOT NULL,contract_version_id uuid NOT NULL,PRIMARY KEY(candidate_id,owner,member_id));
DO $$ DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['lifecycle_input','lifecycle_verification','lifecycle_member'] LOOP EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON care_organization.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',tab);EXECUTE format('ALTER TABLE care_organization.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('REVOKE ALL ON care_organization.%I FROM PUBLIC,hdi_prototype',tab);END LOOP;END $$;
CREATE FUNCTION care_organization.lifecycle_attest(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;k bytea;ip bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;BEGIN
 SELECT decode(key_hex,'hex') INTO k FROM vnext_control.unit_write_authority WHERE singleton;
 IF k IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ip:=set_byte(ip,i,get_byte(ip,i)#get_byte(k,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(k,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ip||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;RETURN t;
END $$;
CREATE FUNCTION care_organization.lifecycle_context(p_actor text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE frame jsonb;t jsonb;BEGIN
 IF coalesce(current_setting('hdi.care_lifecycle',true),'')='' THEN RETURN NULL;END IF;
 frame:=current_setting('hdi.care_lifecycle')::jsonb;t:=care_organization.lifecycle_attest(frame->>'ticket',frame->>'signature');
 IF t->>'actor' IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;RETURN t;
END $$;
CREATE FUNCTION care_organization.lifecycle_member_matches(p_actor text,p_owner text,p_candidate uuid,p_input uuid,p_revision uuid,p_identity text,p_digest text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb;m care_organization.lifecycle_member;c governance_catalog.apply_candidate;BEGIN
 t:=care_organization.lifecycle_context(p_actor);IF t IS NULL THEN RETURN false;END IF;
 IF t->>'owner' IS DISTINCT FROM p_owner OR t->>'inputId' IS DISTINCT FROM p_input::text OR t->>'candidateId' IS DISTINCT FROM p_candidate::text OR t->>'digest' IS DISTINCT FROM p_digest OR t->>'phase' NOT IN ('FREEZE','APPLY') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 SELECT * INTO m FROM care_organization.lifecycle_member WHERE candidate_id=p_candidate AND owner=p_owner AND member_id=p_input;
 SELECT * INTO c FROM governance_catalog.apply_candidate WHERE id=p_candidate;
 IF m.member_id IS NULL OR m.revision IS DISTINCT FROM p_revision OR m.identity_code IS DISTINCT FROM p_identity OR c.digest IS DISTINCT FROM p_digest OR c.input->>'jobId' IS DISTINCT FROM m.input_id::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF t->>'phase'='APPLY' THEN PERFORM governance_catalog.apply_record((SELECT actor_code FROM governance_catalog.apply_approval WHERE candidate_id=p_candidate),'CHECK_APPROVAL',jsonb_build_object('candidateId',p_candidate));END IF;
 RETURN true;
END $$;
CREATE FUNCTION care_organization.lifecycle_record(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=care_organization.lifecycle_attest(p_ticket,p_signature);actor text:=t->>'actor';op text:=t->>'operation';identity text;r care_organization.lifecycle_input;v care_organization.lifecycle_verification;m jsonb;c jsonb;permission text;BEGIN
 PERFORM pg_advisory_xact_lock(901002);permission:=CASE WHEN op='READ' THEN t->>'permission' WHEN op='VERIFY' THEN 'REVIEW' ELSE 'WRITE' END;
 IF permission NOT IN ('READ','WRITE','REVIEW') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;identity:=vnext_control.authorize(actor,'SYNTHETIC',permission);
 IF op='STAGE' THEN
  PERFORM care_organization.closed(t,ARRAY['actor','transaction','operation','requestId','campus','digest','envelope','members','observationDigest']);
  IF jsonb_typeof(t->'members') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'members') NOT BETWEEN 1 AND 100 OR octet_length(t::text)>524288 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;
  SELECT * INTO r FROM care_organization.lifecycle_input WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF r.digest IS DISTINCT FROM t->>'digest' OR r.observation_digest IS DISTINCT FROM t->>'observationDigest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
  ELSE INSERT INTO care_organization.lifecycle_input(maker,identity_code,request_id,digest,campus,envelope,members,observation_digest) VALUES(actor,identity,(t->>'requestId')::uuid,t->>'digest',t->>'campus',t->'envelope',t->'members',t->>'observationDigest') RETURNING * INTO r;END IF;
  RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);
 END IF;
 IF op='CONTEXT' THEN
  PERFORM care_organization.closed(t,ARRAY['actor','transaction','operation','candidateId','digest','owner','inputId','phase','recordAt']);
  c:=governance_catalog.apply_record(actor,'READ_CANDIDATE',jsonb_build_object('candidateId',(t->>'candidateId')::uuid));
  IF c->>'digest' IS DISTINCT FROM t->>'digest' OR NOT EXISTS(SELECT 1 FROM care_organization.lifecycle_member lm WHERE lm.candidate_id=(c->>'id')::uuid AND lm.member_id=(t->>'inputId')::uuid AND lm.owner=t->>'owner') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM set_config('hdi.care_lifecycle',jsonb_build_object('ticket',p_ticket,'signature',p_signature)::text,true);RETURN '{}';
 END IF;
 SELECT * INTO r FROM care_organization.lifecycle_input WHERE id=(t->>'inputId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT * INTO v FROM care_organization.lifecycle_verification WHERE input_id=r.id;
 IF op='READ' THEN
  PERFORM care_organization.closed(t,ARRAY['actor','transaction','operation','inputId','permission']);
  IF permission='WRITE' AND identity IS DISTINCT FROM r.identity_code THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  RETURN jsonb_build_object('id',r.id,'revision',r.revision,'identity',r.identity_code,'digest',r.digest,'campus',r.campus,'envelope',r.envelope,'members',r.members,'observationDigest',r.observation_digest,'verification',CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object('id',v.id,'digest',v.digest,'observationDigest',v.observation_digest) END);
 END IF;
 IF op='VERIFY' THEN
  PERFORM care_organization.closed(t,ARRAY['actor','transaction','operation','inputId','inputDigest','requestId','reason','policy','digest','observationDigest']);
  IF identity=r.identity_code OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.members) x WHERE x->>'makerIdentity'=identity) THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
  IF r.digest IS DISTINCT FROM t->>'inputDigest' OR r.observation_digest IS DISTINCT FROM t->>'observationDigest' OR t->>'policy' IS DISTINCT FROM 'TEST_POLICY_ONLY' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  IF v.id IS NOT NULL THEN IF v.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('verificationId',v.id);END IF;
  INSERT INTO care_organization.lifecycle_verification(input_id,actor,identity_code,request_id,digest,observation_digest) VALUES(r.id,actor,identity,(t->>'requestId')::uuid,t->>'digest',t->>'observationDigest') RETURNING * INTO v;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'CARE_LIFECYCLE_VERIFY','TEST_POLICY_ONLY',v.digest);RETURN jsonb_build_object('verificationId',v.id);
 END IF;
 c:=governance_catalog.apply_record(actor,'READ_CANDIDATE',jsonb_build_object('candidateId',(t->>'candidateId')::uuid));
 IF c->>'digest' IS DISTINCT FROM t->>'digest' OR c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code OR v.id IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 IF op='BIND' THEN
  PERFORM care_organization.closed(t,ARRAY['actor','transaction','operation','inputId','candidateId','digest']);
  FOR m IN SELECT value FROM jsonb_array_elements(r.members) LOOP
   INSERT INTO care_organization.lifecycle_member VALUES((c->>'id')::uuid,r.id,m->>'owner',(m->>'inputId')::uuid,(m->>'revisionId')::uuid,m->>'digest',m->>'makerIdentity',(m->>'contractVersionId')::uuid);
  END LOOP;RETURN '{}';
 END IF;
 IF op='COMMIT_CHECK' THEN
  PERFORM care_organization.closed(t,ARRAY['actor','transaction','operation','inputId','candidateId','digest','facts']);
  IF c->>'approvedBy' IS NULL OR jsonb_array_length(t->'facts') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
  PERFORM set_config('hdi.care_lifecycle',jsonb_build_object('ticket',p_ticket,'signature',p_signature)::text,true);RETURN '{}';
 END IF;RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';
END $$;
REVOKE ALL ON FUNCTION care_organization.lifecycle_attest(text,text),care_organization.lifecycle_context(text),care_organization.lifecycle_member_matches(text,text,uuid,uuid,uuid,text,text),care_organization.lifecycle_record(text,text) FROM PUBLIC,hdi_prototype;
ALTER TABLE care_organization.apply_binding DROP CONSTRAINT apply_binding_pkey;
ALTER TABLE care_organization.apply_binding ADD PRIMARY KEY(candidate_id,input_id);
ALTER TABLE care_organization.change DROP CONSTRAINT change_candidate_id_key;
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.mutate(text,text)'::regprocedure);
 needle:=$old$c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_UNIT_MEMBER_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$(NOT care_organization.lifecycle_member_matches(actor,'UNIT',(c->>'id')::uuid,r.id,r.revision,r.identity_code,t->>'digest') AND (c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code))$new$);
 body:=replace(body,'WHERE candidate_id=(c->>''id'')::uuid;','WHERE candidate_id=(c->>''id'')::uuid AND input_id=r.id;');
 body:=replace(body,'WHERE candidate_id=(t->>''candidateId'')::uuid;','WHERE candidate_id=(t->>''candidateId'')::uuid AND input_id=r.id;');
 needle:='approved_by:=c->>''approvedBy'';';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_UNIT_TIME_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF care_organization.lifecycle_context(actor)->>''phase''=''APPLY'' THEN record_at:=care_organization.local_time(care_organization.lifecycle_context(actor)->>''recordAt'');IF record_at IS NULL THEN RAISE EXCEPTION ''INVALID_PLAN_TOKEN'';END IF;END IF;'||needle);EXECUTE body;
END $$;
ALTER TABLE care_organization.nursing_apply_binding DROP CONSTRAINT nursing_apply_binding_pkey;
ALTER TABLE care_organization.nursing_apply_binding ADD PRIMARY KEY(candidate_id,input_id);
ALTER TABLE care_organization.nursing_change DROP CONSTRAINT nursing_change_candidate_id_key;
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.nursing_mutate(text,text)'::regprocedure);
 needle:=$old$c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_NURSING_MEMBER_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$(NOT care_organization.lifecycle_member_matches(actor,'NURSING',(c->>'id')::uuid,r.id,r.revision,r.identity_code,t->>'digest') AND (c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code))$new$);
 body:=replace(body,'WHERE candidate_id=(c->>''id'')::uuid;','WHERE candidate_id=(c->>''id'')::uuid AND input_id=r.id;');
 body:=replace(body,'WHERE candidate_id=(t->>''candidateId'')::uuid;','WHERE candidate_id=(t->>''candidateId'')::uuid AND input_id=r.id;');
 needle:='approved_by:=c->>''approvedBy'';';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_NURSING_TIME_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF care_organization.lifecycle_context(actor)->>''phase''=''APPLY'' THEN record_at:=care_organization.local_time(care_organization.lifecycle_context(actor)->>''recordAt'');IF record_at IS NULL THEN RAISE EXCEPTION ''INVALID_PLAN_TOKEN'';END IF;END IF;'||needle);EXECUTE body;
END $$;
ALTER TABLE care_organization.ward_apply_binding DROP CONSTRAINT ward_apply_binding_pkey;
ALTER TABLE care_organization.ward_apply_binding ADD PRIMARY KEY(candidate_id,input_id);
ALTER TABLE care_organization.ward_change DROP CONSTRAINT ward_change_candidate_id_key;
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_mutate(text,text)'::regprocedure);
 needle:=$old$c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_MEMBER_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$(NOT care_organization.lifecycle_member_matches(actor,'WARD',(c->>'id')::uuid,r.id,r.revision,r.identity_code,t->>'digest') AND (c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code))$new$);
 body:=replace(body,'WHERE candidate_id=(c->>''id'')::uuid;','WHERE candidate_id=(c->>''id'')::uuid AND input_id=r.id;');
 body:=replace(body,'WHERE candidate_id=(t->>''candidateId'')::uuid;','WHERE candidate_id=(t->>''candidateId'')::uuid AND input_id=r.id;');
 needle:='approved_by:=c->>''approvedBy'';';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_TIME_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF care_organization.lifecycle_context(actor)->>''phase''=''APPLY'' THEN record_at:=care_organization.local_time(care_organization.lifecycle_context(actor)->>''recordAt'');IF record_at IS NULL THEN RAISE EXCEPTION ''INVALID_PLAN_TOKEN'';END IF;END IF;'||needle);EXECUTE body;
END $$;
ALTER TABLE care_organization.capability_apply_binding DROP CONSTRAINT capability_apply_binding_pkey;
ALTER TABLE care_organization.capability_apply_binding ADD PRIMARY KEY(candidate_id,input_id);
ALTER TABLE care_organization.capability_change DROP CONSTRAINT capability_change_candidate_id_key;
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.capability_mutate(text,text)'::regprocedure);
 needle:=$old$c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_CAPABILITY_MEMBER_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$(NOT care_organization.lifecycle_member_matches(actor,'CAPABILITY',(c->>'id')::uuid,r.id,r.revision,r.identity_code,t->>'digest') AND (c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code))$new$);
 body:=replace(body,'WHERE candidate_id=(c->>''id'')::uuid;','WHERE candidate_id=(c->>''id'')::uuid AND input_id=r.id;');
 body:=replace(body,'WHERE candidate_id=(t->>''candidateId'')::uuid;','WHERE candidate_id=(t->>''candidateId'')::uuid AND input_id=r.id;');
 needle:='approved_by:=c->>''approvedBy'';';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_CAPABILITY_TIME_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF care_organization.lifecycle_context(actor)->>''phase''=''APPLY'' THEN record_at:=care_organization.local_time(care_organization.lifecycle_context(actor)->>''recordAt'');IF record_at IS NULL THEN RAISE EXCEPTION ''INVALID_PLAN_TOKEN'';END IF;END IF;'||needle);EXECUTE body;
END $$;
ALTER TABLE care_organization.subject_apply_binding DROP CONSTRAINT subject_apply_binding_pkey;
ALTER TABLE care_organization.subject_apply_binding ADD PRIMARY KEY(candidate_id,input_id);
ALTER TABLE care_organization.subject_change DROP CONSTRAINT subject_change_candidate_id_key;
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.subject_mutate(text,text)'::regprocedure);
 needle:=$old$c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_PERMISSION_MEMBER_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$(NOT care_organization.lifecycle_member_matches(actor,'PERMISSION',(c->>'id')::uuid,r.id,r.revision,r.identity_code,t->>'digest') AND (c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code))$new$);
 body:=replace(body,'WHERE candidate_id=(c->>''id'')::uuid;','WHERE candidate_id=(c->>''id'')::uuid AND input_id=r.id;');
 body:=replace(body,'WHERE candidate_id=(t->>''candidateId'')::uuid;','WHERE candidate_id=(t->>''candidateId'')::uuid AND input_id=r.id;');
 needle:='SELECT * INTO change FROM care_organization.subject_change WHERE input_id=r.id;';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_PERMISSION_TIME_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF care_organization.lifecycle_context(actor)->>''phase''=''APPLY'' THEN point:=care_organization.local_time(care_organization.lifecycle_context(actor)->>''recordAt'');IF point IS NULL THEN RAISE EXCEPTION ''INVALID_PLAN_TOKEN'';END IF;END IF;'||needle);EXECUTE body;
END $$;
ALTER TABLE care_organization.unit_ward_apply_binding DROP CONSTRAINT unit_ward_apply_binding_pkey;
ALTER TABLE care_organization.unit_ward_apply_binding ADD PRIMARY KEY(candidate_id,input_id);
ALTER TABLE care_organization.unit_ward_change DROP CONSTRAINT unit_ward_change_candidate_id_key;
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.unit_ward_mutate(text,text)'::regprocedure);
 needle:=$old$c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_UNIT_WARD_MEMBER_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$(NOT care_organization.lifecycle_member_matches(actor,'UNIT_WARD',(c->>'id')::uuid,r.id,r.revision,r.identity_code,t->>'digest') AND (c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code))$new$);
 body:=replace(body,'WHERE candidate_id=(c->>''id'')::uuid;','WHERE candidate_id=(c->>''id'')::uuid AND input_id=r.id;');
 body:=replace(body,'WHERE candidate_id=(t->>''candidateId'')::uuid;','WHERE candidate_id=(t->>''candidateId'')::uuid AND input_id=r.id;');
 needle:='approved_by:=c->>''approvedBy'';';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_UNIT_WARD_TIME_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF care_organization.lifecycle_context(actor)->>''phase''=''APPLY'' THEN record_at:=care_organization.local_time(care_organization.lifecycle_context(actor)->>''recordAt'');IF record_at IS NULL THEN RAISE EXCEPTION ''INVALID_PLAN_TOKEN'';END IF;END IF;'||needle);EXECUTE body;
END $$;
ALTER TABLE care_organization.ward_nursing_apply_binding DROP CONSTRAINT ward_nursing_apply_binding_pkey;
ALTER TABLE care_organization.ward_nursing_apply_binding ADD PRIMARY KEY(candidate_id,input_id);
ALTER TABLE care_organization.ward_nursing_change DROP CONSTRAINT ward_nursing_change_candidate_id_key;
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_nursing_mutate_0199(text,text)'::regprocedure);
 needle:=$old$c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_NURSING_MEMBER_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$(NOT care_organization.lifecycle_member_matches(actor,'WARD_NURSING',(c->>'id')::uuid,r.id,r.revision,r.identity_code,t->>'digest') AND (c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code))$new$);
 body:=replace(body,'WHERE candidate_id=(c->>''id'')::uuid;','WHERE candidate_id=(c->>''id'')::uuid AND input_id=r.id;');
 body:=replace(body,'WHERE candidate_id=(t->>''candidateId'')::uuid;','WHERE candidate_id=(t->>''candidateId'')::uuid AND input_id=r.id;');
 needle:='approved_by:=c->>''approvedBy'';';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_NURSING_TIME_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF care_organization.lifecycle_context(actor)->>''phase''=''APPLY'' THEN record_at:=care_organization.local_time(care_organization.lifecycle_context(actor)->>''recordAt'');IF record_at IS NULL THEN RAISE EXCEPTION ''INVALID_PLAN_TOKEN'';END IF;END IF;'||needle);EXECUTE body;
END $$;
ALTER TABLE location_master.apply_binding DROP CONSTRAINT apply_binding_pkey;
ALTER TABLE location_master.apply_binding ADD PRIMARY KEY(candidate_id,input_id);
ALTER TABLE location_master.change DROP CONSTRAINT change_candidate_id_key;
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('location_master.mutate(text,text)'::regprocedure);
 needle:=$old$c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_LOCATION_MEMBER_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$(NOT care_organization.lifecycle_member_matches(actor,'LOCATION',(c->>'id')::uuid,r.id,r.revision,r.identity_code,t->>'digest') AND (c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code))$new$);
 body:=replace(body,'WHERE candidate_id=(c->>''id'')::uuid;','WHERE candidate_id=(c->>''id'')::uuid AND input_id=r.id;');
 body:=replace(body,'WHERE candidate_id=(t->>''candidateId'')::uuid;','WHERE candidate_id=(t->>''candidateId'')::uuid AND input_id=r.id;');
 needle:='approved_by:=c->>''approvedBy'';';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_LOCATION_TIME_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF care_organization.lifecycle_context(actor)->>''phase''=''APPLY'' THEN record_at:=care_organization.local_time(care_organization.lifecycle_context(actor)->>''recordAt'');IF record_at IS NULL THEN RAISE EXCEPTION ''INVALID_PLAN_TOKEN'';END IF;END IF;'||needle);EXECUTE body;
END $$;
ALTER TABLE location_master.use_apply_binding DROP CONSTRAINT use_apply_binding_pkey;
ALTER TABLE location_master.use_apply_binding ADD PRIMARY KEY(candidate_id,input_id);
ALTER TABLE location_master.use_change DROP CONSTRAINT use_change_candidate_id_key;
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('location_master.use_mutate(text,text)'::regprocedure);
 needle:=$old$c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_LOCATION_USE_MEMBER_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$(NOT care_organization.lifecycle_member_matches(actor,'LOCATION_USE',(c->>'id')::uuid,r.id,r.revision,r.identity_code,t->>'digest') AND (c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR c->>'makerIdentity' IS DISTINCT FROM r.identity_code))$new$);
 body:=replace(body,'WHERE candidate_id=(c->>''id'')::uuid;','WHERE candidate_id=(c->>''id'')::uuid AND input_id=r.id;');
 body:=replace(body,'WHERE candidate_id=(t->>''candidateId'')::uuid;','WHERE candidate_id=(t->>''candidateId'')::uuid AND input_id=r.id;');
 needle:='approved_by:=c->>''approvedBy'';';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_LOCATION_USE_TIME_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF care_organization.lifecycle_context(actor)->>''phase''=''APPLY'' THEN record_at:=care_organization.local_time(care_organization.lifecycle_context(actor)->>''recordAt'');IF record_at IS NULL THEN RAISE EXCEPTION ''INVALID_PLAN_TOKEN'';END IF;END IF;'||needle);EXECUTE body;
END $$;
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('governance_catalog.apply_record(text,text,jsonb)'::regprocedure);needle:='IF p_action=''COMMIT'' THEN';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_COMMIT_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,needle||$guard$
 IF EXISTS(SELECT 1 FROM care_organization.lifecycle_input li WHERE li.id=(c.input->>'jobId')::uuid) THEN
  IF care_organization.lifecycle_context(p_actor)->>'operation' IS DISTINCT FROM 'COMMIT_CHECK' OR care_organization.lifecycle_context(p_actor)->>'candidateId' IS DISTINCT FROM c.id::text OR care_organization.lifecycle_context(p_actor)->'facts' IS DISTINCT FROM p_input->'facts' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 END IF;
$guard$);
END $$;
