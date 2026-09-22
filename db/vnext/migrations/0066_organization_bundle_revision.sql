SELECT pg_advisory_xact_lock(901002);
CREATE TABLE organization_master.bundle_revision(
 revision_id uuid PRIMARY KEY REFERENCES governance_catalog.import_input_revision(id),
 job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),
 raw_id uuid NOT NULL REFERENCES governance_catalog.protected_artifact(id),
 manifest_id uuid NOT NULL REFERENCES governance_catalog.protected_artifact(id),
 campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),
 bindings jsonb NOT NULL CHECK(jsonb_typeof(bindings)='array' AND jsonb_array_length(bindings)=3),
 scopes jsonb NOT NULL CHECK(jsonb_typeof(scopes)='array'),
 dimensions jsonb NOT NULL CHECK(jsonb_typeof(dimensions)='array' AND jsonb_array_length(dimensions) BETWEEN 1 AND 6),
 manifest_digest text NOT NULL CHECK(manifest_digest~'^[a-f0-9]{64}$'),
 contracts_digest text NOT NULL CHECK(contracts_digest~'^[a-f0-9]{64}$'),
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp())
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON organization_master.bundle_revision FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
ALTER TABLE organization_master.bundle_revision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON organization_master.bundle_revision FROM PUBLIC,hdi_prototype;
DO $patch$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.import_job_command(text,jsonb)'::regprocedure);
 needle:=' ) IS NOT TRUE THEN RAISE EXCEPTION ''CLOSED_METADATA_REQUIRED''; END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_METADATA_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,$metadata$
 OR (metadata->>'kind'='FILE' AND metadata->>'format'='XLSX' AND metadata->>'parserPolicy'='STRICT_ORG_BUNDLE_V1' AND jsonb_typeof(metadata->'manifestDigest')='string' AND jsonb_typeof(metadata->'contractsDigest')='string' AND metadata->>'manifestDigest'~'^[a-f0-9]{64}$' AND metadata->>'contractsDigest'~'^[a-f0-9]{64}$' AND metadata-ARRAY['kind','format','parserPolicy','manifestDigest','contractsDigest']='{}'::jsonb)
$metadata$||needle);
 body:=pg_get_functiondef('governance_catalog.import_job_command(text,jsonb)'::regprocedure);
 needle:=' IF effective IS NULL OR effective->>''versionId''<>snapshot->>''versionId'' THEN RAISE EXCEPTION ''EXACT_CONTRACT_UNAVAILABLE''; END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_ANCHOR_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,$anchor$
 IF effective IS NULL OR (effective->>'versionId'<>snapshot->>'versionId' AND NOT (action='REVISE' AND metadata->>'parserPolicy'='STRICT_ORG_BUNDLE_V1' AND EXISTS(SELECT 1 FROM governance_catalog.import_contract WHERE id=job.contract_id AND bundle_org))) THEN RAISE EXCEPTION 'EXACT_CONTRACT_UNAVAILABLE'; END IF;
$anchor$);
 body:=pg_get_functiondef('governance_catalog.protected_command(text,text,jsonb,jsonb,text)'::regprocedure);
 needle:='IS DISTINCT FROM j.contract_version_id::text THEN RAISE EXCEPTION ''EXACT_CONTRACT_UNAVAILABLE''; END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BUNDLE_ARTIFACT_ANCHOR_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,$artifact$
IS DISTINCT FROM j.contract_version_id::text AND NOT EXISTS(SELECT 1 FROM governance_catalog.import_input_revision r JOIN governance_catalog.import_contract c ON c.id=j.contract_id WHERE r.id=(p_input->>'revisionId')::uuid AND r.job_id=j.id AND r.metadata->>'parserPolicy'='STRICT_ORG_BUNDLE_V1' AND c.bundle_org) THEN RAISE EXCEPTION 'EXACT_CONTRACT_UNAVAILABLE'; END IF;
$artifact$);
END $patch$;
ALTER TABLE governance_catalog.import_input_revision DROP CONSTRAINT import_input_revision_metadata_shape_check;
ALTER TABLE governance_catalog.import_input_revision ADD CONSTRAINT import_input_revision_metadata_shape_check CHECK (
 CASE WHEN jsonb_typeof(metadata)='object' THEN (
 (metadata->>'kind'='FILE' AND metadata->>'format' IN ('CSV','JSON','XLSX') AND metadata->>'parserPolicy' IN ('STRICT_V1','STRICT_V2') AND metadata-ARRAY['kind','format','parserPolicy']='{}'::jsonb)
 OR (metadata->>'kind'='METADATA_ONLY' AND jsonb_typeof(metadata->'declaredSha256')='string' AND metadata->>'declaredSha256'~'^[a-f0-9]{64}$' AND metadata-ARRAY['kind','declaredSha256']='{}'::jsonb)
 OR (metadata->>'kind'='FILE' AND metadata->>'format'='XLSX' AND metadata->>'parserPolicy'='STRICT_ORG_BUNDLE_V1' AND jsonb_typeof(metadata->'manifestDigest')='string' AND jsonb_typeof(metadata->'contractsDigest')='string' AND metadata->>'manifestDigest'~'^[a-f0-9]{64}$' AND metadata->>'contractsDigest'~'^[a-f0-9]{64}$' AND metadata-ARRAY['kind','format','parserPolicy','manifestDigest','contractsDigest']='{}'::jsonb)
 ) IS TRUE ELSE false END);

