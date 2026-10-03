SELECT pg_advisory_xact_lock(901002);
CREATE TABLE department_master.workspace_draft_revision(
 id uuid NOT NULL,number bigint NOT NULL CHECK(number>0),identity_code text NOT NULL,maker text NOT NULL REFERENCES vnext_control.actor(code),
 request_id uuid NOT NULL,digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),metadata jsonb NOT NULL,envelope jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('EDITING','DISCARDED','SUBMITTED')),submission jsonb,
 CHECK((state='SUBMITTED')=(submission IS NOT NULL)),recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 PRIMARY KEY(id,number),UNIQUE(identity_code,request_id)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON department_master.workspace_draft_revision FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
ALTER TABLE department_master.workspace_draft_revision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON department_master.workspace_draft_revision FROM PUBLIC,hdi_prototype;

CREATE FUNCTION department_master.workspace_authorize(p_actor text,m jsonb,p_permission text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;ref jsonb;c governance_catalog.department_impact_case;BEGIN
 IF m->>'kind' NOT IN ('DEPARTMENT','HIERARCHY','MAPPING','IDENTIFIER','EVOLUTION','LIFECYCLE','IMPACT') OR m->>'campus' NOT IN ('NORTH','SOUTH') OR jsonb_typeof(m->'references') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 identity:=department_master.authorize(p_actor,m->>'campus',p_permission);
 PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');
 IF m->>'kind'='HIERARCHY' THEN PERFORM department_master.authorize(p_actor,'HOSPITAL',CASE WHEN p_permission='READ_RESTRICTED' THEN 'READ' ELSE p_permission END);END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(m->'references') LOOP
  CASE ref->>'owner'
  WHEN 'department-master' THEN PERFORM department_master.snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'department-master/hierarchy-view' THEN PERFORM department_master.hierarchy_authorize(p_actor,(ref->>'id')::uuid,'READ');
  WHEN 'department-master/impact-case' THEN
   SELECT * INTO c FROM governance_catalog.department_impact_case WHERE id=(ref->>'id')::uuid AND campus=m->>'campus';
   IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
   PERFORM department_master.impact_case_authorize(p_actor,c.obligation,c.campus,CASE WHEN p_permission='READ_RESTRICTED' THEN 'READ' ELSE p_permission END);
  WHEN 'organization-master' THEN PERFORM organization_master.read(p_actor,jsonb_build_object('id',ref->>'id'));
  WHEN 'organization-master/campus' THEN PERFORM organization_master.campus_snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'department-master/organization-mapping' THEN PERFORM department_master.mapping_snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'department-master/organization-identifier' THEN PERFORM department_master.identifier_snapshot(p_actor,(ref->>'id')::uuid,m->>'campus');
  WHEN 'governance-catalog/source' THEN PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',(ref->>'id')::uuid);
  ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';
  END CASE;
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(m->'namespaces') LOOP
  PERFORM department_master.mapping_authorize(p_actor,(ref->>'source')::uuid,ref->>'entity',ref->>'context',m->>'campus',p_permission);
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(m->'schemes') LOOP
  PERFORM department_master.identifier_authorize(p_actor,ref#>>'{}',m->>'campus',p_permission);
 END LOOP;
 IF m ? 'transport' THEN PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',(m->'transport'->>'contractVersionId')::uuid,'READ');END IF;
 RETURN identity;
END $$;

CREATE FUNCTION department_master.workspace_save(p_actor text,p_input jsonb,p_digest text,p_envelope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;previous department_master.workspace_draft_revision;r department_master.workspace_draft_revision;prior vnext_control.outcome;target uuid:=(p_input->>'id')::uuid;result jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 identity:=department_master.workspace_authorize(p_actor,p_input->'metadata','WRITE');
 PERFORM department_master.workspace_authorize(p_actor,p_input->'metadata','READ_RESTRICTED');
 SELECT o.* INTO prior FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=(p_input->>'requestId')::uuid;
 IF FOUND THEN IF prior.input_digest<>p_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN prior.result;END IF;
 IF target IS NOT NULL THEN
  SELECT * INTO previous FROM department_master.workspace_draft_revision WHERE id=target ORDER BY number DESC LIMIT 1;
  IF previous.identity_code IS DISTINCT FROM identity THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM department_master.workspace_authorize(p_actor,previous.metadata,'WRITE');PERFORM department_master.workspace_authorize(p_actor,previous.metadata,'READ_RESTRICTED');
  IF previous.number::text IS DISTINCT FROM p_input->>'expectedVersion' OR previous.state<>'EDITING' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
  IF previous.metadata->>'kind' IS DISTINCT FROM p_input->'metadata'->>'kind' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 ELSE
  IF p_input ? 'expectedVersion' OR p_input->>'state'<>'EDITING' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;target:=uuidv7();
 END IF;
 IF p_input->>'state' NOT IN ('EDITING','DISCARDED','SUBMITTED') OR jsonb_typeof(p_envelope) IS DISTINCT FROM 'object' OR octet_length(p_envelope::text)>4000000 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF p_input->>'state'='SUBMITTED' AND p_input->'metadata'->>'kind'='DEPARTMENT' THEN
  IF NOT EXISTS(SELECT 1 FROM department_master.input i WHERE i.id=(p_input->'submission'->>'inputId')::uuid AND i.identity_code=identity AND i.revision=(p_input->'submission'->>'revisionId')::uuid AND i.job_id=(p_input->'submission'->>'jobId')::uuid AND i.job_revision=(p_input->'submission'->>'jobRevisionId')::uuid) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 END IF;
 IF p_input->>'state'='SUBMITTED' AND p_input->'metadata'->>'kind'='HIERARCHY' THEN
  IF NOT EXISTS(SELECT 1 FROM department_master.hierarchy_candidate c WHERE c.id=(p_input->'submission'->>'candidateId')::uuid AND c.view_id=(p_input->'submission'->>'viewId')::uuid AND c.digest=p_input->'submission'->>'digest' AND c.maker_identity=identity AND c.request_id=(p_input->'submission'->>'publicationRequestId')::uuid) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 END IF;
 IF p_input->>'state'='SUBMITTED' AND p_input->'metadata'->>'kind'='IMPACT' THEN
  IF NOT EXISTS(SELECT 1 FROM governance_catalog.department_impact_case_event e WHERE e.id=(p_input->'submission'->>'proposalEventId')::uuid AND e.case_id=(p_input->'submission'->>'caseId')::uuid AND e.actor_identity=identity AND e.kind='PROPOSE' AND e.sequence::text=p_input->'submission'->>'head') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 END IF;
 IF p_input->>'state'='SUBMITTED' AND p_input->'metadata'->>'kind' NOT IN ('DEPARTMENT','HIERARCHY','IMPACT') THEN
  IF NOT EXISTS(
   SELECT 1 FROM (
    SELECT 'MAPPING' kind,id,revision,job_id,job_revision,identity_code FROM department_master.mapping_input
    UNION ALL SELECT 'IDENTIFIER',id,revision,job_id,job_revision,identity_code FROM department_master.identifier_input
    UNION ALL SELECT 'EVOLUTION',id,revision,job_id,job_revision,identity_code FROM department_master.evolution_input
    UNION ALL SELECT 'LIFECYCLE',id,revision,job_id,job_revision,identity_code FROM department_master.lifecycle_input
   ) i WHERE i.kind=p_input->'metadata'->>'kind' AND i.id=(p_input->'submission'->>'inputId')::uuid AND i.identity_code=identity AND i.revision=(p_input->'submission'->>'revisionId')::uuid AND i.job_id=(p_input->'submission'->>'jobId')::uuid AND i.job_revision=(p_input->'submission'->>'jobRevisionId')::uuid
  ) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 END IF;
 INSERT INTO department_master.workspace_draft_revision VALUES(target,coalesce(previous.number,0)+1,identity,coalesce(previous.maker,p_actor),(p_input->>'requestId')::uuid,p_digest,p_input->'metadata',p_envelope,p_input->>'state',CASE WHEN p_input->>'state'='SUBMITTED' THEN p_input->'submission' ELSE NULL END,timezone('Asia/Shanghai',clock_timestamp())) RETURNING * INTO r;
 result:=jsonb_build_object('id',r.id,'version',r.number::text,'state',r.state,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,target,'DEPARTMENT_WORKSPACE_SAVE',r.state,p_digest);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(p_actor,r.request_id,p_digest,result);INSERT INTO vnext_control.request_identity VALUES(identity,r.request_id,p_actor);
 RETURN result;
END $$;

CREATE FUNCTION department_master.workspace_read(p_actor text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;r department_master.workspace_draft_revision;BEGIN
 PERFORM pg_advisory_xact_lock(901002);identity:=vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 SELECT * INTO r FROM department_master.workspace_draft_revision WHERE id=p_id ORDER BY number DESC LIMIT 1;
 IF r.identity_code IS DISTINCT FROM identity THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM department_master.workspace_authorize(p_actor,r.metadata,'READ');PERFORM department_master.workspace_authorize(p_actor,r.metadata,'READ_RESTRICTED');
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'DEPARTMENT_WORKSPACE_READ','PRIVATE_DRAFT',r.digest);
 RETURN to_jsonb(r)||jsonb_build_object('version',r.number::text,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
END $$;
CREATE FUNCTION department_master.workspace_list(p_actor text,p_after uuid,p_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;r department_master.workspace_draft_revision;items jsonb:='[]';BEGIN
 PERFORM pg_advisory_xact_lock(901002);identity:=vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR r IN SELECT DISTINCT ON (id) * FROM department_master.workspace_draft_revision WHERE identity_code=identity AND (p_after IS NULL OR id>p_after) ORDER BY id,number DESC LOOP
  BEGIN PERFORM department_master.workspace_authorize(p_actor,r.metadata,'READ');PERFORM department_master.workspace_authorize(p_actor,r.metadata,'READ_RESTRICTED');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT IN ('ACCESS_DENIED','NOT_FOUND') THEN RAISE;END IF;CONTINUE;END;
  items:=items||jsonb_build_array(jsonb_build_object('id',r.id,'version',r.number::text,'state',r.state,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'kind',r.metadata->>'kind','campus',r.metadata->>'campus'));
  IF jsonb_array_length(items)>=p_limit THEN EXIT;END IF;
 END LOOP;
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN jsonb_array_length(items)=p_limit THEN items->-1->>'id' ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION department_master.workspace_authorize(text,jsonb,text),department_master.workspace_save(text,jsonb,text,jsonb),department_master.workspace_read(text,uuid),department_master.workspace_list(text,uuid,integer) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION department_master.workspace_recover(p_actor text,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;target uuid;BEGIN
 PERFORM pg_advisory_xact_lock(901002);identity:=vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 SELECT id INTO target FROM department_master.workspace_draft_revision WHERE identity_code=identity AND request_id=p_request;
 IF target IS NULL THEN RETURN NULL;END IF;
 RETURN department_master.workspace_read(p_actor,target);
END $$;
REVOKE ALL ON FUNCTION department_master.workspace_recover(text,uuid) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION department_master.workspace_input_access(p_actor text,p_kind text,p_id uuid,p_permission text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 CASE p_kind
 WHEN 'DEPARTMENT' THEN PERFORM department_master.input_read(p_actor,p_id,p_permission);
 WHEN 'MAPPING' THEN PERFORM department_master.mapping_input_read(p_actor,p_id,p_permission);
 WHEN 'IDENTIFIER' THEN PERFORM department_master.identifier_input_read(p_actor,p_id,p_permission);
 WHEN 'EVOLUTION' THEN PERFORM department_master.evolution_input_read(p_actor,p_id,p_permission);
 WHEN 'LIFECYCLE' THEN PERFORM department_master.lifecycle_input_read(p_actor,p_id,p_permission);
 ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';
 END CASE;
END $$;
CREATE FUNCTION department_master.workspace_applications(p_actor text,p_after uuid,p_limit integer,p_input uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;r record;c governance_catalog.apply_candidate;approved text;items jsonb:='[]';access jsonb;permission text;field text;allowed boolean;state text;BEGIN
 PERFORM pg_advisory_xact_lock(901002);identity:=vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR r IN SELECT * FROM (
  SELECT 'DEPARTMENT' kind,id,revision,campus,maker,identity_code,digest,recorded_at FROM department_master.input
  UNION ALL SELECT 'MAPPING',id,revision,campus,maker,identity_code,digest,recorded_at FROM department_master.mapping_input
  UNION ALL SELECT 'IDENTIFIER',id,revision,campus,maker,identity_code,digest,recorded_at FROM department_master.identifier_input
  UNION ALL SELECT 'EVOLUTION',id,revision,campus,maker,identity_code,digest,recorded_at FROM department_master.evolution_input
  UNION ALL SELECT 'LIFECYCLE',id,revision,campus,maker,identity_code,digest,recorded_at FROM department_master.lifecycle_input
 ) i WHERE (p_after IS NULL OR id>p_after) AND (p_input IS NULL OR id=p_input) ORDER BY id LOOP
  BEGIN PERFORM department_master.workspace_input_access(p_actor,r.kind,r.id,'READ');PERFORM department_master.workspace_input_access(p_actor,r.kind,r.id,'READ_RESTRICTED');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT IN ('ACCESS_DENIED','NOT_FOUND') THEN RAISE;END IF;CONTINUE;END;
  access:='{"canRead":true}';
  FOR permission,field IN SELECT * FROM (VALUES('WRITE','canWrite'),('REVIEW','canReview'),('VERIFY','canVerify')) v(permission,field) LOOP
   allowed:=true;
   BEGIN PERFORM department_master.workspace_input_access(p_actor,r.kind,r.id,permission);
   EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT IN ('ACCESS_DENIED','NOT_FOUND') THEN RAISE;END IF;allowed:=false;END;
   IF permission IN ('REVIEW','VERIFY') AND identity=r.identity_code THEN allowed:=false;END IF;
   access:=access||jsonb_build_object(field,allowed);
  END LOOP;
  access:=access||jsonb_build_object('canPlan',identity=r.identity_code AND (access->>'canWrite')::boolean,'canApply',identity=r.identity_code AND (access->>'canWrite')::boolean);
  SELECT * INTO c FROM governance_catalog.apply_candidate WHERE input->>'jobId'=r.id::text AND input->>'revisionId'=r.revision::text ORDER BY recorded_at DESC LIMIT 1;
  SELECT actor_code INTO approved FROM governance_catalog.apply_approval WHERE candidate_id=c.id;
  state:=CASE WHEN EXISTS(SELECT 1 FROM governance_catalog.apply_commit WHERE candidate_id=c.id) THEN 'COMMITTED' WHEN approved IS NOT NULL THEN 'APPROVED' WHEN c.id IS NOT NULL THEN 'CANDIDATE' ELSE 'STAGED' END;
  items:=items||jsonb_build_array(jsonb_build_object('kind',r.kind,'inputId',r.id,'revisionId',r.revision,'inputDigest',r.digest,'campus',r.campus,'maker',r.maker,'state',state,'candidateId',c.id,'requestId',c.input->>'requestId','candidateDigest',c.digest,'approvedBy',approved,'access',access,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')));
  IF jsonb_array_length(items)>=p_limit THEN EXIT;END IF;
 END LOOP;
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN jsonb_array_length(items)=p_limit THEN items->-1->>'inputId' ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION department_master.workspace_input_access(text,text,uuid,text),department_master.workspace_applications(text,uuid,integer,uuid) FROM PUBLIC,hdi_prototype;
