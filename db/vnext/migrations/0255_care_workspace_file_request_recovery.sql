-- Private file request and encrypted original receipt use the existing outcome and audit.
SELECT pg_advisory_xact_lock(901002);
CREATE OR REPLACE FUNCTION care_organization.workspace_authorize(p_actor text,m jsonb,p_permission text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;campus uuid;ref jsonb;c jsonb;dataset text;BEGIN
 IF m->>'format' IS DISTINCT FROM 'CARE_WORKSPACE_METADATA_V1' OR m->>'kind' NOT IN ('UNIT','NURSING','WARD','UNIT_WARD','WARD_NURSING','CAPABILITY','PERMISSION','LOCATION','LOCATION_USE','LIFECYCLE') OR m->>'campus' NOT IN ('NORTH','SOUTH') OR p_permission NOT IN ('READ','WRITE','READ_RESTRICTED') OR jsonb_typeof(m->'campusIds') IS DISTINCT FROM 'array' OR jsonb_typeof(m->'references') IS DISTINCT FROM 'array' OR jsonb_typeof(m->'contracts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC',CASE WHEN p_permission='WRITE' THEN 'WRITE' ELSE 'READ' END);
 IF p_permission='WRITE' AND NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=p_actor AND active AND principal_kind='HUMAN') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(coalesce(m->'protected','[]')) LOOP
  IF ref ? 'protected' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  PERFORM care_organization.workspace_authorize(p_actor,ref,p_permission);
 END LOOP;
 IF jsonb_array_length(m->'campusIds')=0 THEN
  PERFORM care_organization.workspace_campus_authorize(p_actor,m->>'kind',NULL,m->>'campus',p_permission);
 END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(m->'campusIds') LOOP PERFORM care_organization.workspace_campus_authorize(p_actor,m->>'kind',(ref#>>'{}')::uuid,m->>'campus',p_permission);END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(coalesce(m->'subjectScopes','[]')) LOOP
  -- Match each original partial tuple independently; arrays never form products.
  IF NOT EXISTS(SELECT 1 FROM care_organization.subject_access a WHERE a.actor=p_actor AND a.permission=p_permission AND a.kind=ref->>'kind'
   AND (ref->'scope'->'subject'->>'id' IS NULL OR a.subject_id=(ref->'scope'->'subject'->>'id')::uuid)
   AND (ref->'scope'->'campus'->>'id' IS NULL OR a.campus_id=(ref->'scope'->'campus'->>'id')::uuid)
   AND (ref->'scope'->'target'->>'id' IS NULL OR a.target_id=(ref->'scope'->'target'->>'id')::uuid)
   AND (ref->'scope'->'target'->>'type' IS NULL OR a.target_type=ref->'scope'->'target'->>'type')) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(coalesce(m->'members','[]')) LOOP PERFORM care_organization.workspace_input_reference(p_actor,ref->>'owner',(ref->>'inputId')::uuid,p_permission);END LOOP;
 dataset:=CASE m->>'kind' WHEN 'UNIT' THEN 'ORG07' WHEN 'NURSING' THEN 'ORG09' WHEN 'WARD' THEN 'ORG08' WHEN 'UNIT_WARD' THEN 'ORG10' WHEN 'WARD_NURSING' THEN 'ORG11' WHEN 'LOCATION' THEN 'ORG12' WHEN 'LOCATION_USE' THEN 'ORG13' WHEN 'CAPABILITY' THEN 'ORG16' WHEN 'PERMISSION' THEN 'ORG17' END;
 FOR ref IN SELECT value FROM jsonb_array_elements(m->'contracts') LOOP
  PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',(ref->>'contractVersionId')::uuid,'READ');
  c:=governance_catalog.contract_read(p_actor,jsonb_build_object('scope','SYNTHETIC','mode','HISTORY','target',ref->>'contractId','versionId',ref->>'contractVersionId'));
  IF dataset IS NULL OR jsonb_array_length(c)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(c) entry WHERE entry->>'dataset' IS DISTINCT FROM dataset OR entry->>'profile' IS DISTINCT FROM m->>'profile' OR entry->>'versionId' IS DISTINCT FROM ref->>'contractVersionId') THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(coalesce(m->'materials','[]')) LOOP
  PERFORM governance_catalog.registration_evidence_access(p_actor,(ref#>>'{}')::uuid,NULL,m->>'campus');
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(m->'references') LOOP
  CASE ref->>'owner'
  WHEN 'care-organization/unit' THEN PERFORM care_organization.snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'care-organization/nursing' THEN PERFORM care_organization.nursing_snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'care-organization/ward' THEN PERFORM care_organization.ward_snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'care-organization/unit-ward-relation' THEN PERFORM care_organization.unit_ward_snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'care-organization/ward-nursing-coverage' THEN PERFORM care_organization.ward_nursing_snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'care-organization/ward-nursing-scope' THEN
   IF ref ? 'version' THEN PERFORM care_organization.ward_nursing_scope_version_read(p_actor,(ref->>'id')::uuid,(ref->>'version')::bigint,timezone('Asia/Shanghai',clock_timestamp()));
   ELSE PERFORM care_organization.ward_nursing_scope_set_read(p_actor,(ref->>'id')::uuid,timezone('Asia/Shanghai',clock_timestamp()));END IF;
  WHEN 'care-organization/unit-capability' THEN PERFORM care_organization.capability_snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'care-organization/subject-mapping' THEN PERFORM care_organization.subject_snapshot(p_actor,(ref->>'id')::uuid,timezone('Asia/Shanghai',clock_timestamp()));
  WHEN 'care-organization/subject-permission' THEN PERFORM care_organization.subject_snapshot(p_actor,(ref->>'id')::uuid,timezone('Asia/Shanghai',clock_timestamp()));
  WHEN 'location-master' THEN PERFORM location_master.snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'location-master/location-use' THEN PERFORM location_master.use_snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'location-master/usage-type' THEN PERFORM location_master.usage_type_read(p_actor,jsonb_build_object('id',ref->>'id')||CASE WHEN ref ? 'versionId' THEN jsonb_build_object('versionId',ref->>'versionId') ELSE '{}' END);
  WHEN 'governance-catalog/subject-code' THEN PERFORM governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',ref->>'id')||CASE WHEN ref ? 'versionId' THEN jsonb_build_object('versionId',ref->>'versionId') ELSE '{}' END);
  WHEN 'governance-catalog/parameter-value' THEN PERFORM governance_catalog.parameter_value_read(p_actor,jsonb_build_object('id',ref->>'id')||CASE WHEN ref ? 'versionId' THEN jsonb_build_object('versionId',ref->>'versionId') ELSE '{}' END,false);
  WHEN 'department-master' THEN PERFORM department_master.snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'department-master/campus-relation' THEN
   c:=department_master.lifecycle_relation_snapshot(p_actor,(ref->>'id')::uuid,m->>'campus','READ');
   IF ref ? 'versionId' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c->'versions') v WHERE v->>'id'=ref->>'versionId' AND (NOT ref ? 'version' OR v->>'number'=ref->>'version')) THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
  WHEN 'organization-master/campus' THEN PERFORM organization_master.campus_snapshot(p_actor,(ref->>'id')::uuid);
  WHEN 'organization-master' THEN PERFORM organization_master.snapshot(p_actor,(ref->>'id')::uuid,m->>'campus');
  WHEN 'organization-master/license' THEN
   c:=organization_master.workspace_object_context(p_actor,'LICENSE',(ref->>'id')::uuid);
   IF ref ? 'versionId' AND ref ? 'version' THEN PERFORM organization_master.use_license_reference_access(p_actor,(c->>'subjectId')::uuid,ref);END IF;
  WHEN 'governance-catalog/import-job' THEN
   c:=governance_catalog.import_job_context(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',ref->>'id'));
   IF ref ? 'versionId' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c->'revisions') revision WHERE revision->>'id'=ref->>'versionId') THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
  WHEN 'governance-catalog/source' THEN PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',(ref->>'id')::uuid);
  ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END CASE;
 END LOOP;
 RETURN identity;
