-- Forward recovery projections; all original Owner authorizers remain authoritative.
SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION governance_catalog.owner_exact_execution_context(p_actor text,p_input uuid,p_after uuid,p_limit integer,p_candidate uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate governance_catalog.apply_candidate;value jsonb;items jsonb:='[]';last_id uuid;BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR candidate IN SELECT * FROM governance_catalog.apply_candidate WHERE input->>'jobId'=p_input::text AND (p_candidate IS NULL OR id=p_candidate) AND (p_request IS NULL OR input->>'requestId'=p_request::text) AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT p_limit+1 LOOP
  IF jsonb_array_length(items)=p_limit THEN RETURN jsonb_build_object('items',items,'nextAfterId',last_id);END IF;last_id:=candidate.id;
  value:=governance_catalog.apply_record(p_actor,'READ_CANDIDATE',jsonb_build_object('candidateId',candidate.id));
  items:=items||jsonb_build_array(jsonb_build_object('candidateId',candidate.id,'digest',value->>'digest','requestId',value->'input'->>'requestId','recordedAt',to_char(candidate.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'approvedBy',value->'approvedBy','committed',EXISTS(SELECT 1 FROM governance_catalog.apply_commit WHERE candidate_id=candidate.id)));
 END LOOP;RETURN jsonb_build_object('items',items,'nextAfterId',NULL);
END $$;

REVOKE ALL ON FUNCTION governance_catalog.owner_exact_execution_context(text,uuid,uuid,integer,uuid,uuid) FROM PUBLIC,hdi_prototype;
CREATE FUNCTION care_organization.workspace_application_context(p_actor text,p_kind text,p_campus text,p_after uuid,p_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE entry record;native jsonb;job jsonb;submission jsonb;items jsonb:='[]';last_id uuid;scanned integer:=0;BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 IF p_limit NOT BETWEEN 1 AND 100 OR p_kind NOT IN ('UNIT','NURSING','WARD','UNIT_WARD','WARD_NURSING','CAPABILITY','PERMISSION','LOCATION','LOCATION_USE','LIFECYCLE') OR p_campus NOT IN ('NORTH','SOUTH') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR entry IN SELECT * FROM (SELECT 'UNIT' AS kind,id,scope AS campus FROM care_organization.input UNION ALL SELECT 'NURSING' AS kind,id,scope AS campus FROM care_organization.nursing_input UNION ALL SELECT 'WARD' AS kind,id,scope AS campus FROM care_organization.ward_input UNION ALL SELECT 'UNIT_WARD' AS kind,id,scope AS campus FROM care_organization.unit_ward_input UNION ALL SELECT 'WARD_NURSING' AS kind,id,scope AS campus FROM care_organization.ward_nursing_input UNION ALL SELECT 'CAPABILITY' AS kind,id,scope AS campus FROM care_organization.capability_input UNION ALL SELECT 'PERMISSION' AS kind,id,scope AS campus FROM care_organization.subject_input UNION ALL SELECT 'LOCATION' AS kind,id,scope AS campus FROM location_master.input UNION ALL SELECT 'LOCATION_USE' AS kind,id,scope AS campus FROM location_master.use_input UNION ALL SELECT 'LIFECYCLE' AS kind,id,campus AS campus FROM care_organization.lifecycle_input) available WHERE kind=p_kind AND campus=p_campus AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT p_limit+1 LOOP
  scanned:=scanned+1;IF scanned>p_limit THEN RETURN jsonb_build_object('items',items,'nextAfterId',last_id);END IF;last_id:=entry.id;
  BEGIN native:=care_organization.workspace_input_reference(p_actor,p_kind,entry.id,'READ_RESTRICTED');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT IN ('ACCESS_DENIED','NOT_FOUND') THEN RAISE;END IF;CONTINUE;END;
  submission:=jsonb_build_object('kind',p_kind,'inputId',native->'id','revisionId',native->'revision','digest',native->'digest');
  IF p_kind<>'LIFECYCLE' THEN job:=governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',native->'job_id'));submission:=submission||jsonb_build_object('jobId',native->'job_id','jobRevisionId',native->'job_revision','contractVersionId',job->'contract'->'versionId');END IF;
  items:=items||jsonb_build_array(jsonb_build_object('id',native->'id','maker',native->'maker','recordedAt',native->'recordedAt','submission',submission));
 END LOOP;RETURN jsonb_build_object('items',items,'nextAfterId',NULL);
END $$;
REVOKE ALL ON FUNCTION care_organization.workspace_application_context(text,text,text,uuid,integer) FROM PUBLIC,hdi_prototype;

CREATE OR REPLACE FUNCTION care_organization.workspace_record(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=care_organization.lifecycle_attest(p_ticket,p_signature);actor text:=t->>'actor';op text:=t->>'operation';identity text;r care_organization.workspace_draft_revision;previous care_organization.workspace_draft_revision;prior vnext_control.outcome;result jsonb;target uuid;items jsonb:='[]';native jsonb;scanned integer:=0;last_id uuid;permission text;allowed boolean;BEGIN
 PERFORM pg_advisory_xact_lock(901002);identity:=vnext_control.authorize(actor,'SYNTHETIC',CASE WHEN op='SAVE' THEN 'WRITE' ELSE 'READ' END);
 IF op='PERMISSIONS' THEN
  IF t->>'kind' NOT IN ('UNIT','NURSING','WARD','UNIT_WARD','WARD_NURSING','CAPABILITY','PERMISSION','LOCATION','LOCATION_USE','LIFECYCLE') OR t->>'campus' NOT IN ('NORTH','SOUTH') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  result:='{}';FOREACH permission IN ARRAY ARRAY['READ','WRITE','READ_RESTRICTED','VERIFY','REVIEW'] LOOP
   allowed:=true;BEGIN PERFORM care_organization.workspace_campus_authorize(actor,t->>'kind',(t->>'campusId')::uuid,t->>'campus',permission);
    IF permission IN ('WRITE','VERIFY','REVIEW') AND NOT EXISTS(SELECT 1 FROM vnext_control.actor a WHERE a.code=actor AND a.active AND a.principal_kind='HUMAN') THEN allowed:=false;END IF;
   EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT IN ('ACCESS_DENIED','NOT_FOUND') THEN RAISE;END IF;allowed:=false;END;
   result:=result||jsonb_build_object(CASE permission WHEN 'READ' THEN 'read' WHEN 'WRITE' THEN 'write' WHEN 'READ_RESTRICTED' THEN 'readRestricted' WHEN 'VERIFY' THEN 'verify' ELSE 'review' END,allowed);
  END LOOP;RETURN result;
 END IF;
 IF op IN ('LOOKUP','RECOVER') THEN
  SELECT o.* INTO prior FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=(t->>'requestId')::uuid;
  IF NOT FOUND THEN RETURN NULL;END IF;
  IF op='LOOKUP' AND prior.input_digest IS DISTINCT FROM t->>'requestDigest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
  SELECT * INTO r FROM care_organization.workspace_draft_revision WHERE id=(prior.result->>'id')::uuid ORDER BY number DESC LIMIT 1;
  IF r.identity_code IS DISTINCT FROM identity OR (t->>'id' IS NOT NULL AND r.id<>(t->>'id')::uuid) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM care_organization.workspace_authorize(actor,r.metadata,CASE WHEN op='RECOVER' THEN 'READ' ELSE 'WRITE' END);PERFORM care_organization.workspace_authorize(actor,r.metadata,'READ_RESTRICTED');
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'CARE_WORKSPACE_RECOVER',op,r.digest);RETURN prior.result;
 END IF;
 IF op='READ' THEN
  SELECT * INTO r FROM care_organization.workspace_draft_revision WHERE id=(t->>'id')::uuid ORDER BY number DESC LIMIT 1;
  IF r.identity_code IS DISTINCT FROM identity THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM care_organization.workspace_authorize(actor,r.metadata,'READ');PERFORM care_organization.workspace_authorize(actor,r.metadata,'READ_RESTRICTED');
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'CARE_WORKSPACE_READ','PRIVATE_DRAFT',r.digest);
  RETURN to_jsonb(r)||jsonb_build_object('version',r.number::text,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
 END IF;
 IF op='LIST' THEN
  IF (t->>'limit')::integer NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  FOR r IN SELECT * FROM (SELECT DISTINCT ON(id) * FROM care_organization.workspace_draft_revision WHERE identity_code=identity AND (t->>'after' IS NULL OR id>(t->>'after')::uuid) ORDER BY id,number DESC) heads WHERE (t->>'kind' IS NULL OR metadata->>'kind'=t->>'kind') AND (t->>'campus' IS NULL OR metadata->>'campus'=t->>'campus') ORDER BY id LIMIT (t->>'limit')::integer+1 LOOP
   scanned:=scanned+1;IF scanned>(t->>'limit')::integer THEN RETURN jsonb_build_object('items',items,'nextAfterId',last_id);END IF;last_id:=r.id;
   BEGIN PERFORM care_organization.workspace_authorize(actor,r.metadata,'READ');PERFORM care_organization.workspace_authorize(actor,r.metadata,'READ_RESTRICTED');
   EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT IN ('ACCESS_DENIED','NOT_FOUND') THEN RAISE;END IF;CONTINUE;END;
   items:=items||jsonb_build_array(jsonb_build_object('id',r.id,'version',r.number::text,'kind',r.metadata->>'kind','campus',r.metadata->>'campus','state',r.state,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')));
  END LOOP;
  RETURN jsonb_build_object('items',items,'nextAfterId',NULL);
 END IF;
 IF op='APPLICATIONS' THEN
  IF (t->>'limit')::integer NOT BETWEEN 1 AND 100 OR t->>'kind' NOT IN ('UNIT','NURSING','WARD','UNIT_WARD','WARD_NURSING','CAPABILITY','PERMISSION','LOCATION','LOCATION_USE','LIFECYCLE') OR t->>'campus' NOT IN ('NORTH','SOUTH') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  RETURN care_organization.workspace_application_context(actor,t->>'kind',t->>'campus',(t->>'after')::uuid,(t->>'limit')::integer);
  RETURN jsonb_build_object('items',items,'nextAfterId',NULL);
 END IF;
 IF op='EXECUTIONS' THEN
  IF t->>'kind' NOT IN ('UNIT','NURSING','WARD','UNIT_WARD','WARD_NURSING','CAPABILITY','PERMISSION','LOCATION','LOCATION_USE','LIFECYCLE') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  PERFORM care_organization.workspace_input_reference(actor,t->>'kind',(t->>'inputId')::uuid,'READ_RESTRICTED');
  RETURN governance_catalog.owner_exact_execution_context(actor,(t->>'inputId')::uuid,(t->>'after')::uuid,coalesce((t->>'limit')::integer,50),(t->>'candidateId')::uuid,(t->>'requestId')::uuid);
 END IF;
 IF op='APPLICATION_REFERENCE' THEN
  native:=care_organization.workspace_input_reference(actor,t->>'kind',(t->>'inputId')::uuid,'READ_RESTRICTED');
  result:=jsonb_build_object('kind',t->>'kind','inputId',native->'id','revisionId',native->'revision','digest',native->'digest');
  IF t->>'kind'<>'LIFECYCLE' THEN
   items:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',native->'job_id'));
   result:=result||jsonb_build_object('jobId',native->'job_id','jobRevisionId',native->'job_revision','contractVersionId',items->'contract'->'versionId');
  END IF;
  RETURN jsonb_build_object('id',native->'id','maker',native->'maker','recordedAt',native->'recordedAt','submission',result);
 END IF;
 IF op<>'SAVE' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 identity:=care_organization.workspace_authorize(actor,t->'metadata','WRITE');PERFORM care_organization.workspace_authorize(actor,t->'metadata','READ_RESTRICTED');
 SELECT o.* INTO prior FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=(t->>'requestId')::uuid;
 IF FOUND THEN IF prior.input_digest IS DISTINCT FROM t->>'requestDigest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
  SELECT * INTO r FROM care_organization.workspace_draft_revision WHERE id=(prior.result->>'id')::uuid ORDER BY number DESC LIMIT 1;
  IF r.identity_code IS DISTINCT FROM identity THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM care_organization.workspace_authorize(actor,r.metadata,'WRITE');PERFORM care_organization.workspace_authorize(actor,r.metadata,'READ_RESTRICTED');RETURN prior.result;END IF;
 target:=(t->>'id')::uuid;
 IF target IS NOT NULL THEN
  SELECT * INTO previous FROM care_organization.workspace_draft_revision WHERE id=target ORDER BY number DESC LIMIT 1;
  IF previous.identity_code IS DISTINCT FROM identity THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM care_organization.workspace_authorize(actor,previous.metadata,'WRITE');PERFORM care_organization.workspace_authorize(actor,previous.metadata,'READ_RESTRICTED');
  IF previous.number::text IS DISTINCT FROM t->>'expectedVersion' OR previous.state<>'EDITING' OR previous.metadata->>'kind' IS DISTINCT FROM t->'metadata'->>'kind' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
 ELSE
  IF t ? 'expectedVersion' OR t->>'state'<>'EDITING' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;target:=uuidv7();
 END IF;
 IF t->>'state' NOT IN ('EDITING','DISCARDED','SUBMITTED') OR jsonb_typeof(t->'envelope') IS DISTINCT FROM 'object' OR octet_length((t->'envelope')::text)>4000000 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF t->>'state'='SUBMITTED' THEN
  IF t->'submission'->>'kind' IS DISTINCT FROM t->'metadata'->>'kind' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  native:=care_organization.workspace_input_reference(actor,t->'submission'->>'kind',(t->'submission'->>'inputId')::uuid,'READ_RESTRICTED');
  IF native->>'identity_code' IS DISTINCT FROM identity OR native->>'revision' IS DISTINCT FROM t->'submission'->>'revisionId' OR native->>'digest' IS DISTINCT FROM t->'submission'->>'digest' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  IF t->'submission'->>'kind'<>'LIFECYCLE' AND (native->>'job_id' IS DISTINCT FROM t->'submission'->>'jobId' OR native->>'job_revision' IS DISTINCT FROM t->'submission'->>'jobRevisionId') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 END IF;
 INSERT INTO care_organization.workspace_draft_revision VALUES(target,coalesce(previous.number,0)+1,identity,coalesce(previous.maker,actor),(t->>'requestId')::uuid,t->>'digest',t->'metadata',t->'envelope',t->>'state',CASE WHEN t->>'state'='SUBMITTED' THEN t->'submission' ELSE NULL END,timezone('Asia/Shanghai',clock_timestamp())) RETURNING * INTO r;
 result:=jsonb_build_object('id',r.id,'version',r.number::text,'state',r.state,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
 IF r.submission IS NOT NULL THEN result:=result||jsonb_build_object('submission',r.submission);END IF;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'CARE_WORKSPACE_SAVE',r.state,r.digest);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(actor,r.request_id,t->>'requestDigest',result);INSERT INTO vnext_control.request_identity VALUES(identity,r.request_id,actor);RETURN result;
END $$;
REVOKE ALL ON FUNCTION care_organization.workspace_authorize(text,jsonb,text),care_organization.workspace_record(text,text),care_organization.workspace_campus_authorize(text,text,uuid,text,text),care_organization.workspace_input_reference(text,text,uuid,text),location_master.workspace_draft_authorize(text,text,uuid,text,text) FROM PUBLIC,hdi_prototype;
REVOKE ALL ON FUNCTION care_organization.workspace_record(text,text) FROM PUBLIC;
