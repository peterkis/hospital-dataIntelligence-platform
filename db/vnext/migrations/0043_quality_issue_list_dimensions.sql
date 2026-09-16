SELECT pg_advisory_xact_lock(901002);
DO $dimensions$
DECLARE body text; needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.quality_issue_read(text,jsonb)'::regprocedure);
 needle:=' IF EXISTS(SELECT 1 FROM governance_catalog.quality_issue i WHERE i.job_id=j.id AND (i.campus<>p_input->>''campus'' OR i.purpose<>p_input->>''purpose'')) THEN RAISE EXCEPTION ''ACCESS_DENIED''; END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_LIST_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,'');
 needle:='FROM governance_catalog.quality_issue WHERE job_id=j.id;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_COUNT_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,'FROM governance_catalog.quality_issue WHERE job_id=j.id AND campus=p_input->>''campus'' AND purpose=p_input->>''purpose'';');
 needle:='FROM governance_catalog.quality_issue i WHERE i.job_id=j.id ORDER BY i.issue_sequence';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_PAGE_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,'FROM governance_catalog.quality_issue i WHERE i.job_id=j.id AND i.campus=p_input->>''campus'' AND i.purpose=p_input->>''purpose'' ORDER BY i.issue_sequence');
 EXECUTE body;
END $dimensions$;
