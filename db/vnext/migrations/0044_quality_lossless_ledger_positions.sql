SELECT pg_advisory_xact_lock(901002);
DO $positions$
DECLARE body text; signature text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['quality_issue_read(text,jsonb)','quality_issue_detail(text,jsonb)'] LOOP
  body:=pg_get_functiondef(('governance_catalog.'||signature)::regprocedure);
  IF position('''sequence'',i.issue_sequence,' IN body)=0 THEN RAISE EXCEPTION 'QUALITY_SEQUENCE_BASELINE_MISMATCH'; END IF;
  body:=replace(body,'''sequence'',i.issue_sequence,','''sequence'',i.issue_sequence::text,');
  IF signature='quality_issue_detail(text,jsonb)' THEN
   IF position('''head'',d.disposition_no,' IN body)=0 THEN RAISE EXCEPTION 'QUALITY_HISTORY_BASELINE_MISMATCH'; END IF;
   body:=replace(body,'''head'',d.disposition_no,','''head'',d.disposition_no::text,');
  END IF;
  EXECUTE body;
 END LOOP;
END $positions$;
