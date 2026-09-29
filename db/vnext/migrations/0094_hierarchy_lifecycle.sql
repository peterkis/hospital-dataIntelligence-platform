SELECT pg_advisory_xact_lock(901002);

CREATE TABLE department_master.hierarchy_closure (
 id uuid PRIMARY KEY DEFAULT uuidv7(),
 view_id uuid NOT NULL UNIQUE REFERENCES department_master.hierarchy_view(id),
 version_no bigint NOT NULL,
 candidate_id uuid NOT NULL UNIQUE REFERENCES department_master.hierarchy_candidate(id),
 status text NOT NULL CHECK (status IN ('CLOSED','REVOKED')),
 reason text NOT NULL CHECK (reason ~ '\S'),
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 FOREIGN KEY (view_id,version_no) REFERENCES department_master.hierarchy_view_version(view_id,version_no)
);
CREATE TRIGGER hierarchy_closure_immutable BEFORE UPDATE OR DELETE ON department_master.hierarchy_closure
 FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
GRANT SELECT ON department_master.hierarchy_closure TO hdi_prototype;

CREATE FUNCTION department_master.hierarchy_lifecycle(p_actor text,p_operation text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,department_master,vnext_control AS $$
DECLARE identity text; reviewer_identity text; c department_master.hierarchy_candidate; h department_master.hierarchy_view;
 event department_master.hierarchy_closure; body jsonb; candidate_id uuid; current_version bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 identity:=department_master.authorize(p_actor,'HOSPITAL','WRITE');
 IF p_operation='PREPARE' THEN
  body:=p_input->'payload';
  IF jsonb_typeof(body) IS DISTINCT FROM 'object'
    OR NOT (body ?& ARRAY['requestId','viewId','expectedVersion','action','reason'])
    OR body - ARRAY['requestId','viewId','expectedVersion','action','reason'] <> '{}'::jsonb
    OR coalesce(body->>'action','') NOT IN ('CLOSE','REVOKE')
    OR coalesce(body->>'expectedVersion','') !~ '^[1-9][0-9]*$'
    OR coalesce(body->>'reason','') !~ '\S' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  SELECT * INTO c FROM department_master.hierarchy_candidate WHERE request_id=(body->>'requestId')::uuid;
  IF FOUND THEN
   IF c.digest IS DISTINCT FROM p_input->>'digest' OR c.maker_identity<>identity OR c.payload IS DISTINCT FROM body THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
   RETURN jsonb_build_object('candidateId',c.id,'digest',c.digest);
  END IF;
  SELECT * INTO h FROM department_master.hierarchy_view WHERE id=(body->>'viewId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM department_master.hierarchy_closure WHERE view_id=h.id) THEN RAISE EXCEPTION 'HIERARCHY_CLOSED'; END IF;
  SELECT max(version_no) INTO current_version FROM department_master.hierarchy_view_version WHERE view_id=h.id AND status='PUBLISHED';
  IF current_version IS NULL OR current_version::text IS DISTINCT FROM body->>'expectedVersion' THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
  INSERT INTO department_master.hierarchy_candidate(request_id,view_id,source_client_key,maker,maker_identity,digest,payload_digest,payload,envelope,status)
   VALUES((body->>'requestId')::uuid,h.id,h.source_client_key,p_actor,identity,p_input->>'digest',p_input->>'payloadDigest',body,p_input->'envelope','VALIDATED') RETURNING id INTO candidate_id;
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,candidate_id,'HIERARCHY_CLOSURE_PREPARED','NON_EXPANDING',p_input->>'digest');
  RETURN jsonb_build_object('candidateId',candidate_id,'digest',p_input->>'digest');
 ELSIF p_operation='APPLY' THEN
  IF p_input - ARRAY['candidateId','requestId','digest'] <> '{}'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  SELECT * INTO c FROM department_master.hierarchy_candidate WHERE id=(p_input->>'candidateId')::uuid AND digest=p_input->>'digest' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF c.request_id::text IS DISTINCT FROM p_input->>'requestId' THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
  IF coalesce(c.payload->>'action','') NOT IN ('CLOSE','REVOKE') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  SELECT cl.* INTO event FROM department_master.hierarchy_closure cl WHERE cl.candidate_id=c.id;
  IF NOT FOUND THEN
   IF c.status<>'APPROVED' OR c.approved_by IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED'; END IF;
   reviewer_identity:=department_master.authorize(c.approved_by,'HOSPITAL','REVIEW');
   IF c.maker_identity=reviewer_identity OR reviewer_identity IS DISTINCT FROM c.approved_identity THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED'; END IF;
   IF EXISTS (SELECT 1 FROM department_master.hierarchy_closure WHERE view_id=c.view_id) THEN RAISE EXCEPTION 'HIERARCHY_CLOSED'; END IF;
   SELECT max(version_no) INTO current_version FROM department_master.hierarchy_view_version WHERE view_id=c.view_id AND status='PUBLISHED';
   IF current_version::text IS DISTINCT FROM c.payload->>'expectedVersion' THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
   INSERT INTO department_master.hierarchy_closure(view_id,version_no,candidate_id,status,reason)
    VALUES(c.view_id,current_version,c.id,CASE c.payload->>'action' WHEN 'CLOSE' THEN 'CLOSED' ELSE 'REVOKED' END,c.payload->>'reason') RETURNING * INTO event;
   UPDATE department_master.hierarchy_candidate SET status='APPLIED',applied_at=timezone('Asia/Shanghai',clock_timestamp()) WHERE id=c.id;
   INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,event.id,'HIERARCHY_CLOSED','NON_EXPANDING',c.digest);
  END IF;
  RETURN jsonb_build_object('closureId',event.id,'viewId',event.view_id,'version',event.version_no::text,'status',event.status,'recordedAt',to_char(event.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
 ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
END $$;
REVOKE ALL ON FUNCTION department_master.hierarchy_lifecycle(text,text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION department_master.hierarchy_lifecycle(text,text,jsonb) TO hdi_prototype;

-- Prevent expansion after the terminal event, without rewriting installed bodies.
DO $patch$ DECLARE body text; needle text; BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_publish(text,uuid,text,jsonb)'::regprocedure);
 needle:='  IF coalesce(p_payload->>''ownerDepartmentId'','''')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_LIFECYCLE_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,$guard$
  IF EXISTS (SELECT 1 FROM department_master.hierarchy_closure WHERE view_id=target_view_id) THEN RAISE EXCEPTION 'HIERARCHY_CLOSED'; END IF;
$guard$||needle);
END $patch$;
