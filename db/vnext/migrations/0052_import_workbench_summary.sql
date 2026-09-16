SELECT pg_advisory_xact_lock(901002);
-- Technical recovery only. Sensitive evidence remains behind its purpose-bound Owner reads.
CREATE FUNCTION governance_catalog.import_workbench_summary(actor text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE job jsonb; artifacts jsonb; runs jsonb; candidates jsonb; can_write boolean:=false;
BEGIN
 job:=governance_catalog.import_job_read(actor,input);
 BEGIN
  PERFORM vnext_control.authorize(actor,input->>'scope','WRITE');
  PERFORM governance_catalog.contract_require_access(actor,input->>'scope',(job->'contract'->>'versionId')::uuid,'WRITE');
  can_write:=true;
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'ACCESS_DENIED' THEN RAISE; END IF;
 END;
 SELECT coalesce(jsonb_agg(jsonb_build_object('artifactId',a.id,'revisionId',a.revision_id,'kind',a.kind,'campus',a.campus,'purpose',a.purpose,'status',a.status,'structuralStatus',p.structural_status) ORDER BY a.recorded_at,a.id),'[]') INTO artifacts
 FROM governance_catalog.protected_artifact a LEFT JOIN governance_catalog.parse_provenance p ON p.artifact_id=a.id WHERE a.job_id=(job->>'id')::uuid;
 SELECT coalesce(jsonb_agg(jsonb_build_object('runId',id,'revisionId',revision_id,'decision',decision,'issueCount',issue_count) ORDER BY recorded_at,id),'[]') INTO runs
 FROM governance_catalog.validation_run WHERE job_id=(job->>'id')::uuid;
 SELECT coalesce(jsonb_agg(jsonb_build_object('candidateId',c.id,'revisionId',c.input->>'revisionId','requestId',c.input->>'requestId','approved',a.candidate_id IS NOT NULL,'committed',k.candidate_id IS NOT NULL) ORDER BY c.recorded_at,c.id),'[]') INTO candidates
 FROM governance_catalog.apply_candidate c LEFT JOIN governance_catalog.apply_approval a ON a.candidate_id=c.id LEFT JOIN governance_catalog.apply_commit k ON k.candidate_id=c.id
 WHERE c.input->>'jobId'=job->>'id' AND c.maker_identity=job->>'submitterIdentity';
 RETURN jsonb_build_object('jobId',job->>'id','revisionId',job->>'currentRevisionId','status',job->>'status','contractId',job->'contract'->>'id','contractVersionId',job->'contract'->>'versionId','canWrite',can_write,'artifacts',artifacts,'runs',runs,'candidates',candidates);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.import_workbench_summary(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance_catalog.import_workbench_summary(text,jsonb) TO hdi_prototype;
