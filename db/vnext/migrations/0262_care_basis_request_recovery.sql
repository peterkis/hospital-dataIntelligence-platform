SELECT pg_advisory_xact_lock(901002);

-- Two finite encrypted request types share the private draft revision store.
-- Native parameter/subject outcome tables remain the only business outcomes.
CREATE FUNCTION governance_catalog.workspace_basis_metadata(p_actor text,p_operation text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item jsonb;target_item jsonb;definition governance_catalog.parameter_version;m jsonb;BEGIN
 IF p_operation='commandParameterValue' THEN
  IF p_command->>'action'='CREATE' THEN item:=p_command;
  ELSE SELECT value INTO item FROM jsonb_array_elements(governance_catalog.parameter_value_read(p_actor,jsonb_build_object('id',p_command->>'target')||CASE WHEN p_command ? 'versionId' THEN jsonb_build_object('versionId',p_command->>'versionId') ELSE '{}' END,false));END IF;
  IF item IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  SELECT * INTO definition FROM governance_catalog.parameter_version WHERE id=coalesce(p_command->>'definitionVersionId',item->>'definitionVersionId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
  m:=jsonb_build_object('format','CARE_BASIS_REQUEST_V1','kind','BASIS_PARAMETER','action',p_command->>'action','definitionVersionId',definition.id,'applicability',item->'applicability','sourceVersionId',definition.system_version_id,'evidenceIds',jsonb_build_array(coalesce(p_command->>'evidenceId',item->>'evidenceId')));
 ELSE
  IF p_operation IS DISTINCT FROM 'commandSubjectCodeSnapshot' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF p_command->>'action' IN ('CREATE','REVISE') THEN item:=p_command;
   IF p_command->>'action'='REVISE' THEN SELECT value INTO target_item FROM jsonb_array_elements(governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',p_command->>'target')));IF target_item IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;IF target_item->>'head' IS DISTINCT FROM p_command->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;END IF;
  ELSE SELECT value INTO item FROM jsonb_array_elements(governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',p_command->>'target','versionId',p_command->>'versionId')));END IF;
  IF item IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  m:=jsonb_build_object('format','CARE_BASIS_REQUEST_V1','kind','BASIS_SUBJECT','action',p_command->>'action','sourceId',item->>'sourceId','sourceVersionId',item->>'sourceVersionId','evidenceIds',jsonb_build_array(item->>'evidenceId')||CASE WHEN p_command->>'action'='VERIFY' THEN jsonb_build_array(p_command->>'evidenceId') WHEN p_command->>'action'='APPROVE' AND item->'sourceVerification'->>'evidenceId' IS NOT NULL THEN jsonb_build_array(item->'sourceVerification'->>'evidenceId') ELSE '[]' END);
 END IF;
 IF p_command ? 'target' THEN m:=m||jsonb_build_object('target',p_command->>'target','versionId',coalesce(target_item->>'versionId',item->>'versionId'));END IF;RETURN m;
END $$;

CREATE FUNCTION governance_catalog.workspace_basis_authorize(p_actor text,m jsonb,p_execute boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;permission text;evidence text;campus text:='NORTH';target_facts jsonb;BEGIN
 IF m->>'format' IS DISTINCT FROM 'CARE_BASIS_REQUEST_V1' OR jsonb_typeof(m->'evidenceIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 permission:=CASE m->>'action' WHEN 'APPROVE' THEN 'REVIEW' WHEN 'VERIFY' THEN 'VERIFY' WHEN 'CREATE' THEN 'WRITE' WHEN 'REVISE' THEN 'WRITE' ELSE NULL END;
 IF permission IS NULL OR p_execute AND NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=p_actor AND active AND principal_kind='HUMAN') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF m->>'kind'='BASIS_PARAMETER' THEN
  PERFORM governance_catalog.parameter_value_scope_access(p_actor,(m->>'definitionVersionId')::uuid,m->'applicability','READ');
  IF p_execute THEN PERFORM governance_catalog.parameter_value_scope_access(p_actor,(m->>'definitionVersionId')::uuid,m->'applicability',permission);END IF;
  IF m ? 'target' THEN target_facts:=governance_catalog.parameter_value_read(p_actor,jsonb_build_object('id',m->>'target','versionId',m->>'versionId'),false);IF jsonb_array_length(target_facts)=0 THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;END IF;
  campus:=organization_master.campus_snapshot(p_actor,(m->'applicability'->'campus'->>'id')::uuid)->>'scope';
 ELSIF m->>'kind'='BASIS_SUBJECT' THEN
  PERFORM governance_catalog.subject_code_authorize(p_actor,'READ');
  IF p_execute THEN PERFORM governance_catalog.subject_code_authorize(p_actor,permission);END IF;
  PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',(m->>'sourceId')::uuid,(m->>'sourceVersionId')::uuid);
  IF m ? 'target' THEN target_facts:=governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',m->>'target','versionId',m->>'versionId'));IF jsonb_array_length(target_facts)=0 THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;END IF;
 ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR evidence IN SELECT jsonb_array_elements_text(m->'evidenceIds') LOOP PERFORM governance_catalog.registration_evidence_access(p_actor,evidence::uuid,(m->>'sourceVersionId')::uuid,campus);END LOOP;
 RETURN identity;
END $$;

CREATE FUNCTION care_organization.workspace_basis_record(p_ticket text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=care_organization.lifecycle_attest(p_ticket,p_signature);actor text:=t->>'actor';identity text;r care_organization.workspace_draft_revision;result jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(901002);identity:=vnext_control.authorize(actor,'SYNTHETIC','READ');
 IF t->>'operation' NOT IN ('SAVE','READ') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 SELECT * INTO r FROM care_organization.workspace_draft_revision WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid AND metadata->>'format'='CARE_BASIS_REQUEST_V1';
 IF t->>'operation'='SAVE' THEN
  PERFORM governance_catalog.workspace_basis_authorize(actor,t->'metadata',true);
  IF r.id IS NOT NULL THEN
   IF r.digest IS DISTINCT FROM t->>'digest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
   PERFORM governance_catalog.workspace_basis_authorize(actor,r.metadata,true);
  ELSE
   IF EXISTS(SELECT 1 FROM vnext_control.request_identity WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid) THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
   IF t->>'digest' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(t->'envelope') IS DISTINCT FROM 'object' OR octet_length((t->'envelope')::text)>2000000 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
   INSERT INTO care_organization.workspace_draft_revision VALUES(uuidv7(),1,identity,actor,(t->>'requestId')::uuid,t->>'digest',t->'metadata',t->'envelope','EDITING',NULL,timezone('Asia/Shanghai',clock_timestamp())) RETURNING * INTO r;
   result:=jsonb_build_object('id',r.id,'requestId',r.request_id,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
   INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(actor,r.request_id,r.digest,result);INSERT INTO vnext_control.request_identity VALUES(identity,r.request_id,actor);
  END IF;
 ELSE
  IF r.id IS NULL THEN RETURN NULL;END IF;
  PERFORM governance_catalog.workspace_basis_authorize(actor,r.metadata,false);
 END IF;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,r.id,'CARE_BASIS_REQUEST_'||(t->>'operation'),'PRIVATE_ORIGINAL_REQUEST',r.digest);
 RETURN to_jsonb(r)||jsonb_build_object('requestId',r.request_id,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
END $$;
REVOKE ALL ON FUNCTION governance_catalog.workspace_basis_metadata(text,text,jsonb),governance_catalog.workspace_basis_authorize(text,jsonb,boolean),care_organization.workspace_basis_record(text,text) FROM PUBLIC,hdi_prototype;
