SELECT pg_advisory_xact_lock(901002);
ALTER TABLE governance_catalog.parse_provenance DROP CONSTRAINT parse_provenance_policy_check;
ALTER TABLE governance_catalog.parse_provenance ADD CONSTRAINT parse_provenance_policy_check CHECK(policy IN ('STRICT_V1','STRICT_V2','STRICT_ORG_BUNDLE_V1'));
ALTER TABLE governance_catalog.validation_run DROP CONSTRAINT validation_run_decision_check;
ALTER TABLE governance_catalog.validation_run ADD CONSTRAINT validation_run_decision_check CHECK(decision IN ('PASS','FAIL','BLOCKED'));
DO $validation$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)'::regprocedure);
 needle:=' IF p.structural_status<>''PARSED'' THEN RAISE EXCEPTION ''STRUCTURAL_REJECTED''; END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_VALIDATION_BASELINE';END IF;
 body:=replace(body,needle,' IF p.structural_status<>''PARSED'' AND NOT (p.policy=''STRICT_ORG_BUNDLE_V1'' AND p_decision=''FAIL'') THEN RAISE EXCEPTION ''STRUCTURAL_REJECTED''; END IF;'||$guard$
 IF p_decision='PASS' AND (p.policy<>'STRICT_ORG_BUNDLE_V1' OR NOT EXISTS(SELECT 1 FROM organization_master.bundle_revision WHERE revision_id=p.revision_id)) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 IF p.policy='STRICT_ORG_BUNDLE_V1' THEN PERFORM organization_master.bundle_authorize(p_actor,p.job_id,p.revision_id,'WRITE');END IF;
$guard$);EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.read_validation(text,uuid)'::regprocedure);
 needle:='''adapterReadiness'',''NOT_READY''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_VALIDATION_READ_BASELINE';END IF;
 body:=replace(body,needle,'''adapterReadiness'',CASE WHEN p.policy=''STRICT_ORG_BUNDLE_V1'' THEN ''READY'' ELSE ''NOT_READY'' END');
 needle:=' SELECT * INTO p FROM governance_catalog.parse_provenance WHERE artifact_id=r.parse_artifact_id;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_VALIDATION_ACCESS_BASELINE';END IF;
 EXECUTE replace(body,needle,needle||E'\n IF p.policy=''STRICT_ORG_BUNDLE_V1'' THEN PERFORM organization_master.bundle_read(p_actor,r.job_id,r.revision_id);END IF;');
END $validation$;