END $$;

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
 IF op IN ('FILE_BODY','FILE_LOOKUP','FILE_RECORD') THEN
  IF t->>'permission' NOT IN ('READ','WRITE') OR (op='FILE_RECORD' AND t->>'permission'<>'WRITE') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  SELECT * INTO previous FROM care_organization.workspace_draft_revision WHERE id=(t->>'id')::uuid ORDER BY number DESC LIMIT 1;
  IF previous.identity_code IS DISTINCT FROM identity THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  IF t->>'permission'='WRITE' AND previous.state<>'EDITING' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
  PERFORM care_organization.workspace_authorize(actor,previous.metadata,t->>'permission');PERFORM care_organization.workspace_authorize(actor,previous.metadata,'READ_RESTRICTED');
  SELECT * INTO r FROM care_organization.workspace_draft_revision WHERE id=previous.id AND number::text=t->>'expectedVersion';
  IF NOT FOUND OR r.state<>'EDITING' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
  PERFORM care_organization.workspace_authorize(actor,r.metadata,t->>'permission');PERFORM care_organization.workspace_authorize(actor,r.metadata,'READ_RESTRICTED');
  IF op='FILE_BODY' THEN
   INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'CARE_WORKSPACE_FILE_READ','PRIVATE_FILE',r.digest);
   RETURN to_jsonb(r)||jsonb_build_object('version',r.number::text,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
  END IF;
  SELECT o.* INTO prior FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=(t->>'requestId')::uuid;
  IF FOUND THEN
   IF prior.input_digest IS DISTINCT FROM t->>'requestDigest' OR prior.result->>'id' IS DISTINCT FROM r.id::text OR prior.result->>'version' IS DISTINCT FROM r.number::text THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
   INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'CARE_WORKSPACE_FILE_RECOVER','ORIGINAL_RECEIPT',prior.result->>'digest');RETURN prior.result;
  END IF;
  IF op='FILE_LOOKUP' THEN RETURN NULL;END IF;
  IF jsonb_typeof(t->'envelope') IS DISTINCT FROM 'object' OR octet_length((t->'envelope')::text)>4000000 OR t->>'digest' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  result:=jsonb_build_object('id',r.id,'version',r.number::text,'digest',t->>'digest','envelope',t->'envelope');
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'CARE_WORKSPACE_FILE_RECEIPT','ORIGINAL_OWNER',t->>'digest');
  INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(actor,(t->>'requestId')::uuid,t->>'requestDigest',result);
  INSERT INTO vnext_control.request_identity VALUES(identity,(t->>'requestId')::uuid,actor);RETURN result;
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

REVOKE ALL ON FUNCTION care_organization.workspace_authorize(text,jsonb,text),care_organization.workspace_record(text,text) FROM PUBLIC;
