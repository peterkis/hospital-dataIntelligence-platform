SELECT pg_advisory_xact_lock(901002);

-- Synthetic service principals can acknowledge only their assigned handoffs.
-- Existing development principals are explicitly human; no identity inference.
ALTER TABLE vnext_control.actor ADD COLUMN principal_kind text NOT NULL DEFAULT 'HUMAN' CHECK(principal_kind IN ('HUMAN','SERVICE'));

CREATE FUNCTION department_master.impact_case_authorize(p_actor text,p_obligation jsonb,p_campus text,p_permission text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;ref jsonb:=p_obligation->'reference';m department_master.organization_mapping;i department_master.organization_identifier;
BEGIN
 identity:=department_master.evolution_authorize(p_actor,p_campus,CASE WHEN p_permission='READ' THEN 'READ' ELSE 'WRITE' END);
 IF p_permission<>'READ' AND NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=p_actor AND principal_kind='HUMAN' AND active) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF p_obligation->>'kind'='REFERENCE' THEN
  PERFORM department_master.impact_reference_access(p_actor,ref,p_campus);
  IF ref->>'owner'='SOURCE_MAPPING' THEN
   SELECT * INTO m FROM department_master.organization_mapping WHERE id=(ref->>'id')::uuid;
   IF NOT FOUND OR m.campus<>p_campus THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
   PERFORM department_master.mapping_authorize(p_actor,m.from_system_id,m.entity_type,m.context,m.campus,p_permission);
   PERFORM department_master.mapping_snapshot(p_actor,m.id);
  ELSIF ref->>'owner'='IDENTIFIER' THEN
   SELECT * INTO i FROM department_master.organization_identifier WHERE id=(ref->>'id')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
   PERFORM department_master.identifier_authorize(p_actor,i.scheme,p_campus,p_permission);
   PERFORM department_master.identifier_snapshot(p_actor,i.id,p_campus);
  ELSIF ref->>'owner'='HIERARCHY' THEN
   PERFORM department_master.hierarchy_authorize(p_actor,(ref->>'id')::uuid,p_permission);
  ELSE RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 END IF;
 RETURN identity;
