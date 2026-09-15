SELECT pg_advisory_xact_lock(901002);
CREATE TABLE governance_catalog.validation_run (
 id uuid PRIMARY KEY DEFAULT uuidv7(),
 job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),
 revision_id uuid NOT NULL REFERENCES governance_catalog.import_input_revision(id),
 parse_artifact_id uuid NOT NULL REFERENCES governance_catalog.parse_provenance(artifact_id),
 result_artifact_id uuid NOT NULL UNIQUE REFERENCES governance_catalog.protected_artifact(id),
 contract_version_id uuid NOT NULL REFERENCES governance_catalog.import_contract_version(id),
 rule_version text NOT NULL,
 interpretation_policy text NOT NULL CHECK(interpretation_policy='EXACT_TEXT_V1'),
 request_identity text NOT NULL,
 request_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('FAIL','BLOCKED')),
 issue_count integer NOT NULL CHECK(issue_count BETWEEN 0 AND 10000),
 signature text NOT NULL CHECK(signature ~ '^[a-f0-9]{64}$'),
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 UNIQUE(request_identity,request_id)
);
CREATE TRIGGER validation_run_immutable BEFORE UPDATE OR DELETE ON governance_catalog.validation_run FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
REVOKE ALL ON governance_catalog.validation_run FROM PUBLIC,hdi_prototype;
ALTER TABLE governance_catalog.validation_run ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION governance_catalog.read_validation(p_actor text,p_run uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE r governance_catalog.validation_run; p governance_catalog.parse_provenance;
BEGIN
 SELECT * INTO r FROM governance_catalog.validation_run WHERE id=p_run;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));
 SELECT * INTO p FROM governance_catalog.parse_provenance WHERE artifact_id=r.parse_artifact_id;
 RETURN jsonb_build_object('runId',r.id,'jobId',r.job_id,'revisionId',r.revision_id,'parseArtifactId',r.parse_artifact_id,'sourceArtifactId',p.source_artifact_id,'parserPolicy',p.policy,'contractVersionId',r.contract_version_id,'ruleVersion',r.rule_version,'interpretationPolicy',r.interpretation_policy,'decision',r.decision,'issueCount',r.issue_count,'resultArtifactId',r.result_artifact_id,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'adapterReadiness','NOT_READY','securityScan','NOT_RUN','signature',r.signature);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.read_validation(text,uuid) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.read_validation(text,uuid) TO hdi_prototype;
CREATE FUNCTION governance_catalog.validation_prior(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; j jsonb; prior vnext_control.outcome; digest text;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE');
 j:=governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',p_input->>'jobId'));
 PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',(j->'contract'->>'versionId')::uuid,'WRITE');
 SELECT o.* INTO prior FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=(p_input->>'requestId')::uuid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('operation','VALIDATE_REVISION','input',p_input)::text,'UTF8')),'hex');
 IF prior.input_digest<>digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
 RETURN prior.result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.validation_prior(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.validation_prior(text,jsonb) TO hdi_prototype;
CREATE FUNCTION governance_catalog.accept_validation(p_actor text,p_input jsonb,p_result uuid,p_decision text,p_count integer,p_run uuid,p_recorded text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; j jsonb; p governance_catalog.parse_provenance; a governance_catalog.protected_artifact; run governance_catalog.validation_run; result jsonb; digest text;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','requestId','outputRequestId','retentionSeconds','jobId','revisionId','artifactId')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE');
 j:=governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',p_input->>'jobId'));
 IF j->>'currentRevisionId' IS DISTINCT FROM p_input->>'revisionId' THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
 PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',(j->'contract'->>'versionId')::uuid,'WRITE');
 SELECT * INTO p FROM governance_catalog.parse_provenance WHERE artifact_id=(p_input->>'artifactId')::uuid;
 IF p.artifact_id IS NULL OR p.job_id::text<>j->>'id' OR p.revision_id::text<>j->>'currentRevisionId' OR p.contract_version_id::text<>j->'contract'->>'versionId' THEN RAISE EXCEPTION 'PARSE_PROVENANCE_REQUIRED'; END IF;
 IF p.structural_status<>'PARSED' THEN RAISE EXCEPTION 'STRUCTURAL_REJECTED'; END IF;
 SELECT * INTO a FROM governance_catalog.protected_artifact WHERE id=p_result;
 IF a.id IS NULL OR a.kind<>'ERROR_REPORT' OR a.job_id<>p.job_id OR a.revision_id<>p.revision_id OR a.campus IS DISTINCT FROM p_input->>'campus' OR a.purpose IS DISTINCT FROM p_input->>'purpose' THEN RAISE EXCEPTION 'VALIDATION_RESULT_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM (VALUES ('READ'),('STORE')) required(permission) WHERE NOT EXISTS(SELECT 1 FROM vnext_control.protected_grant g JOIN governance_catalog.version v ON v.object_id=g.dataset_id JOIN governance_catalog.import_contract_version c ON c.dataset_version_id=v.id WHERE c.id=p.contract_version_id AND g.actor_code=p_actor AND g.campus=a.campus AND g.purpose=a.purpose AND g.permission=required.permission)) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF EXISTS(SELECT 1 FROM governance_catalog.protected_artifact x WHERE x.id IN (p.artifact_id,p.source_artifact_id,a.id) AND (x.expires_at<=timezone('Asia/Shanghai',clock_timestamp()) OR NOT EXISTS(SELECT 1 FROM governance_catalog.protected_payload WHERE artifact_id=x.id))) THEN RAISE EXCEPTION 'PAYLOAD_UNAVAILABLE'; END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('operation','VALIDATE_REVISION','input',p_input)::text,'UTF8')),'hex');
 IF EXISTS(SELECT 1 FROM vnext_control.request_identity WHERE identity_code=identity AND request_id=(p_input->>'requestId')::uuid) THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
 INSERT INTO governance_catalog.validation_run(id,job_id,revision_id,parse_artifact_id,result_artifact_id,contract_version_id,rule_version,interpretation_policy,request_identity,request_id,decision,issue_count,recorded_at,signature)
 VALUES(p_run,p.job_id,p.revision_id,p.artifact_id,a.id,p.contract_version_id,j->'contract'->'definition'->>'ruleVersion','EXACT_TEXT_V1',identity,(p_input->>'requestId')::uuid,p_decision,p_count,governance_catalog.contract_time(p_recorded),p_signature) RETURNING * INTO run;
 result:=governance_catalog.read_validation(p_actor,run.id);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(p_actor,run.request_id,digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,run.request_id,p_actor);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,run.id,'VALIDATE_REVISION','BOUNDED_VALIDATION',digest);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text) TO hdi_prototype;
