SELECT pg_advisory_xact_lock(901002);
DO $availability$
DECLARE body text; needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.quality_issue_detail(text,jsonb)'::regprocedure);
 needle:=$old$SELECT EXISTS(SELECT 1 FROM governance_catalog.validation_run vr JOIN governance_catalog.protected_artifact a ON a.id=vr.result_artifact_id JOIN governance_catalog.protected_payload p ON p.artifact_id=a.id WHERE vr.id=i.run_id AND a.expires_at>timezone('Asia/Shanghai',clock_timestamp())) INTO evidence_available;$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_DETAIL_EVIDENCE_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,$new$
 SELECT EXISTS(SELECT 1 FROM governance_catalog.validation_run vr
  JOIN governance_catalog.protected_artifact a ON a.id=vr.result_artifact_id
  JOIN governance_catalog.protected_payload p ON p.artifact_id=a.id
  JOIN governance_catalog.protected_artifact parsed ON parsed.id=vr.parse_artifact_id
  JOIN governance_catalog.protected_payload parsed_payload ON parsed_payload.artifact_id=parsed.id
  WHERE vr.id=i.run_id AND a.campus=i.campus AND a.purpose=i.purpose
   AND parsed.campus=i.campus AND parsed.purpose=i.purpose
   AND a.expires_at>timezone('Asia/Shanghai',clock_timestamp())
   AND parsed.expires_at>timezone('Asia/Shanghai',clock_timestamp())) INTO evidence_available;
$new$);
 EXECUTE body;
END $availability$;
