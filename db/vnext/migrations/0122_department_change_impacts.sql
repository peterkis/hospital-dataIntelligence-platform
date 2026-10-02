SELECT pg_advisory_xact_lock(901002);

-- A bounded, authorized reverse reader belongs to the Department Owner.
-- It preserves accepted versions separately from each object's current head.
CREATE FUNCTION department_master.impact_references(p_actor text,p_departments jsonb,p_campus text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row record; latest record; result jsonb:='[]'; snapshot jsonb; target uuid;
BEGIN
 PERFORM department_master.evolution_authorize(p_actor,p_campus,'READ');
 IF jsonb_typeof(p_departments)<>'array' OR jsonb_array_length(p_departments) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR target IN SELECT value::uuid FROM jsonb_array_elements_text(p_departments) LOOP PERFORM department_master.snapshot(p_actor,target);END LOOP;
 FOR row IN SELECT v.*,m.campus,m.from_system_id FROM department_master.organization_mapping_version v JOIN department_master.organization_mapping m ON m.id=v.mapping_id
 WHERE v.target_type='ORG' AND v.target_id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_departments)) ORDER BY v.mapping_id,v.number LOOP
  IF row.campus<>p_campus THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  snapshot:=department_master.mapping_snapshot(p_actor,row.mapping_id);
  PERFORM department_master.mapping_target_authorize(p_actor,'ORG',row.target_id,p_campus);
  PERFORM department_master.evolution_source_authorize(p_actor,row.from_system_id);
  PERFORM department_master.evolution_source_authorize(p_actor,(row.facts->>'sourceSystemId')::uuid);
  SELECT * INTO latest FROM department_master.organization_mapping_version WHERE mapping_id=row.mapping_id ORDER BY number DESC LIMIT 1;
  PERFORM department_master.mapping_target_authorize(p_actor,latest.target_type,latest.target_id,p_campus);
  PERFORM department_master.evolution_source_authorize(p_actor,(latest.facts->>'sourceSystemId')::uuid);
  result:=result||jsonb_build_array(jsonb_build_object('owner','SOURCE_MAPPING','sourceSystemIds',jsonb_build_array(row.from_system_id,row.facts->>'sourceSystemId'),'referenceRole','TARGET','id',row.mapping_id,'versionId',row.id,'version',row.number::text,'departmentId',row.target_id,'departmentVersionId',NULL,'acceptedVersions',coalesce(row.facts->'target'->'parts','[]'),
   'originalPeriod',jsonb_build_object('from',to_char(row.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(row.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US')),'originalDigest',row.content_digest,'frozenLabel',NULL,
   'currentVersionId',latest.id,'currentPeriod',jsonb_build_object('from',to_char(latest.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(latest.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US')),'currentAction',latest.action,'currentTargetId',latest.target_id,'currentReferencesDepartment',latest.target_type='ORG' AND latest.target_id=row.target_id,'current',row.id=latest.id));
  IF jsonb_array_length(result)>2000 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;
 END LOOP;
 FOR row IN SELECT v.*,m.target_id,m.scheme FROM department_master.organization_identifier_version v JOIN department_master.organization_identifier m ON m.id=v.identifier_id
 WHERE m.target_type='ORG' AND m.target_id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_departments)) ORDER BY v.identifier_id,v.number LOOP
  snapshot:=department_master.identifier_snapshot(p_actor,row.identifier_id,p_campus);
  IF row.facts ? 'sourceSystemId' THEN PERFORM department_master.evolution_source_authorize(p_actor,(row.facts->>'sourceSystemId')::uuid);END IF;
  SELECT * INTO latest FROM department_master.organization_identifier_version WHERE identifier_id=row.identifier_id ORDER BY number DESC LIMIT 1;
  IF latest.facts ? 'sourceSystemId' THEN PERFORM department_master.evolution_source_authorize(p_actor,(latest.facts->>'sourceSystemId')::uuid);END IF;
  result:=result||jsonb_build_array(jsonb_build_object('owner','IDENTIFIER','sourceSystemIds',CASE WHEN row.facts ? 'sourceSystemId' THEN jsonb_build_array(row.facts->>'sourceSystemId') ELSE '[]'::jsonb END,'referenceRole','TARGET','id',row.identifier_id,'versionId',row.id,'version',row.number::text,'departmentId',row.target_id,'departmentVersionId',row.legacy_version_id,'acceptedVersions',coalesce(row.facts->'target'->'parts','[]'),
   'originalPeriod',jsonb_build_object('from',to_char(row.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(row.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US')),'originalDigest',row.content_digest,'frozenLabel',NULL,
   'currentVersionId',latest.id,'currentPeriod',jsonb_build_object('from',to_char(latest.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(latest.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US')),'currentAction',latest.action,'currentTargetId',row.target_id,'currentReferencesDepartment',true,'current',row.id=latest.id));
  IF jsonb_array_length(result)>2000 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;
 END LOOP;
 FOR row IN SELECT v.*,n.department_id,n.department_version_id,n.display_name,n.node_key,n.source_evidence FROM department_master.hierarchy_view_version v
 JOIN department_master.hierarchy_node n ON n.view_version_id=v.id WHERE v.status='PUBLISHED' AND n.department_id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_departments)) ORDER BY v.view_id,v.version_no,n.node_key LOOP
  snapshot:=department_master.hierarchy_read(p_actor,'SNAPSHOT',jsonb_build_object('viewId',row.view_id,'version',row.version_no::text));
  PERFORM department_master.evolution_source_authorize(p_actor,row.source_system_id);
  SELECT * INTO latest FROM department_master.hierarchy_view_version WHERE view_id=row.view_id ORDER BY version_no DESC LIMIT 1;
  PERFORM department_master.evolution_source_authorize(p_actor,latest.source_system_id);
  result:=result||jsonb_build_array(jsonb_build_object('owner','HIERARCHY','sourceSystemIds',jsonb_build_array(row.source_system_id,row.source_evidence->>'sourceSystemId'),'referenceRole','NODE','id',row.view_id,'versionId',row.id,'version',row.version_no::text,'departmentId',row.department_id,'departmentVersionId',row.department_version_id,'acceptedVersions',jsonb_build_array(jsonb_build_object('versionId',row.department_version_id,'version',(SELECT number::text FROM department_master.version WHERE id=row.department_version_id),'from',to_char(row.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(row.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'))),
   'originalPeriod',jsonb_build_object('from',to_char(row.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(row.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US')),'originalDigest',row.content_digest,'frozenLabel',row.display_name,
   'currentVersionId',latest.id,'currentPeriod',jsonb_build_object('from',to_char(latest.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(latest.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US')),'currentAction',coalesce((SELECT status FROM department_master.hierarchy_closure WHERE view_id=row.view_id),latest.status),'currentTargetId',row.department_id,'currentReferencesDepartment',EXISTS(SELECT 1 FROM department_master.hierarchy_node WHERE view_version_id=latest.id AND department_id=row.department_id),'current',row.id=latest.id));
  IF jsonb_array_length(result)>2000 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;
 END LOOP;
 FOR row IN SELECT * FROM department_master.hierarchy_view_version WHERE status='PUBLISHED' AND owner_department_id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_departments)) ORDER BY view_id,version_no LOOP
  snapshot:=department_master.hierarchy_read(p_actor,'SNAPSHOT',jsonb_build_object('viewId',row.view_id,'version',row.version_no::text));
  PERFORM department_master.evolution_source_authorize(p_actor,row.source_system_id);
  SELECT * INTO latest FROM department_master.hierarchy_view_version WHERE view_id=row.view_id ORDER BY version_no DESC LIMIT 1;
  PERFORM department_master.evolution_source_authorize(p_actor,latest.source_system_id);
  result:=result||jsonb_build_array(jsonb_build_object('owner','HIERARCHY','sourceSystemIds',jsonb_build_array(row.source_system_id),'referenceRole','OWNER','id',row.view_id,'versionId',row.id,'version',row.version_no::text,'departmentId',row.owner_department_id,'departmentVersionId',row.owner_department_version_id,
   'acceptedVersions',jsonb_build_array(jsonb_build_object('versionId',row.owner_department_version_id,'version',(SELECT number::text FROM department_master.version WHERE id=row.owner_department_version_id),'from',to_char(row.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(row.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'))),
   'originalPeriod',jsonb_build_object('from',to_char(row.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(row.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US')),'originalDigest',row.content_digest,'frozenLabel',(SELECT facts->>'name' FROM department_master.version WHERE id=row.owner_department_version_id),
   'currentVersionId',latest.id,'currentPeriod',jsonb_build_object('from',to_char(latest.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(latest.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US')),'currentAction',coalesce((SELECT status FROM department_master.hierarchy_closure WHERE view_id=row.view_id),latest.status),'currentTargetId',coalesce(latest.owner_department_id,row.owner_department_id),'currentReferencesDepartment',latest.owner_department_id IS NOT DISTINCT FROM row.owner_department_id,'current',row.id=latest.id));
  IF jsonb_array_length(result)>2000 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION department_master.impact_references(text,jsonb,text) FROM PUBLIC,hdi_prototype;

CREATE TABLE governance_catalog.department_impact_assessment(
 id uuid PRIMARY KEY DEFAULT uuidv7(),
 actor_identity text NOT NULL,request_id uuid NOT NULL,request_digest text NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 input_id uuid NOT NULL REFERENCES department_master.evolution_input(id),
 target_kind text NOT NULL CHECK(target_kind IN ('INPUT','EVENT')),target_id uuid NOT NULL,
 campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=524288),
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 UNIQUE(actor_identity,request_id)
);
CREATE TRIGGER department_impact_assessment_immutable BEFORE UPDATE OR DELETE ON governance_catalog.department_impact_assessment FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
REVOKE ALL ON governance_catalog.department_impact_assessment FROM PUBLIC,hdi_prototype;

-- The Owner authenticates its own ticket; Catalog never reads the Owner's key table.
CREATE FUNCTION department_master.impact_ticket_authorize(p_ticket text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;identity text;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.department_write_authority WHERE singleton;
 IF secret IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF t->>'operation' IN ('RECEIPT','READ_HANDOFF') THEN
  identity:=vnext_control.authorize(t->>'actor','SYNTHETIC',CASE WHEN t->>'operation'='RECEIPT' THEN 'WRITE' ELSE 'READ' END);
  IF NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code=t->>'actor' AND principal_kind='SERVICE' AND active) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 ELSE identity:=department_master.evolution_authorize(t->>'actor',t->>'campus','READ');END IF;
 RETURN t||jsonb_build_object('identity',identity);
END $$;
REVOKE ALL ON FUNCTION department_master.impact_ticket_authorize(text,text) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.department_impact_binding(p_id uuid,p_input uuid,p_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r governance_catalog.department_impact_assessment;
BEGIN
 SELECT * INTO r FROM governance_catalog.department_impact_assessment WHERE id=p_id;
 IF NOT FOUND OR r.input_id<>p_input OR r.target_kind<>'INPUT' OR r.content->>'dependencyDigest' IS DISTINCT FROM p_digest THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 RETURN r.content;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.department_impact_binding(uuid,uuid,text) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION department_master.evolution_impact_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE assessment jsonb;departments jsonb;expected jsonb;actual jsonb;reviewer text;
BEGIN
 IF coalesce(NEW.facts->'impactAssessment'->>'id','')='' THEN RAISE EXCEPTION 'IMPACT_ASSESSMENT_REQUIRED';END IF;
 assessment:=governance_catalog.department_impact_binding((NEW.facts->'impactAssessment'->>'id')::uuid,NEW.input_id,NEW.facts->'impactAssessment'->>'digest');
 departments:=assessment->'departmentIds';
 SELECT actor INTO reviewer FROM department_master.evolution_verification WHERE id=(NEW.facts->>'verificationId')::uuid AND input_id=NEW.input_id;
 IF reviewer IS NULL THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 actual:=department_master.impact_references(reviewer,departments,NEW.campus);
 SELECT coalesce(jsonb_agg(value-ARRAY['change','constraint','reason','affectedSpans'] ORDER BY ord),'[]') INTO expected FROM jsonb_array_elements(assessment->'references') WITH ORDINALITY a(value,ord);
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(assessment->'references') ref WHERE ref->>'owner' IN ('SOURCE_MAPPING','HIERARCHY') AND ref->>'constraint'='UNSATISFIED' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.facts->'impacts') declaration WHERE declaration->>'domain'=ref->>'owner' AND declaration->>'determination'='AFFECTED')) THEN RAISE EXCEPTION 'IMPACT_DECLARATION_CONFLICT';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER evolution_impact_guard BEFORE INSERT ON department_master.evolution_event FOR EACH ROW EXECUTE FUNCTION department_master.evolution_impact_guard();
REVOKE ALL ON FUNCTION department_master.evolution_impact_guard() FROM PUBLIC,hdi_prototype;

CREATE TABLE governance_catalog.department_impact_case(
 id uuid PRIMARY KEY DEFAULT uuidv7(),event_id uuid NOT NULL REFERENCES department_master.evolution_event(id),
 assessment_id uuid NOT NULL REFERENCES governance_catalog.department_impact_assessment(id),
 reference_key text NOT NULL,campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),
 obligation jsonb NOT NULL CHECK(jsonb_typeof(obligation)='object' AND octet_length(obligation::text)<=32768),
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),UNIQUE(event_id,reference_key)
);
CREATE TABLE governance_catalog.department_impact_case_event(
 id uuid PRIMARY KEY DEFAULT uuidv7(),case_id uuid NOT NULL REFERENCES governance_catalog.department_impact_case(id),
 sequence bigint NOT NULL CHECK(sequence>0),kind text NOT NULL CHECK(kind IN ('ASSIGN','PROPOSE','APPROVE','RECHECK','RECEIPT')),
 actor_code text NOT NULL,actor_identity text NOT NULL,request_id uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=32768),
 status text NOT NULL CHECK(status IN ('OPEN','RESOLVED','SIMULATED_COMPLETED')),
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 UNIQUE(case_id,sequence),UNIQUE(actor_identity,request_id)
);
CREATE TRIGGER department_impact_case_immutable BEFORE UPDATE OR DELETE ON governance_catalog.department_impact_case FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE TRIGGER department_impact_case_event_immutable BEFORE UPDATE OR DELETE ON governance_catalog.department_impact_case_event FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
REVOKE ALL ON governance_catalog.department_impact_case,governance_catalog.department_impact_case_event FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.open_department_impacts(p_event uuid,p_assessment uuid,p_campus text,p_at timestamp,p_impacts jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE assessment governance_catalog.department_impact_assessment;item jsonb;key text;
BEGIN
 SELECT * INTO assessment FROM governance_catalog.department_impact_assessment WHERE id=p_assessment;
 IF NOT FOUND OR assessment.campus<>p_campus THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(assessment.content->'references') WHERE (value->>'current')::boolean LOOP
  key:=item->>'owner'||':'||(item->>'id')||':'||(item->>'versionId')||':'||(item->>'departmentId')||':'||(item->>'referenceRole');
  INSERT INTO governance_catalog.department_impact_case(event_id,assessment_id,reference_key,campus,obligation,recorded_at)
  VALUES(p_event,p_assessment,key,p_campus,jsonb_build_object('kind','REFERENCE','owner',item->>'owner','reference',item,'affectedSpans',item->'affectedSpans'),p_at) ON CONFLICT(event_id,reference_key) DO NOTHING;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_impacts) WHERE value->>'determination'='AFFECTED' AND value->>'domain' IN ('PERSONNEL','PATIENT','ACCOUNT','INVENTORY','FINANCE','CONSUMER') LOOP
  INSERT INTO governance_catalog.department_impact_case(event_id,assessment_id,reference_key,campus,obligation,recorded_at)
  VALUES(p_event,p_assessment,'EXTERNAL:'||(item->>'domain'),p_campus,jsonb_build_object('kind','EXTERNAL','owner',item->>'domain','materialId',item->'evidenceId','ownerRole',item->>'ownerRole','ownerSignatory',item->>'ownerSignatory','decisionRef',item->>'ownerDecisionRef','requiredAction',item->>'requiredAction','affectedSpans',jsonb_build_array(jsonb_build_object('from',assessment.content->>'effectiveAt','to',NULL))),p_at) ON CONFLICT(event_id,reference_key) DO NOTHING;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.open_department_impacts(uuid,uuid,text,timestamp,jsonb) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION department_master.record_evolution_impacts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM governance_catalog.open_department_impacts(NEW.id,(NEW.facts->'impactAssessment'->>'id')::uuid,NEW.campus,NEW.recorded_at,NEW.facts->'impacts');
 RETURN NEW;
END $$;
CREATE TRIGGER record_evolution_impacts AFTER INSERT ON department_master.evolution_event FOR EACH ROW EXECUTE FUNCTION department_master.record_evolution_impacts();
REVOKE ALL ON FUNCTION department_master.record_evolution_impacts() FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.department_impact_case_json(p_case uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',c.id,'eventId',c.event_id,'assessmentId',c.assessment_id,'observationBasis',CASE WHEN a.target_kind='INPUT' THEN 'FROZEN_APPROVAL' ELSE 'LATER_OBSERVATION' END,'campus',c.campus,'obligation',c.obligation,'head',coalesce(e.sequence,0)::text,'status',coalesce(e.status,'OPEN'),'recordedAt',to_char(c.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'))
 FROM governance_catalog.department_impact_case c JOIN governance_catalog.department_impact_assessment a ON a.id=c.assessment_id LEFT JOIN LATERAL(SELECT sequence,status FROM governance_catalog.department_impact_case_event WHERE case_id=c.id ORDER BY sequence DESC LIMIT 1)e ON true WHERE c.id=p_case;
$$;
REVOKE ALL ON FUNCTION governance_catalog.department_impact_case_json(uuid) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.department_impact_record(p_ticket text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=department_master.impact_ticket_authorize(p_ticket,p_signature);r governance_catalog.department_impact_assessment;items jsonb;total integer;pending integer;simulated integer;access_case record;
BEGIN
 IF t->>'operation'='READ_ASSESSMENT' THEN
  SELECT * INTO r FROM governance_catalog.department_impact_assessment WHERE id=(t->>'assessmentId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  IF r.campus IS DISTINCT FROM t->>'campus' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM department_master.evolution_input_read(t->>'actor',r.input_id,'READ_RESTRICTED');
  RETURN r.content||jsonb_build_object('assessmentId',r.id,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
 END IF;
 IF t->>'operation'='LIST_ASSESSMENTS' THEN
  PERFORM department_master.evolution_input_read(t->>'actor',(t->>'inputId')::uuid,'READ_RESTRICTED');
  SELECT coalesce(jsonb_agg(content||jsonb_build_object('assessmentId',id,'recordedAt',to_char(recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')) ORDER BY id),'[]') INTO items
  FROM(SELECT * FROM governance_catalog.department_impact_assessment WHERE input_id=(t->>'inputId')::uuid AND campus=t->>'campus' AND (t->>'after' IS NULL OR id>(t->>'after')::uuid) ORDER BY id LIMIT coalesce((t->>'limit')::integer,50)) q;
  RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN jsonb_array_length(items)=coalesce((t->>'limit')::integer,50) THEN items->-1->>'assessmentId' END);
 END IF;
 IF t->>'operation'='LIST_CASES' THEN
  PERFORM department_master.evolution_snapshot(t->>'actor',(t->>'eventId')::uuid,t->>'campus');
  FOR access_case IN SELECT obligation,campus FROM governance_catalog.department_impact_case WHERE event_id=(t->>'eventId')::uuid LOOP PERFORM department_master.impact_case_authorize(t->>'actor',access_case.obligation,access_case.campus,'READ');END LOOP;
  SELECT count(*),count(*) FILTER(WHERE governance_catalog.department_impact_case_json(id)->>'status'='OPEN'),count(*) FILTER(WHERE governance_catalog.department_impact_case_json(id)->>'status'='SIMULATED_COMPLETED') INTO total,pending,simulated FROM governance_catalog.department_impact_case WHERE event_id=(t->>'eventId')::uuid;
  SELECT coalesce(jsonb_agg(governance_catalog.department_impact_case_json(id) ORDER BY id),'[]') INTO items FROM (SELECT id FROM governance_catalog.department_impact_case WHERE event_id=(t->>'eventId')::uuid AND (t->>'after' IS NULL OR id>(t->>'after')::uuid) ORDER BY id LIMIT coalesce((t->>'limit')::integer,50)) q;
  RETURN jsonb_build_object('items',items,'total',total,'unresolved',pending,'simulatedCompleted',simulated,'nextCursor',CASE WHEN jsonb_array_length(items)=coalesce((t->>'limit')::integer,50) THEN items->-1->>'id' END);
 END IF;
 IF t->>'operation' IN ('RECEIPT','READ_HANDOFF') THEN RETURN governance_catalog.department_impact_receipt(t);END IF;
 IF t->>'operation'<>'ASSESS' THEN RETURN governance_catalog.department_impact_command(t);END IF;
 SELECT * INTO r FROM governance_catalog.department_impact_assessment WHERE actor_identity=t->>'identity' AND request_id=(t->>'requestId')::uuid;
 IF FOUND THEN IF r.request_digest IS DISTINCT FROM t->>'requestDigest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
 ELSE
  INSERT INTO governance_catalog.department_impact_assessment(actor_identity,request_id,request_digest,input_id,target_kind,target_id,campus,content)
  VALUES(t->>'identity',(t->>'requestId')::uuid,t->>'requestDigest',(t->'assessment'->>'inputId')::uuid,t->'target'->>'kind',(t->'target'->>'id')::uuid,t->>'campus',t->'assessment') RETURNING * INTO r;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(t->>'actor',r.id,'DEPARTMENT_IMPACT_ASSESSED','EXPLICIT_OBSERVATION',t->'assessment'->>'dependencyDigest');
 END IF;
 IF r.target_kind='EVENT' THEN
  PERFORM governance_catalog.open_department_impacts(r.target_id,r.id,r.campus,r.recorded_at,(department_master.evolution_snapshot(t->>'actor',r.target_id,r.campus))->'facts'->'impacts');
 END IF;
 RETURN r.content||jsonb_build_object('assessmentId',r.id,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
END $$;

CREATE INDEX impact_mapping_target ON department_master.organization_mapping_version(target_type,target_id,mapping_id,number);
CREATE INDEX impact_hierarchy_node_target ON department_master.hierarchy_node(department_id,view_version_id);
CREATE INDEX impact_hierarchy_owner_target ON department_master.hierarchy_view_version(owner_department_id,view_id,version_no);

REVOKE ALL ON FUNCTION governance_catalog.department_impact_record(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance_catalog.department_impact_record(text,text) TO hdi_prototype;
