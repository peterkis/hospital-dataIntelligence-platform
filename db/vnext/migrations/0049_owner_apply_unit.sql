SELECT pg_advisory_xact_lock(901002);
-- Encrypted complete candidate; public receipt metadata never contains business keys or raw cells.
CREATE TABLE governance_catalog.apply_candidate (
 id uuid PRIMARY KEY DEFAULT uuidv7(), maker text NOT NULL REFERENCES vnext_control.actor(code),
 maker_identity text NOT NULL, input jsonb NOT NULL, digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 envelope jsonb NOT NULL, recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp())
);
CREATE TABLE governance_catalog.apply_approval (
 candidate_id uuid PRIMARY KEY REFERENCES governance_catalog.apply_candidate(id),
 actor_code text NOT NULL REFERENCES vnext_control.actor(code), identity_code text NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp())
);
CREATE TABLE governance_catalog.apply_commit (
 candidate_id uuid PRIMARY KEY REFERENCES governance_catalog.apply_approval(candidate_id),
 actor_code text NOT NULL, request_id uuid NOT NULL, identity_code text NOT NULL,
 FOREIGN KEY(actor_code,request_id) REFERENCES vnext_control.outcome(actor_code,request_id),
 UNIQUE(identity_code,request_id)
);
CREATE TRIGGER apply_candidate_immutable BEFORE UPDATE OR DELETE ON governance_catalog.apply_candidate FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE TRIGGER apply_approval_immutable BEFORE UPDATE OR DELETE ON governance_catalog.apply_approval FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE TRIGGER apply_commit_immutable BEFORE UPDATE OR DELETE ON governance_catalog.apply_commit FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
REVOKE ALL ON governance_catalog.apply_candidate,governance_catalog.apply_approval,governance_catalog.apply_commit FROM PUBLIC,hdi_prototype;
ALTER TABLE governance_catalog.apply_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_catalog.apply_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_catalog.apply_commit ENABLE ROW LEVEL SECURITY;
-- Only the trusted Coordinator service receives EXECUTE. Ordinary app roles cannot forge
-- observed candidates, approvals, Owner results or recovery authorization with raw SQL.
CREATE FUNCTION governance_catalog.apply_record(p_actor text,p_action text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; c governance_catalog.apply_candidate; a governance_catalog.apply_approval;
 prior vnext_control.outcome; result jsonb; req uuid; audit_id uuid; operation_digest text;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF p_action NOT IN ('FREEZE','READ_CANDIDATE','READ_SENSITIVE','APPROVE','CHECK_APPROVAL','RESUME','COMMIT','RECONCILE') OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC',CASE WHEN p_action IN ('APPROVE','CHECK_APPROVAL','READ_SENSITIVE') THEN 'REVIEW' WHEN p_action IN ('FREEZE','COMMIT') THEN 'WRITE' ELSE 'READ' END);
 IF p_action='FREEZE' THEN
  IF p_input->'input'->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR p_input->'input'->>'campus' NOT IN ('NORTH','SOUTH') OR p_input->'input'->>'purpose' NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED') OR jsonb_typeof(p_input->'envelope') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  INSERT INTO governance_catalog.apply_candidate(maker,maker_identity,input,digest,envelope)
  VALUES(p_actor,identity,p_input->'input',p_input->>'digest',p_input->'envelope') RETURNING * INTO c;
  result:=jsonb_build_object('candidateId',c.id,'digest',c.digest);
 ELSE
  SELECT * INTO c FROM governance_catalog.apply_candidate WHERE id=(p_input->>'candidateId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO a FROM governance_catalog.apply_approval WHERE candidate_id=c.id;
  IF p_action='READ_CANDIDATE' THEN
   RETURN jsonb_build_object('id',c.id,'maker',c.maker,'makerIdentity',c.maker_identity,'input',c.input,'digest',c.digest,'envelope',c.envelope,'approvedBy',a.actor_code);
  ELSIF p_action='READ_SENSITIVE' THEN
   result:=jsonb_build_object('candidateId',c.id);
  ELSIF p_action IN ('APPROVE','CHECK_APPROVAL') THEN
   IF identity=c.maker_identity THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED'; END IF;
   IF p_action='CHECK_APPROVAL' THEN
    IF a.actor_code IS DISTINCT FROM p_actor OR a.identity_code IS DISTINCT FROM identity OR a.digest IS DISTINCT FROM c.digest THEN RAISE EXCEPTION 'APPROVAL_REQUIRED'; END IF;
    RETURN jsonb_build_object('approved',true);
   END IF;
   IF p_input->>'digest' IS DISTINCT FROM c.digest THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
   IF a.candidate_id IS NOT NULL AND a.identity_code<>identity THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
   INSERT INTO governance_catalog.apply_approval(candidate_id,actor_code,identity_code,digest) VALUES(c.id,p_actor,identity,c.digest) ON CONFLICT DO NOTHING;
   result:=jsonb_build_object('candidateId',c.id,'approvedBy',coalesce(a.actor_code,p_actor));
  ELSE
   req:=(p_input->>'requestId')::uuid;
   operation_digest:=encode(sha256(convert_to(jsonb_build_object('operation','APPLY_UNIT','candidateId',c.id)::text,'UTF8')),'hex');
   SELECT o.* INTO prior FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=req;
   IF prior.request_id IS NOT NULL AND prior.input_digest<>operation_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
   IF p_action='RESUME' THEN RETURN prior.result; END IF;
   IF p_action='COMMIT' THEN
    IF a.candidate_id IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED'; END IF;
    IF prior.request_id IS NOT NULL OR EXISTS(SELECT 1 FROM governance_catalog.apply_commit WHERE candidate_id=c.id) THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
    IF jsonb_typeof(p_input->'facts') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'facts') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
    result:=jsonb_build_object('status','COMMITTED','candidateId',c.id,'requestId',req,'facts',p_input->'facts','recordedAt',to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US'));
    INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(p_actor,req,operation_digest,result);
    INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,p_actor);
    INSERT INTO governance_catalog.apply_commit(candidate_id,actor_code,request_id,identity_code) VALUES(c.id,p_actor,req,identity);
   ELSE
    IF prior.request_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF jsonb_typeof(p_input->'matched') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
    result:=jsonb_build_object('status',CASE WHEN (p_input->>'matched')::boolean THEN 'MATCHED' ELSE 'MISMATCH' END);
   END IF;
  END IF;
 END IF;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest)
 VALUES(p_actor,c.id,'OWNER_APPLY_'||p_action,CASE WHEN p_action='READ_SENSITIVE' THEN (c.input->>'purpose')||'_'||(c.input->>'campus') WHEN p_action='RECONCILE' THEN result->>'status' ELSE 'OWNER_UNIT' END,c.digest) RETURNING id INTO audit_id;
 IF p_action='RECONCILE' THEN result:=result||jsonb_build_object('receiptId',audit_id); END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.apply_record(text,text,jsonb) FROM PUBLIC,hdi_prototype;