CREATE FUNCTION organization_master.bundle_dimension_access(p_actor text,p_bindings jsonb,p_dimensions jsonb,p_permission text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE dimension jsonb;dataset uuid;BEGIN
 IF p_permission NOT IN ('READ','STORE') OR jsonb_typeof(p_dimensions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_dimensions) NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR dimension IN SELECT value FROM jsonb_array_elements(p_dimensions) LOOP
  IF dimension->>'dataset' NOT IN ('ORG01','ORG02','ORG03') OR dimension->>'scope' NOT IN ('NORTH','SOUTH') OR dimension-ARRAY['dataset','scope']<>'{}'::jsonb THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  SELECT v.object_id INTO dataset FROM jsonb_array_elements(p_bindings) b JOIN governance_catalog.import_contract_version c ON c.id=(b->>'contractVersionId')::uuid JOIN governance_catalog.version v ON v.id=c.dataset_version_id WHERE b->>'dataset'=dimension->>'dataset';
  IF dataset IS NULL OR NOT EXISTS(SELECT 1 FROM vnext_control.protected_grant WHERE actor_code=p_actor AND dataset_id=dataset AND campus=dimension->>'scope' AND purpose='IDENTITY_VERIFY' AND permission=p_permission) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION organization_master.bundle_dimension_access(text,jsonb,jsonb,text) FROM PUBLIC,hdi_prototype;
CREATE FUNCTION organization_master.bundle_register(p_actor text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j governance_catalog.import_job;r governance_catalog.import_input_revision;b organization_master.bundle_revision;binding jsonb;v governance_catalog.import_contract_version;ds text;sc text;identity text;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE');
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=(p_input->>'jobId')::uuid;
 SELECT * INTO r FROM governance_catalog.import_input_revision WHERE id=(p_input->>'revisionId')::uuid AND job_id=j.id;
 IF identity IS DISTINCT FROM j.submitter_identity OR r.id IS NULL OR j.current_revision_id<>r.id OR r.metadata->>'parserPolicy' IS DISTINCT FROM 'STRICT_ORG_BUNDLE_V1' OR r.metadata->>'manifestDigest' IS DISTINCT FROM p_input->>'manifestDigest' OR r.metadata->>'contractsDigest' IS DISTINCT FROM p_input->>'contractsDigest' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
 IF jsonb_typeof(p_input->'contracts') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'contracts')<>3 OR (SELECT count(DISTINCT value->>'dataset') FROM jsonb_array_elements(p_input->'contracts'))<>3 THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 FOR binding IN SELECT value FROM jsonb_array_elements(p_input->'contracts') LOOP
  ds:=binding->>'dataset';IF ds NOT IN ('ORG01','ORG02','ORG03') THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
  PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',(binding->>'contractVersionId')::uuid,'WRITE');
  SELECT v0.* INTO v FROM governance_catalog.import_contract_version v0 JOIN governance_catalog.import_contract c ON c.id=v0.contract_id JOIN governance_catalog.object o ON o.id=c.dataset_id WHERE v0.id=(binding->>'contractVersionId')::uuid AND c.id=(binding->>'contractId')::uuid AND c.profile='CORE' AND c.bundle_org AND o.code=ds AND v0.definition->>'templateVersion'=ds||'_BUNDLE_CORE_V1';
  IF v.id IS NULL OR (ds='ORG01' AND v.contract_id<>j.contract_id) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 END LOOP;
 FOR sc IN SELECT jsonb_array_elements_text(p_input->'scopes') LOOP
  IF sc NOT IN ('NORTH','SOUTH') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM organization_master.authorize(p_actor,NULL,sc,'READ');
 END LOOP;
 PERFORM organization_master.bundle_dimension_access(p_actor,p_input->'contracts',p_input->'dimensions','READ');
 PERFORM organization_master.bundle_dimension_access(p_actor,p_input->'contracts',p_input->'dimensions','STORE');
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.protected_artifact WHERE id=(p_input->>'rawId')::uuid AND job_id=j.id AND revision_id=r.id AND kind='RAW_FILE' AND campus=p_input->>'campus') OR NOT EXISTS(SELECT 1 FROM governance_catalog.protected_artifact WHERE id=(p_input->>'manifestId')::uuid AND job_id=j.id AND revision_id=r.id AND kind='RAW_CELL' AND campus=p_input->>'campus') THEN RAISE EXCEPTION 'BUNDLE_CONTEXT_REQUIRED';END IF;
 INSERT INTO organization_master.bundle_revision(revision_id,job_id,raw_id,manifest_id,campus,bindings,scopes,dimensions,manifest_digest,contracts_digest) VALUES(r.id,j.id,(p_input->>'rawId')::uuid,(p_input->>'manifestId')::uuid,p_input->>'campus',p_input->'contracts',p_input->'scopes',p_input->'dimensions',p_input->>'manifestDigest',p_input->>'contractsDigest') ON CONFLICT DO NOTHING;
 SELECT * INTO b FROM organization_master.bundle_revision WHERE revision_id=r.id;
 IF b.raw_id<>(p_input->>'rawId')::uuid OR b.manifest_id<>(p_input->>'manifestId')::uuid OR b.bindings IS DISTINCT FROM p_input->'contracts' OR b.scopes IS DISTINCT FROM p_input->'scopes' OR b.dimensions IS DISTINCT FROM p_input->'dimensions' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
 RETURN jsonb_build_object('jobId',j.id,'revisionId',r.id,'rawArtifactId',b.raw_id,'manifestArtifactId',b.manifest_id);
