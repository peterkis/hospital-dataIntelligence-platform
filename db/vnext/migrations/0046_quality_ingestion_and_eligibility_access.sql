SELECT pg_advisory_xact_lock(901002);
DO $quality$
DECLARE body text; signature text; needle text; access_check text; counter text;
BEGIN
 access_check:=$grant$
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.import_contract_version c
  JOIN governance_catalog.version v ON v.id=c.dataset_version_id
  JOIN vnext_control.protected_grant g ON g.dataset_id=v.object_id
  WHERE c.id=j.contract_version_id AND g.actor_code=p_actor
   AND g.campus=p_input->>'campus' AND g.purpose=p_input->>'purpose' AND g.permission='READ')
 THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
$grant$;
 FOREACH signature IN ARRAY ARRAY['quality_issue_ingest(text,jsonb,jsonb)','quality_eligibility(text,jsonb,jsonb,jsonb)'] LOOP
  body:=pg_get_functiondef(('governance_catalog.'||signature)::regprocedure);
  IF signature='quality_issue_ingest(text,jsonb,jsonb)' THEN
   needle:='PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object(''scope'',''SYNTHETIC'',''jobId'',j.id));';
  ELSE
   needle:='PERFORM vnext_control.authorize(p_actor,''SYNTHETIC'',''READ'');';
   IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_ELIGIBILITY_AUTH_BASELINE_MISMATCH'; END IF;
   body:=replace(body,needle,'PERFORM pg_advisory_xact_lock(901002); '||needle);
   needle:='SELECT * INTO j FROM governance_catalog.import_job WHERE id=(p_input->>''jobId'')::uuid AND scope=''SYNTHETIC'';';
  END IF;
  IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_READ_BASELINE_MISMATCH'; END IF;
  body:=replace(body,needle,needle||access_check);
  IF signature='quality_eligibility(text,jsonb,jsonb,jsonb)' THEN
   needle:='IF NOT FOUND OR j.current_revision_id<>r.revision_id THEN RAISE EXCEPTION ''STALE_REVISION''; END IF;';
   IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_EVIDENCE_BASELINE_MISMATCH'; END IF;
   body:=replace(body,needle,needle||$evidence$
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.protected_artifact a
  JOIN governance_catalog.protected_payload p ON p.artifact_id=a.id
  WHERE a.id=r.result_artifact_id AND a.campus=p_input->>'campus' AND a.purpose=p_input->>'purpose'
   AND a.expires_at>timezone('Asia/Shanghai',clock_timestamp()))
 THEN RAISE EXCEPTION 'VALIDATION_EVIDENCE_UNAVAILABLE'; END IF;
$evidence$);
   FOREACH counter IN ARRAY ARRAY['unresolved_count','manual_count','dependency_count'] LOOP
    needle:='INTO '||counter||' FROM governance_catalog.quality_issue i WHERE i.run_id=r.id';
    IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_BLOCKER_BASELINE_MISMATCH'; END IF;
    body:=replace(body,needle,'INTO '||counter||' FROM governance_catalog.quality_issue i WHERE i.job_id=j.id AND i.campus=p_input->>''campus'' AND i.purpose=p_input->>''purpose''');
   END LOOP;
  END IF;
  EXECUTE body;
 END LOOP;
END $quality$;
