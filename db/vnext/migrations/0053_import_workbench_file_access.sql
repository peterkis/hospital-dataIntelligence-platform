SELECT pg_advisory_xact_lock(901002);
-- A UI capability observation is advisory; every actual Owner command reauthorizes.
CREATE FUNCTION governance_catalog.import_workbench_file_access(actor text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE dataset uuid; writable boolean:=false; readable boolean; storable boolean;
BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input->>'scope' IS DISTINCT FROM 'SYNTHETIC'
 OR coalesce(input->>'contractVersionId','') !~ '^[a-f0-9-]{36}$'
 OR coalesce(input->>'campus','') NOT IN ('NORTH','SOUTH')
 OR coalesce(input->>'purpose','') NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED')
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('scope','contractVersionId','campus','purpose')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 PERFORM vnext_control.authorize(actor,'SYNTHETIC','READ');
 PERFORM governance_catalog.contract_require_access(actor,'SYNTHETIC',(input->>'contractVersionId')::uuid,'READ');
 SELECT v.object_id INTO dataset FROM governance_catalog.import_contract_version c JOIN governance_catalog.version v ON v.id=c.dataset_version_id WHERE c.id=(input->>'contractVersionId')::uuid;
 BEGIN
  PERFORM vnext_control.authorize(actor,'SYNTHETIC','WRITE');
  PERFORM governance_catalog.contract_require_access(actor,'SYNTHETIC',(input->>'contractVersionId')::uuid,'WRITE');
  writable:=true;
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'ACCESS_DENIED' THEN RAISE; END IF;
 END;
 readable:=EXISTS(SELECT 1 FROM vnext_control.protected_grant g WHERE g.actor_code=actor AND g.dataset_id=dataset AND g.campus=input->>'campus' AND g.purpose=input->>'purpose' AND g.permission='READ');
 storable:=EXISTS(SELECT 1 FROM vnext_control.protected_grant g WHERE g.actor_code=actor AND g.dataset_id=dataset AND g.campus=input->>'campus' AND g.purpose=input->>'purpose' AND g.permission='STORE');
 RETURN jsonb_build_object('canReceive',writable AND readable AND storable,'canReadProtected',readable,'canWriteContract',writable);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.import_workbench_file_access(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance_catalog.import_workbench_file_access(text,jsonb) TO hdi_prototype;
DO $summary$
DECLARE body text; needle text:=$needle$'canWrite',can_write,$needle$;
BEGIN
 body:=pg_get_functiondef('governance_catalog.import_workbench_summary(text,jsonb)'::regprocedure);
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'WORKBENCH_SUMMARY_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,$replacement$'canWrite',can_write,'templateVersion',job->'contract'->'definition'->>'templateVersion',$replacement$);
END $summary$;
