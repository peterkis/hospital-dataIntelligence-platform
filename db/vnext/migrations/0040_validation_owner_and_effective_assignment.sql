SELECT pg_advisory_xact_lock(901002);
-- Attestation acceptance is a trusted service capability, not an app-role API.
-- Provisioning grants only this capability to a separately authenticated Owner.
-- No new persistent role or credential is created by a schema migration.
DO $acceptance$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='governance_catalog' AND p.proname='accept_validation' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,hdi_prototype',f.signature);
 END LOOP;
END $acceptance$;

DO $assignment$
DECLARE body text; needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.quality_issue_assign(text,jsonb)'::regprocedure);
 needle:=' SELECT e.* INTO responsibility_event FROM governance_catalog.event e WHERE e.object_id=responsibility.id ORDER BY e.head DESC LIMIT 1;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_ASSIGNMENT_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,$query$
 WITH instant AS MATERIALIZED(SELECT timezone('Asia/Shanghai',clock_timestamp()) AS r)
 SELECT e.* INTO responsibility_event FROM instant CROSS JOIN LATERAL governance_catalog.definition_spans(responsibility.id,instant.r) spans
 JOIN governance_catalog.event e ON e.object_id=responsibility.id AND e.head=spans.published_head
 WHERE spans.effective_span @> instant.r;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESPONSIBILITY_NOT_READY'; END IF;
$query$);
 EXECUTE body;
END $assignment$;
