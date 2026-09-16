SELECT pg_advisory_xact_lock(901002);
-- Preserve existing candidate/approval/outcome bytes. Historical ambiguity blocks the
-- upgrade rather than deleting an approved observation or choosing a different intent.
ALTER TABLE governance_catalog.apply_candidate ADD CONSTRAINT apply_candidate_request_required
 CHECK (input ? 'requestId' AND jsonb_typeof(input->'requestId')='string'
  AND input->>'requestId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM governance_catalog.apply_candidate GROUP BY maker_identity,(input->>'requestId')::uuid HAVING count(*)>1)
 THEN RAISE EXCEPTION 'APPLY_CANDIDATE_IDENTITY_COLLISION'; END IF;
END $$;
CREATE UNIQUE INDEX apply_candidate_request_identity
 ON governance_catalog.apply_candidate(maker_identity,((input->>'requestId')::uuid));

DO $repair$
DECLARE body text; needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.apply_record(text,text,jsonb)'::regprocedure);
 needle:='IF p_action=''FREEZE'' THEN';
 IF position(needle IN body)=0 OR position('''FREEZE'',''READ_CANDIDATE''' IN body)=0 OR position('(''FREEZE'',''COMMIT'')' IN body)=0
 THEN RAISE EXCEPTION 'APPLY_FREEZE_BASELINE_MISMATCH'; END IF;
 body:=replace(body,'''FREEZE'',''READ_CANDIDATE''','''FREEZE'',''FROZEN_PRIOR'',''READ_CANDIDATE''');
 body:=replace(body,'(''FREEZE'',''COMMIT'')','(''FREEZE'',''FROZEN_PRIOR'',''COMMIT'')');
 body:=replace(body,needle,$freeze$
 IF p_action IN ('FREEZE','FROZEN_PRIOR') THEN
  SELECT * INTO c FROM governance_catalog.apply_candidate
   WHERE maker_identity=identity AND (input->>'requestId')::uuid=(p_input->'input'->>'requestId')::uuid;
  IF FOUND THEN
   IF c.input IS DISTINCT FROM p_input->'input' OR (p_action='FREEZE' AND c.digest IS DISTINCT FROM p_input->>'digest')
   THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
   RETURN jsonb_build_object('candidateId',c.id,'digest',c.digest);
  END IF;
  IF EXISTS(SELECT 1 FROM vnext_control.request_identity WHERE identity_code=identity AND request_id=(p_input->'input'->>'requestId')::uuid)
  THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
  IF p_action='FROZEN_PRIOR' THEN RETURN NULL; END IF;
$freeze$);
 EXECUTE body;
END $repair$;
