SELECT pg_advisory_xact_lock(901002);
DO $reads$
DECLARE body text; signature text; needle text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['quality_issue_read(text,jsonb)','quality_issue_detail(text,jsonb)'] LOOP
  body:=pg_get_functiondef(('governance_catalog.'||signature)::regprocedure);
  needle:='PERFORM vnext_control.authorize(p_actor,''SYNTHETIC'',''READ'');';
  IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_READ_AUTH_BASELINE_MISMATCH'; END IF;
  body:=replace(body,needle,'PERFORM pg_advisory_xact_lock(901002); '||needle);
  needle:=CASE WHEN signature='quality_issue_read(text,jsonb)' THEN
   'SELECT * INTO j FROM governance_catalog.import_job WHERE id=(p_input->>''jobId'')::uuid;'
   ELSE 'SELECT * INTO j FROM governance_catalog.import_job WHERE id=i.job_id;' END;
  IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_READ_JOB_BASELINE_MISMATCH'; END IF;
  body:=replace(body,needle,needle||$grant$
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.import_contract_version c
  JOIN governance_catalog.version v ON v.id=c.dataset_version_id
  JOIN vnext_control.protected_grant g ON g.dataset_id=v.object_id
  WHERE c.id=j.contract_version_id AND g.actor_code=p_actor
   AND g.campus=p_input->>'campus' AND g.purpose=p_input->>'purpose' AND g.permission='READ')
 THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
$grant$);
  EXECUTE body;
 END LOOP;
END $reads$;