END $$;
CREATE FUNCTION organization_master.bundle_read(p_actor text,p_job uuid,p_revision uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b organization_master.bundle_revision;j governance_catalog.import_job;binding jsonb;sc text;
BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 SELECT * INTO b FROM organization_master.bundle_revision WHERE job_id=p_job AND revision_id=p_revision;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=p_job;
 FOR binding IN SELECT value FROM jsonb_array_elements(b.bindings) LOOP PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',(binding->>'contractVersionId')::uuid,'READ');END LOOP;
 FOR sc IN SELECT jsonb_array_elements_text(b.scopes) LOOP PERFORM organization_master.authorize(p_actor,NULL,sc,'READ');END LOOP;
 RETURN to_jsonb(b)||jsonb_build_object('currentRevisionId',j.current_revision_id,'makerIdentity',j.submitter_identity,'makerActor',(SELECT ri.original_actor_code FROM governance_catalog.import_input_revision rev JOIN vnext_control.request_identity ri ON ri.identity_code=rev.request_identity AND ri.request_id=rev.request_id WHERE rev.id=b.revision_id),'status',j.status,'sourceVersionId',j.contract_snapshot->'definition'->>'sourceVersionId','transportContractVersionId',j.contract_version_id,'transportRuleVersion',j.contract_snapshot->'definition'->>'ruleVersion');
END $$;
CREATE FUNCTION organization_master.bundle_artifact(p_actor text,p_job uuid,p_revision uuid,p_artifact uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;BEGIN
 r:=organization_master.bundle_read(p_actor,p_job,p_revision);
 PERFORM organization_master.bundle_dimension_access(p_actor,r->'bindings',r->'dimensions','READ');
 IF p_artifact::text NOT IN (r->>'raw_id',r->>'manifest_id') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 RETURN governance_catalog.registration_evidence(p_actor,p_artifact,(r->>'sourceVersionId')::uuid,r->>'campus');
END $$;
CREATE FUNCTION organization_master.require_bundle_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM governance_catalog.import_job j JOIN governance_catalog.import_contract c ON c.id=j.contract_id WHERE j.id=NEW.job_id AND c.bundle_org) AND NEW.metadata->>'parserPolicy' IS DISTINCT FROM 'STRICT_ORG_BUNDLE_V1' THEN RAISE EXCEPTION 'BUNDLE_CONTEXT_REQUIRED';END IF;
 IF NEW.metadata->>'parserPolicy'='STRICT_ORG_BUNDLE_V1' AND NOT EXISTS(SELECT 1 FROM organization_master.bundle_revision WHERE revision_id=NEW.id AND job_id=NEW.job_id) THEN RAISE EXCEPTION 'BUNDLE_CONTEXT_REQUIRED';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER organization_bundle_required AFTER INSERT ON governance_catalog.import_input_revision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organization_master.require_bundle_revision();
REVOKE ALL ON FUNCTION organization_master.bundle_artifact(text,uuid,uuid,uuid),organization_master.bundle_register(text,jsonb),organization_master.bundle_read(text,uuid,uuid),organization_master.require_bundle_revision() FROM PUBLIC,hdi_prototype;