END $$;
REVOKE ALL ON FUNCTION department_master.impact_case_authorize(text,jsonb,text,text) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.department_impact_responsibility(p_actor text,p_id uuid,p_case uuid,p_permission text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c governance_catalog.department_impact_case;o governance_catalog.object;e governance_catalog.event;v governance_catalog.version;dataset text;
BEGIN
 SELECT * INTO c FROM governance_catalog.department_impact_case WHERE id=p_case;
 SELECT * INTO o FROM governance_catalog.object WHERE id=p_id AND scope='SYNTHETIC' AND kind='RESPONSIBILITY';
 IF NOT FOUND THEN RAISE EXCEPTION 'RESPONSIBILITY_NOT_READY';END IF;
 SELECT * INTO e FROM governance_catalog.event WHERE object_id=p_id ORDER BY head DESC LIMIT 1;
 SELECT * INTO v FROM governance_catalog.version WHERE id=e.version_id;
 dataset:=CASE c.obligation->>'owner' WHEN 'SOURCE_MAPPING' THEN 'ORG22' WHEN 'IDENTIFIER' THEN 'ORG23' WHEN 'HIERARCHY' THEN 'ORG05' ELSE 'ORG26' END;
 IF e.status<>'PUBLISHED' OR v.payload->>'dataset' IS DISTINCT FROM dataset OR v.payload->>'role' IS DISTINCT FROM 'OWNER'
  OR coalesce(v.payload->>'authorityScope','') NOT IN ('ALL',c.campus) OR v.payload->>'fieldGroup' IS DISTINCT FROM 'ALL'
  OR NOT(tsrange(v.valid_from,v.valid_to,'[)')@>timezone('Asia/Shanghai',clock_timestamp())) THEN RAISE EXCEPTION 'RESPONSIBILITY_NOT_READY';END IF;
 PERFORM vnext_control.require_object(p_actor,'SYNTHETIC',p_id,p_permission,'METADATA',v.payload);
 RETURN jsonb_build_object('id',p_id,'versionId',v.id,'role',v.payload->>'assigneeRole');
END $$;
REVOKE ALL ON FUNCTION governance_catalog.department_impact_responsibility(text,uuid,uuid,text) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.department_impact_event_json(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('caseId',case_id,'eventId',id,'head',sequence::text,'kind',kind,'status',status,'remainingSpans',coalesce(payload->'remainingSpans','[]'))
 FROM governance_catalog.department_impact_case_event WHERE id=p_id;
$$;
REVOKE ALL ON FUNCTION governance_catalog.department_impact_event_json(uuid) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.department_impact_command(t jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c governance_catalog.department_impact_case;prior governance_catalog.department_impact_case_event;
 assigned governance_catalog.department_impact_case_event;proposal governance_catalog.department_impact_case_event;approval governance_catalog.department_impact_case_event;
 latest governance_catalog.department_impact_case_event;created governance_catalog.department_impact_case_event;
 operation text:=t->>'operation';permission text;responsibility jsonb;payload jsonb:='{}';history jsonb;identity text:=t->>'identity';status text:='OPEN';old_outcome jsonb;
BEGIN
 SELECT * INTO c FROM governance_catalog.department_impact_case WHERE id=(t->>'caseId')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF c.campus IS DISTINCT FROM t->>'campus' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM department_master.evolution_snapshot(t->>'actor',c.event_id,c.campus);
 permission:=CASE WHEN operation='READ_CASE' THEN 'READ' WHEN operation='APPROVE' OR operation='PRIOR_COMMAND' AND t->>'commandOperation'='APPROVE' THEN 'REVIEW' ELSE 'WRITE' END;
 PERFORM department_master.impact_case_authorize(t->>'actor',c.obligation,c.campus,permission);
 SELECT * INTO latest FROM governance_catalog.department_impact_case_event WHERE case_id=c.id ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO assigned FROM governance_catalog.department_impact_case_event WHERE case_id=c.id AND kind='ASSIGN' ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO proposal FROM governance_catalog.department_impact_case_event WHERE case_id=c.id AND kind='PROPOSE' ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO approval FROM governance_catalog.department_impact_case_event WHERE case_id=c.id AND kind='APPROVE' ORDER BY sequence DESC LIMIT 1;
 IF operation='READ_CASE' THEN
  IF coalesce(latest.sequence,0)>1000 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;
  SELECT coalesce(jsonb_agg(governance_catalog.department_impact_event_json(id)||jsonb_build_object('actor',actor_code,'identity',actor_identity,'reason',reason,'recordedAt',to_char(recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'))||(history_event.payload-ARRAY['remainingSpans']) ORDER BY sequence),'[]') INTO history FROM governance_catalog.department_impact_case_event history_event WHERE case_id=c.id;
  RETURN jsonb_build_object('item',governance_catalog.department_impact_case_json(c.id),'history',history,'handoffs',governance_catalog.department_impact_handoffs(c.id));
 END IF;
 IF operation='ASSIGN' THEN responsibility:=governance_catalog.department_impact_responsibility(t->>'actor',(t->>'responsibilityId')::uuid,c.id,'READ');
 ELSE
  IF assigned.id IS NULL THEN RAISE EXCEPTION 'RESPONSIBILITY_NOT_READY';END IF;
  responsibility:=governance_catalog.department_impact_responsibility(t->>'actor',(assigned.payload->'responsibility'->>'id')::uuid,c.id,permission);
  IF responsibility IS DISTINCT FROM assigned.payload->'responsibility' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 END IF;
 SELECT * INTO prior FROM governance_catalog.department_impact_case_event WHERE actor_identity=identity AND request_id=(t->>'requestId')::uuid;
 IF FOUND THEN
  IF prior.case_id<>c.id OR prior.request_digest IS DISTINCT FROM t->>'requestDigest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
  RETURN governance_catalog.department_impact_event_json(prior.id);
 END IF;
 SELECT jsonb_build_object('result',o.result,'digest',o.input_digest) INTO old_outcome FROM vnext_control.outcome o JOIN vnext_control.request_identity r ON r.original_actor_code=o.actor_code AND r.request_id=o.request_id WHERE r.identity_code=identity AND r.request_id=(t->>'requestId')::uuid;
 IF FOUND THEN
  IF old_outcome->>'digest' IS DISTINCT FROM t->>'requestDigest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
  RETURN old_outcome->'result';
 END IF;
 IF operation='PRIOR_COMMAND' THEN RETURN NULL;END IF;
 IF coalesce(latest.sequence,0)::text IS DISTINCT FROM t->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
 IF operation='ASSIGN' THEN
  IF coalesce(latest.status,'OPEN')<>'OPEN' THEN RAISE EXCEPTION 'DISPOSITION_ALREADY_COMPLETE';END IF;
  payload:=jsonb_build_object('responsibility',responsibility);
 ELSIF operation='PROPOSE' THEN
  IF coalesce(latest.status,'OPEN')<>'OPEN' THEN RAISE EXCEPTION 'DISPOSITION_ALREADY_COMPLETE';END IF;
  IF t->'disposition'->>'kind'='MIGRATE_EXTERNAL' THEN
   IF c.obligation->>'kind'<>'EXTERNAL' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(t->'disposition'->'consumers') consumer WHERE NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=consumer AND active AND principal_kind='SERVICE')) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
  END IF;
  payload:=jsonb_build_object('disposition',t->'disposition','evidenceDigest',t->>'evidenceDigest');
 ELSIF operation='APPROVE' THEN
  IF proposal.id IS NULL OR proposal.id::text IS DISTINCT FROM t->>'proposalEventId' OR proposal.sequence<assigned.sequence THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
  IF proposal.actor_identity=identity THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
  IF department_master.impact_case_authorize(proposal.actor_code,c.obligation,c.campus,'WRITE') IS DISTINCT FROM proposal.actor_identity THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM governance_catalog.department_impact_responsibility(proposal.actor_code,(responsibility->>'id')::uuid,c.id,'WRITE');
  payload:=jsonb_build_object('proposalEventId',proposal.id);
  IF proposal.payload->'disposition'->>'kind'='MIGRATE_EXTERNAL' THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(proposal.payload->'disposition'->'consumers') consumer WHERE NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=consumer AND active AND principal_kind='SERVICE')) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
   payload:=payload||jsonb_build_object('consumerBindings',(SELECT jsonb_agg(jsonb_build_object('actor',code,'identity',identity_code) ORDER BY code) FROM vnext_control.actor WHERE proposal.payload->'disposition'->'consumers' ? code));
  END IF;
 ELSIF operation='RECHECK' THEN
  IF proposal.id IS NULL OR approval.payload->>'proposalEventId' IS DISTINCT FROM proposal.id::text OR proposal.sequence<assigned.sequence OR t->>'proposalEventId' IS DISTINCT FROM proposal.id::text THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
  IF department_master.impact_case_authorize(approval.actor_code,c.obligation,c.campus,'REVIEW') IS DISTINCT FROM approval.actor_identity THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM governance_catalog.department_impact_responsibility(approval.actor_code,(responsibility->>'id')::uuid,c.id,'REVIEW');
  IF c.obligation->>'kind'='REFERENCE' THEN
   IF jsonb_array_length(t->'remainingSpans')=0 THEN status:='RESOLVED';END IF;
  ELSE
   IF proposal.payload->'disposition'->>'kind'<>'MIGRATE_EXTERNAL' THEN RAISE EXCEPTION 'DISPOSITION_INCOMPLETE';END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(governance_catalog.department_impact_handoffs(c.id)) handoff WHERE handoff->>'status'<>'SIMULATED_COMPLETED') THEN status:='SIMULATED_COMPLETED';t:=t||jsonb_build_object('remainingSpans','[]'::jsonb);END IF;
  END IF;
  payload:=jsonb_build_object('remainingSpans',t->'remainingSpans','dependencyDigest',t->>'dependencyDigest','proposalEventId',proposal.id);
  IF latest.kind='RECHECK' AND latest.payload=payload AND latest.status=status THEN
   old_outcome:=governance_catalog.department_impact_event_json(latest.id);
   INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(t->>'actor',(t->>'requestId')::uuid,t->>'requestDigest',old_outcome);
   INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,(t->>'requestId')::uuid,t->>'actor');
   RETURN old_outcome;
  END IF;
 ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 INSERT INTO governance_catalog.department_impact_case_event(case_id,sequence,kind,actor_code,actor_identity,request_id,request_digest,reason,payload,status)
 VALUES(c.id,coalesce(latest.sequence,0)+1,operation,t->>'actor',identity,(t->>'requestId')::uuid,t->>'requestDigest',t->>'reason',payload,status) RETURNING * INTO created;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(t->>'actor',c.id,'DEPARTMENT_IMPACT_'||operation,'EXPLICIT_OWNER_ACTION',t->>'requestDigest');
 RETURN governance_catalog.department_impact_event_json(created.id);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.department_impact_command(jsonb) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION department_master.impact_successors(p_actor text,p_event uuid,p_campus text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM department_master.evolution_snapshot(p_actor,p_event,p_campus);
 RETURN (SELECT coalesce(jsonb_agg(DISTINCT to_department_id),'[]') FROM department_master.evolution_relation WHERE event_id=p_event);
END $$;
REVOKE ALL ON FUNCTION department_master.impact_successors(text,uuid,text) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION department_master.impact_result(p_actor text,p_ref jsonb,p_campus text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE snapshot jsonb;v jsonb;prior jsonb;outcome jsonb;expected_owner text;targets jsonb;action text;safe_shrink boolean:=false;previous_view department_master.hierarchy_view_version;
 candidate department_master.hierarchy_candidate;view_version department_master.hierarchy_view_version;closure department_master.hierarchy_closure;
BEGIN
 PERFORM department_master.evolution_authorize(p_actor,p_campus,'READ');
 IF p_ref->>'owner'='SOURCE_MAPPING' THEN
  snapshot:=department_master.mapping_snapshot(p_actor,(p_ref->>'id')::uuid);
  IF snapshot->>'campus' IS DISTINCT FROM p_campus THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  v:=snapshot->'versions'->-1;expected_owner:='department-master/organization-mapping';
  PERFORM department_master.mapping_target_authorize(p_actor,v->>'target_type',(v->>'target_id')::uuid,p_campus);
  PERFORM department_master.evolution_source_authorize(p_actor,(snapshot->>'from_system_id')::uuid);
  targets:=jsonb_build_array(v->'target_id');
  prior:=snapshot->'versions'->-2;
  safe_shrink:=coalesce(v->>'action'='CORRECT' AND prior->>'action'<>'RETRACT'
   AND v->>'target_type'=prior->>'target_type' AND v->>'target_id'=prior->>'target_id'
   AND (v->>'valid_from')::timestamp>=(prior->>'valid_from')::timestamp
   AND (prior->>'valid_to' IS NULL OR (v->>'valid_to')::timestamp<=(prior->>'valid_to')::timestamp)
   AND v->'facts'->'sourceName' IS NOT DISTINCT FROM prior->'facts'->'sourceName'
   AND v->'facts'->'resolutionRule' IS NOT DISTINCT FROM prior->'facts'->'resolutionRule'
   AND v->'facts'->'sourceSystemId' IS NOT DISTINCT FROM prior->'facts'->'sourceSystemId',false);
 ELSIF p_ref->>'owner'='IDENTIFIER' THEN
  snapshot:=department_master.identifier_snapshot(p_actor,(p_ref->>'id')::uuid,p_campus);
  v:=snapshot->'versions'->-1;expected_owner:='department-master/organization-identifier';targets:=jsonb_build_array(snapshot->'target_id');
  prior:=snapshot->'versions'->-2;
  safe_shrink:=coalesce(v->>'action'='CORRECT' AND prior->>'action'<>'RETRACT'
   AND v->>'value'=prior->>'value' AND v->>'language'=prior->>'language' AND v->'preferred'=prior->'preferred'
   AND v->'facts'->'sourceSystemId' IS NOT DISTINCT FROM prior->'facts'->'sourceSystemId'
   AND (v->>'valid_from')::timestamp>=(prior->>'valid_from')::timestamp
   AND (prior->>'valid_to' IS NULL OR (v->>'valid_to')::timestamp<=(prior->>'valid_to')::timestamp),false);
 ELSIF p_ref->>'owner'='HIERARCHY' THEN
  PERFORM department_master.hierarchy_authorize(p_actor,(p_ref->>'id')::uuid,'READ');
  SELECT * INTO candidate FROM department_master.hierarchy_candidate WHERE id=(p_ref->>'candidateId')::uuid AND view_id=(p_ref->>'id')::uuid AND request_id=(p_ref->>'requestId')::uuid AND status='APPLIED';
  IF NOT FOUND THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  SELECT * INTO view_version FROM department_master.hierarchy_view_version WHERE view_id=candidate.view_id ORDER BY version_no DESC LIMIT 1;
  IF view_version.id::text IS DISTINCT FROM p_ref->>'versionId' THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  PERFORM department_master.evolution_source_authorize(p_actor,view_version.source_system_id);
  -- A close/revoke has its own candidate. The historical publishing proof
  -- must not hide the current view closure, nor prove a different publication.
  SELECT * INTO closure FROM department_master.hierarchy_closure WHERE view_id=candidate.view_id AND version_no=view_version.version_no;
  IF candidate.id IS DISTINCT FROM closure.candidate_id AND view_version.content_digest IS DISTINCT FROM candidate.payload->>'validationDigest' THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
  action:=coalesce(closure.status,'PUBLISHED');
  SELECT * INTO previous_view FROM department_master.hierarchy_view_version WHERE view_id=candidate.view_id AND status='PUBLISHED' AND version_no<view_version.version_no ORDER BY version_no DESC LIMIT 1;
  IF FOUND AND action='PUBLISHED' THEN
   safe_shrink:=view_version.valid_from>=previous_view.valid_from AND (previous_view.valid_to IS NULL OR view_version.valid_to<=previous_view.valid_to)
    AND (to_jsonb(view_version)-ARRAY['id','version_no','recorded_at','created_at','approved_by','approved_identity','maker','maker_identity','content_digest','valid_from','valid_to'])=(to_jsonb(previous_view)-ARRAY['id','version_no','recorded_at','created_at','approved_by','approved_identity','maker','maker_identity','content_digest','valid_from','valid_to'])
    AND (SELECT jsonb_agg((to_jsonb(n)-ARRAY['node_id','view_version_id','source_evidence'])||jsonb_build_object('source_evidence',n.source_evidence-ARRAY['validFrom','validTo']) ORDER BY n.node_key) FROM department_master.hierarchy_node n WHERE view_version_id=view_version.id)
       =(SELECT jsonb_agg((to_jsonb(n)-ARRAY['node_id','view_version_id','source_evidence'])||jsonb_build_object('source_evidence',n.source_evidence-ARRAY['validFrom','validTo']) ORDER BY n.node_key) FROM department_master.hierarchy_node n WHERE view_version_id=previous_view.id);
  END IF;
  SELECT coalesce(jsonb_agg(DISTINCT department_id),'[]') INTO targets FROM department_master.hierarchy_node WHERE view_version_id=view_version.id AND department_id IS NOT NULL;
  IF view_version.owner_department_id IS NOT NULL THEN targets:=targets||jsonb_build_array(view_version.owner_department_id);END IF;
  RETURN jsonb_build_object('owner','HIERARCHY','id',candidate.view_id,'versionId',view_version.id,'departmentIds',targets,'period',jsonb_build_object('from',to_char(view_version.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(view_version.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US')),'action',action,'safeShrink',coalesce(safe_shrink,false));
 ELSE RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 IF v IS NULL OR v->>'id' IS DISTINCT FROM p_ref->>'versionId' THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 PERFORM department_master.evolution_source_authorize(p_actor,(v->'facts'->>'sourceSystemId')::uuid);
 outcome:=governance_catalog.department_impact_committed_result(p_actor,(p_ref->>'candidateId')::uuid,(p_ref->>'requestId')::uuid);
 IF outcome->>'status' IS DISTINCT FROM 'COMMITTED' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(outcome->'facts') fact WHERE fact->>'owner'=expected_owner AND fact->>'id'=p_ref->>'id' AND fact->>'version'=v->>'number') THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 RETURN jsonb_build_object('owner',p_ref->>'owner','id',p_ref->>'id','versionId',p_ref->>'versionId','departmentIds',targets,'period',jsonb_build_object('from',to_char((v->>'valid_from')::timestamp,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char((v->>'valid_to')::timestamp,'YYYY-MM-DD"T"HH24:MI:SS.US')),'action',v->>'action','safeShrink',safe_shrink);
END $$;
REVOKE ALL ON FUNCTION department_master.impact_result(text,jsonb,text) FROM PUBLIC,hdi_prototype;

-- An independent reviewer needs the accepted result, not the executor's personal replay namespace.
CREATE FUNCTION governance_catalog.department_impact_committed_result(p_actor text,p_candidate uuid,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate jsonb;result jsonb;
BEGIN
 candidate:=governance_catalog.apply_record(p_actor,'READ_CANDIDATE',jsonb_build_object('candidateId',p_candidate));
 IF candidate->'input'->>'requestId' IS DISTINCT FROM p_request::text THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 SELECT o.result INTO result FROM governance_catalog.apply_commit c JOIN vnext_control.outcome o ON o.actor_code=c.actor_code AND o.request_id=c.request_id WHERE c.candidate_id=p_candidate AND c.request_id=p_request;
 IF result IS NULL THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.department_impact_committed_result(text,uuid,uuid) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.department_impact_handoffs(p_case uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH proposal AS(SELECT * FROM governance_catalog.department_impact_case_event WHERE case_id=p_case AND kind='PROPOSE' ORDER BY sequence DESC LIMIT 1),
 approval AS(SELECT * FROM governance_catalog.department_impact_case_event WHERE case_id=p_case AND kind='APPROVE' ORDER BY sequence DESC LIMIT 1)
 SELECT coalesce(jsonb_agg(jsonb_build_object('consumerActor',consumer,'proposalEventId',p.id,'status',coalesce(receipt.payload->'receipt'->>'outcome','PENDING'),'simulated',true) ORDER BY consumer),'[]')
 FROM proposal p JOIN approval a ON a.payload->>'proposalEventId'=p.id::text CROSS JOIN LATERAL jsonb_array_elements_text(p.payload->'disposition'->'consumers') consumer
 LEFT JOIN LATERAL(SELECT payload FROM governance_catalog.department_impact_case_event WHERE case_id=p_case AND kind='RECEIPT' AND payload->>'proposalEventId'=p.id::text AND payload->'receipt'->>'consumerActor'=consumer ORDER BY sequence DESC LIMIT 1) receipt ON true
 WHERE p.payload->'disposition'->>'kind'='MIGRATE_EXTERNAL';
$$;
REVOKE ALL ON FUNCTION governance_catalog.department_impact_handoffs(uuid) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.department_impact_receipt(t jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c governance_catalog.department_impact_case;proposal governance_catalog.department_impact_case_event;approval governance_catalog.department_impact_case_event;
 assigned governance_catalog.department_impact_case_event;latest governance_catalog.department_impact_case_event;prior governance_catalog.department_impact_case_event;created governance_catalog.department_impact_case_event;binding jsonb;handoff jsonb;
BEGIN
 SELECT * INTO c FROM governance_catalog.department_impact_case WHERE id=(t->>'caseId')::uuid;
 IF NOT FOUND OR c.campus IS DISTINCT FROM t->>'campus' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 SELECT * INTO proposal FROM governance_catalog.department_impact_case_event WHERE case_id=c.id AND kind='PROPOSE' ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO approval FROM governance_catalog.department_impact_case_event WHERE case_id=c.id AND kind='APPROVE' ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO assigned FROM governance_catalog.department_impact_case_event WHERE case_id=c.id AND kind='ASSIGN' ORDER BY sequence DESC LIMIT 1;
 IF c.obligation->>'kind'<>'EXTERNAL' OR proposal.payload->'disposition'->>'kind' IS DISTINCT FROM 'MIGRATE_EXTERNAL' OR approval.payload->>'proposalEventId' IS DISTINCT FROM proposal.id::text OR proposal.sequence<assigned.sequence THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 SELECT value INTO binding FROM jsonb_array_elements(approval.payload->'consumerBindings') WHERE value->>'actor'=t->>'actor';
 IF binding IS NULL OR binding->>'identity' IS DISTINCT FROM t->>'identity' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF department_master.impact_case_authorize(approval.actor_code,c.obligation,c.campus,'REVIEW') IS DISTINCT FROM approval.actor_identity THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF governance_catalog.department_impact_responsibility(approval.actor_code,(assigned.payload->'responsibility'->>'id')::uuid,c.id,'REVIEW') IS DISTINCT FROM assigned.payload->'responsibility' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 SELECT * INTO latest FROM governance_catalog.department_impact_case_event WHERE case_id=c.id ORDER BY sequence DESC LIMIT 1;
 IF t->>'operation'='READ_HANDOFF' THEN
  SELECT value INTO handoff FROM jsonb_array_elements(governance_catalog.department_impact_handoffs(c.id)) WHERE value->>'consumerActor'=t->>'actor';
  RETURN handoff||jsonb_build_object('caseId',c.id,'eventId',c.event_id,'head',latest.sequence::text);
 END IF;
 IF t->>'consumerActor' IS DISTINCT FROM t->>'actor' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF t->>'proposalEventId' IS DISTINCT FROM proposal.id::text THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 SELECT * INTO prior FROM governance_catalog.department_impact_case_event WHERE actor_identity=t->>'identity' AND request_id=(t->>'requestId')::uuid;
 IF FOUND THEN IF prior.case_id<>c.id OR prior.request_digest IS DISTINCT FROM t->>'requestDigest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;RETURN governance_catalog.department_impact_event_json(prior.id);END IF;
 IF latest.sequence::text IS DISTINCT FROM t->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
 IF t->>'outcome' NOT IN ('FAILED','PARTIAL','SIMULATED_COMPLETED') OR t->'simulated' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 INSERT INTO governance_catalog.department_impact_case_event(case_id,sequence,kind,actor_code,actor_identity,request_id,request_digest,reason,payload,status)
 VALUES(c.id,latest.sequence+1,'RECEIPT',t->>'actor',t->>'identity',(t->>'requestId')::uuid,t->>'requestDigest',t->>'reason',jsonb_build_object('proposalEventId',proposal.id,'receipt',jsonb_build_object('consumerActor',t->>'actor','outcome',t->>'outcome','receiptRef',t->>'receiptRef','simulated',true)),'OPEN') RETURNING * INTO created;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(t->>'actor',c.id,'DEPARTMENT_IMPACT_RECEIPT','SIMULATED_RECEIPT',t->>'requestDigest');
 RETURN governance_catalog.department_impact_event_json(created.id);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.department_impact_receipt(jsonb) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION department_master.impact_reference_access(p_actor text,p_ref jsonb,p_campus text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m department_master.organization_mapping;mv department_master.organization_mapping_version;
 i department_master.organization_identifier;iv department_master.organization_identifier_version;
 h department_master.hierarchy_view_version;n department_master.hierarchy_node;
BEGIN
 PERFORM department_master.evolution_authorize(p_actor,p_campus,'READ');
 IF p_ref->>'owner'='SOURCE_MAPPING' THEN
  SELECT * INTO m FROM department_master.organization_mapping WHERE id=(p_ref->>'id')::uuid;
  SELECT * INTO mv FROM department_master.organization_mapping_version WHERE id=(p_ref->>'versionId')::uuid AND mapping_id=m.id AND target_type='ORG' AND target_id=(p_ref->>'departmentId')::uuid;
  IF NOT FOUND OR m.campus<>p_campus THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM department_master.mapping_authorize(p_actor,m.from_system_id,m.entity_type,m.context,m.campus,'READ');
  PERFORM department_master.mapping_target_authorize(p_actor,'ORG',mv.target_id,p_campus);
  PERFORM department_master.evolution_source_authorize(p_actor,m.from_system_id);
  PERFORM department_master.evolution_source_authorize(p_actor,(mv.facts->>'sourceSystemId')::uuid);
 ELSIF p_ref->>'owner'='IDENTIFIER' THEN
  SELECT * INTO i FROM department_master.organization_identifier WHERE id=(p_ref->>'id')::uuid AND target_type='ORG' AND target_id=(p_ref->>'departmentId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  SELECT * INTO iv FROM department_master.organization_identifier_version WHERE id=(p_ref->>'versionId')::uuid AND identifier_id=i.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM department_master.identifier_authorize(p_actor,i.scheme,p_campus,'READ');
  PERFORM department_master.mapping_target_authorize(p_actor,'ORG',i.target_id,p_campus);
  PERFORM department_master.evolution_source_authorize(p_actor,(iv.facts->>'sourceSystemId')::uuid);
 ELSIF p_ref->>'owner'='HIERARCHY' THEN
  SELECT * INTO h FROM department_master.hierarchy_view_version WHERE id=(p_ref->>'versionId')::uuid AND view_id=(p_ref->>'id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM department_master.hierarchy_authorize(p_actor,h.view_id,'READ');
  PERFORM department_master.evolution_source_authorize(p_actor,h.source_system_id);
  SELECT * INTO n FROM department_master.hierarchy_node WHERE view_version_id=h.id AND department_id=(p_ref->>'departmentId')::uuid;
  IF FOUND THEN PERFORM department_master.evolution_source_authorize(p_actor,(n.source_evidence->>'sourceSystemId')::uuid);
  ELSIF h.owner_department_id IS DISTINCT FROM (p_ref->>'departmentId')::uuid THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 ELSE RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
END $$;
REVOKE ALL ON FUNCTION department_master.impact_reference_access(text,jsonb,text) FROM PUBLIC,hdi_prototype;
