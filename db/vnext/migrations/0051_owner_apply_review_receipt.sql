SELECT pg_advisory_xact_lock(901002);
-- NULL preserves the honest boundary of historical approvals: no successful-read
-- receipt was recorded. Do not retroactively attest that their reviewers read content.
ALTER TABLE governance_catalog.apply_approval ADD COLUMN review_audit_id uuid
 REFERENCES vnext_control.audit(id);

DO $repair$
DECLARE body text; needle text; replacement text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.apply_record(text,text,jsonb)'::regprocedure);
 FOR needle,replacement IN SELECT * FROM (VALUES
  ('operation_digest text;','operation_digest text; review_audit uuid; proof_digest text;'),
  ('''READ_SENSITIVE'',''APPROVE''','''READ_SENSITIVE'',''READ_READY'',''APPROVE'''),
  ('''CHECK_APPROVAL'',''READ_SENSITIVE'')','''CHECK_APPROVAL'',''READ_SENSITIVE'',''READ_READY'')'),
  ('IF p_action=''READ_CANDIDATE'' THEN',$proof$
   proof_digest:=encode(sha256(convert_to(jsonb_build_object('candidateId',c.id,'candidateDigest',c.digest,'reviewerIdentity',identity)::text,'UTF8')),'hex');
   IF p_action='READ_CANDIDATE' THEN
  $proof$),
  ('ELSIF p_action=''READ_SENSITIVE'' THEN','ELSIF p_action IN (''READ_SENSITIVE'',''READ_READY'') THEN'),
  ('IF p_action=''CHECK_APPROVAL'' THEN',$review$
   SELECT r.id INTO review_audit FROM vnext_control.audit r
    WHERE r.object_id=c.id AND r.actor_code=p_actor AND r.action='OWNER_APPLY_READ_READY'
     AND r.content_digest=proof_digest AND (a.candidate_id IS NULL OR r.id=a.review_audit_id)
    ORDER BY r.id LIMIT 1;
   IF review_audit IS NULL THEN RAISE EXCEPTION 'CANDIDATE_REVIEW_REQUIRED'; END IF;
   IF p_action='CHECK_APPROVAL' THEN
  $review$),
  ('apply_approval(candidate_id,actor_code,identity_code,digest) VALUES(c.id,p_actor,identity,c.digest)',
   'apply_approval(candidate_id,actor_code,identity_code,digest,review_audit_id) VALUES(c.id,p_actor,identity,c.digest,review_audit)'),
  ('WHEN p_action=''READ_SENSITIVE'' THEN','WHEN p_action IN (''READ_SENSITIVE'',''READ_READY'') THEN'),
  ('END,c.digest) RETURNING id INTO audit_id;','END,CASE WHEN p_action=''READ_READY'' THEN proof_digest ELSE c.digest END) RETURNING id INTO audit_id;')
 ) changes(needle,replacement) LOOP
  IF position(needle IN body)=0 THEN RAISE EXCEPTION 'APPLY_REVIEW_BASELINE_MISMATCH'; END IF;
  body:=replace(body,needle,replacement);
 END LOOP;
 EXECUTE body;
END $repair$;
