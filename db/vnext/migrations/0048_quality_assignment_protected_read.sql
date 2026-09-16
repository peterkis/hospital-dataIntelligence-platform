SELECT pg_advisory_xact_lock(901002);
DO $assignment$
DECLARE body text; needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.quality_issue_assign(text,jsonb)'::regprocedure);
 needle:='PERFORM governance_catalog.contract_require_access(p_actor,''SYNTHETIC'',j.contract_version_id,''WRITE'');';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_ASSIGN_ACCESS_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,needle||$grant$
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.import_contract_version c
  JOIN governance_catalog.version v ON v.id=c.dataset_version_id
  JOIN vnext_control.protected_grant g ON g.dataset_id=v.object_id
  WHERE c.id=j.contract_version_id AND g.actor_code=p_actor
   AND g.campus=i.campus AND g.purpose=i.purpose AND g.permission='READ')
 THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
$grant$);
 EXECUTE body;
END $assignment$;