-- Generic material and summary ports must respect all bound worksheet scopes too.
-- PURGE remains non-expansive; it retains its existing explicit authority check.
DO $access$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.protected_command(text,text,jsonb,jsonb,text)'::regprocedure);
 needle:='  IF j.id IS NULL THEN RAISE EXCEPTION ''NOT_FOUND''; END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_PROTECTED_BASELINE';END IF;
 EXECUTE replace(body,needle,needle||$guard$
  IF p_action<>'PURGE' AND EXISTS(SELECT 1 FROM organization_master.bundle_revision WHERE revision_id=CASE WHEN p_action='STORE' THEN (p_input->>'revisionId')::uuid ELSE a.revision_id END) THEN
   PERFORM organization_master.bundle_read(p_actor,j.id,CASE WHEN p_action='STORE' THEN (p_input->>'revisionId')::uuid ELSE a.revision_id END);
   PERFORM organization_master.bundle_dimension_access(p_actor,b.bindings,b.dimensions,'READ') FROM organization_master.bundle_revision b WHERE b.revision_id=CASE WHEN p_action='STORE' THEN (p_input->>'revisionId')::uuid ELSE a.revision_id END;
   IF p_action='STORE' THEN PERFORM organization_master.bundle_dimension_access(p_actor,b.bindings,b.dimensions,'STORE') FROM organization_master.bundle_revision b WHERE b.revision_id=(p_input->>'revisionId')::uuid;END IF;
  END IF;
$guard$);
 body:=pg_get_functiondef('governance_catalog.registration_evidence(text,uuid,uuid,text)'::regprocedure);
 needle:=' SELECT * INTO a FROM governance_catalog.protected_artifact WHERE id=p_artifact;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_EVIDENCE_BASELINE';END IF;
 EXECUTE replace(body,needle,needle||E'\n IF EXISTS(SELECT 1 FROM organization_master.bundle_revision WHERE revision_id=a.revision_id) THEN PERFORM organization_master.bundle_read(p_actor,a.job_id,a.revision_id);PERFORM organization_master.bundle_dimension_access(p_actor,b.bindings,b.dimensions,''READ'') FROM organization_master.bundle_revision b WHERE b.revision_id=a.revision_id;END IF;');
 body:=pg_get_functiondef('governance_catalog.import_job_read(text,jsonb)'::regprocedure);
 needle:=' PERFORM governance_catalog.contract_require_access(actor,job.scope,job.contract_version_id,''READ'');';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_JOB_READ_BASELINE';END IF;
 body:=replace(body,needle,needle||E'\n IF EXISTS(SELECT 1 FROM organization_master.bundle_revision WHERE revision_id=job.current_revision_id) THEN PERFORM organization_master.bundle_read(actor,job.id,job.current_revision_id);END IF;');
 EXECUTE replace(body,'''adapterReadiness'',''NOT_READY''','''adapterReadiness'',CASE WHEN EXISTS(SELECT 1 FROM organization_master.bundle_revision WHERE revision_id=job.current_revision_id) THEN ''READY'' ELSE ''NOT_READY'' END');
 body:=pg_get_functiondef('governance_catalog.import_workbench_summary(text,jsonb)'::regprocedure);
 needle:=' RETURN jsonb_build_object(''jobId'',job->>''id''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_SUMMARY_BASELINE';END IF;
 EXECUTE replace(body,needle,' RETURN jsonb_build_object(''adapterReadiness'',job->>''adapterReadiness'',''jobId'',job->>''id''');
END $access$;

-- Bundle issues retain their worksheet and physical XLSX coordinate. Legacy
-- validation keeps its existing logical-row bound and Data-sheet convention.
ALTER TABLE governance_catalog.quality_issue DROP CONSTRAINT quality_issue_row_number_check;
ALTER TABLE governance_catalog.quality_issue ADD CONSTRAINT quality_issue_row_number_check CHECK(row_number BETWEEN 0 AND 1048576);
ALTER TABLE governance_catalog.quality_issue DROP CONSTRAINT quality_issue_check;
ALTER TABLE governance_catalog.quality_issue ADD CONSTRAINT quality_issue_check CHECK((source_format='XLSX' AND (sheet_name IS NULL OR sheet_name IN ('Data','ORG01','ORG02','ORG03'))) OR (source_format IN ('CSV','JSON') AND sheet_name IS NULL));
DO $quality$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.quality_issue_ingest(text,jsonb,jsonb)'::regprocedure);
 body:=replace(body,'candidate->>''row'' !~ ''^(0|[1-9][0-9]{0,3})$''','candidate->>''row'' !~ ''^(0|[1-9][0-9]{0,6})$''');
 needle:='  row_no:=(candidate->>''row'')::integer; layer_no:=(candidate->>''layer'')::integer;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_QUALITY_POSITION_BASELINE';END IF;
 EXECUTE replace(body,needle,needle||$coordinate$
  IF rev.metadata->>'parserPolicy'='STRICT_ORG_BUNDLE_V1' THEN
   v_sheet_name:=CASE WHEN split_part(v_field_code,'.',1) IN ('ORG01','ORG02','ORG03') THEN split_part(v_field_code,'.',1) WHEN v_rule_code IN ('ORG01','ORG02','ORG03') THEN v_rule_code ELSE NULL END;
   v_dataset_code:=coalesce(v_sheet_name,j.contract_snapshot->>'dataset');
  ELSIF row_no>1000 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
$coordinate$);
END $quality$;
