SELECT pg_advisory_xact_lock(901002);
CREATE OR REPLACE FUNCTION department_master.mutate(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;
 actor text:=t->>'actor';op text:=t->>'operation';identity text;r department_master.input;v department_master.verification;j jsonb;
 candidate jsonb;approved_by text;command jsonb:=t->'command';target uuid;n bigint;vid uuid;prior text;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.department_write_authority WHERE singleton;
 IF secret IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF op='STAGE' THEN
  identity:=department_master.authorize(actor,t->>'campus','WRITE');PERFORM department_master.authorize(actor,t->>'campus','READ_RESTRICTED');
  SELECT * INTO r FROM department_master.input WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF r.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);END IF;
  j:=governance_catalog.import_job_read(actor,jsonb_build_object('scope','SYNTHETIC','jobId',t->>'jobId'));
  IF j->>'submitterIdentity' IS DISTINCT FROM identity OR j->>'currentRevisionId' IS DISTINCT FROM t->>'revisionId' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
  IF EXISTS(SELECT 1 FROM department_master.input WHERE job_id=(j->>'id')::uuid AND job_revision=(j->>'currentRevisionId')::uuid) THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
  INSERT INTO department_master.input(job_id,job_revision,maker,identity_code,request_id,digest,campus,envelope) VALUES((j->>'id')::uuid,(j->>'currentRevisionId')::uuid,actor,identity,(t->>'requestId')::uuid,t->>'digest',t->>'campus',t->'envelope') RETURNING * INTO r;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'DEPARTMENT_INPUT','ORG04_CORE',r.digest);
  RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);
 END IF;
 SELECT * INTO r FROM department_master.input WHERE id=(t->>'inputId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 j:=governance_catalog.import_job_read(actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));
 IF r.job_revision IS DISTINCT FROM (j->>'currentRevisionId')::uuid THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 IF op='VERIFY' THEN
  identity:=department_master.authorize(actor,'HOSPITAL','VERIFY');PERFORM department_master.authorize(actor,r.campus,'READ_RESTRICTED');
  IF identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
  IF r.digest IS DISTINCT FROM t->>'inputDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  SELECT * INTO v FROM department_master.verification WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;
  IF FOUND THEN IF v.digest IS DISTINCT FROM t->>'digest' OR v.input_id<>r.id THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('verificationId',v.id);END IF;
  IF EXISTS(SELECT 1 FROM department_master.version WHERE input_id=r.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
  INSERT INTO department_master.verification(input_id,number,actor,identity_code,request_id,digest,envelope) VALUES(r.id,(SELECT coalesce(max(number),0)+1 FROM department_master.verification WHERE input_id=r.id),actor,identity,(t->>'requestId')::uuid,t->>'digest',t->'envelope') RETURNING * INTO v;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'DEPARTMENT_VERIFY','ORG04_SEMANTIC_REVIEW',v.digest);
  RETURN jsonb_build_object('verificationId',v.id);
 END IF;
 IF op<>'APPLY' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 candidate:=governance_catalog.apply_record(actor,'READ_CANDIDATE',jsonb_build_object('candidateId',(t->>'candidateId')::uuid));
 IF candidate->>'digest' IS DISTINCT FROM t->>'digest' OR candidate->'input'->>'jobId' IS DISTINCT FROM r.id::text OR candidate->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR coalesce(candidate->>'approvedBy','')='' THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 approved_by:=candidate->>'approvedBy';
 PERFORM governance_catalog.apply_record(approved_by,'CHECK_APPROVAL',jsonb_build_object('candidateId',(t->>'candidateId')::uuid));
 PERFORM department_master.authorize(approved_by,'HOSPITAL','REVIEW');PERFORM department_master.authorize(actor,r.campus,'WRITE');
 IF command->'row'->>'record_status' IS DISTINCT FROM 'ACTIVE' OR nullif(btrim(command->'row'->>'approval_ref'),'') IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 IF nullif(command->'row'->>'abolished_on','') IS NOT NULL THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 target:=(command->'target'->>'id')::uuid;
 IF command->>'intent'='CREATE' THEN
  IF target IS NOT NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF EXISTS(SELECT 1 FROM department_master.department WHERE code=command->'row'->>'org_code') THEN RAISE EXCEPTION 'IDENTIFIER_CONFLICT';END IF;
  INSERT INTO department_master.department(code) VALUES(command->'row'->>'org_code') RETURNING id INTO target;n:=1;
 ELSIF command->>'intent'='REVISE' THEN
  SELECT code INTO prior FROM department_master.department WHERE id=target;
  IF prior IS DISTINCT FROM command->'row'->>'org_code' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
  SELECT max(number)+1 INTO n FROM department_master.version WHERE department_id=target;
  IF n IS NULL OR (n-1)::text IS DISTINCT FROM command->'target'->>'expectedVersion' OR command->'target'->>'owner' IS DISTINCT FROM 'department-master' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 INSERT INTO department_master.version(department_id,number,valid_from,valid_to,input_id,source_row,facts,content_digest) VALUES(target,n,(command->>'validFrom')::timestamp,(command->>'validTo')::timestamp,r.id,(coalesce(t->>'sourceRow',t->>'row'))::integer,t->'facts',t->>'contentDigest') RETURNING id INTO vid;
 RETURN jsonb_build_object('owner','department-master','id',target,'version',n::text,'source',jsonb_build_object('dataset','ORG04','row',(coalesce(t->>'sourceRow',t->>'row'))::integer,'step','DEPARTMENT'));
END $$;
