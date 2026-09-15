SELECT pg_advisory_xact_lock(901002);
-- A new policy never reinterprets a historical STRICT_V1 revision.
DO $migration$
DECLARE body text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.import_job_command(text,jsonb)'::regprocedure);
 IF position('metadata->>''parserPolicy''=''STRICT_V1''' IN body)=0 THEN RAISE EXCEPTION 'POLICY_PATCH_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,'metadata->>''parserPolicy''=''STRICT_V1''','metadata->>''parserPolicy'' IN (''STRICT_V1'',''STRICT_V2'')');
END $migration$;
ALTER TABLE governance_catalog.import_input_revision DROP CONSTRAINT import_input_revision_metadata_shape_check;
ALTER TABLE governance_catalog.import_input_revision ADD CONSTRAINT import_input_revision_metadata_shape_check CHECK (
 CASE WHEN jsonb_typeof(metadata)='object' THEN
 ((metadata->>'kind'='FILE' AND metadata->>'format' IN ('CSV','JSON','XLSX') AND metadata->>'parserPolicy' IN ('STRICT_V1','STRICT_V2') AND metadata-ARRAY['kind','format','parserPolicy']='{}'::jsonb)
 OR (metadata->>'kind'='METADATA_ONLY' AND jsonb_typeof(metadata->'declaredSha256')='string' AND metadata->>'declaredSha256' ~ '^[a-f0-9]{64}$' AND metadata-ARRAY['kind','declaredSha256']='{}'::jsonb)) IS TRUE ELSE false END);

CREATE TABLE governance_catalog.parse_provenance (
 artifact_id uuid PRIMARY KEY REFERENCES governance_catalog.protected_artifact(id),
 source_artifact_id uuid NOT NULL REFERENCES governance_catalog.protected_artifact(id),
 job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),
 revision_id uuid NOT NULL REFERENCES governance_catalog.import_input_revision(id),
 contract_version_id uuid NOT NULL REFERENCES governance_catalog.import_contract_version(id),
 policy text NOT NULL CHECK(policy IN ('STRICT_V1','STRICT_V2')),
 structural_status text NOT NULL CHECK(structural_status IN ('PARSED','REJECTED')),
 signature text NOT NULL CHECK(signature ~ '^[a-f0-9]{64}$'),
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp())
);
CREATE TRIGGER parse_provenance_immutable BEFORE UPDATE OR DELETE ON governance_catalog.parse_provenance FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
REVOKE ALL ON governance_catalog.parse_provenance FROM PUBLIC,hdi_prototype;
ALTER TABLE governance_catalog.parse_provenance ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION governance_catalog.read_parse(p_actor text,p_job uuid,p_artifact uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
BEGIN
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',p_job));
 RETURN (SELECT to_jsonb(p) FROM governance_catalog.parse_provenance p WHERE job_id=p_job AND artifact_id=p_artifact);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.read_parse(text,uuid,uuid) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.read_parse(text,uuid,uuid) TO hdi_prototype;

-- Internal application boundary. Signature is checked with the process key by the
-- consuming Owner; callers of the generic encrypted store cannot mint provenance.
CREATE FUNCTION governance_catalog.register_parse(p_actor text,p_artifact uuid,p_source uuid,p_signature text,p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE a governance_catalog.protected_artifact; s governance_catalog.protected_artifact; j jsonb; previous governance_catalog.parse_provenance;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 SELECT * INTO a FROM governance_catalog.protected_artifact WHERE id=p_artifact;
 SELECT * INTO s FROM governance_catalog.protected_artifact WHERE id=p_source;
 IF a.id IS NULL OR s.id IS NULL OR a.kind<>'RAW_CELL' OR s.kind<>'RAW_FILE' OR a.job_id<>s.job_id OR a.revision_id<>s.revision_id OR a.campus<>s.campus OR a.purpose<>s.purpose THEN RAISE EXCEPTION 'PARSE_SOURCE_REQUIRED'; END IF;
 j:=governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',a.job_id));
 IF j->>'currentRevisionId'<>a.revision_id::text THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
 PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',(j->'contract'->>'versionId')::uuid,'WRITE');
 SELECT * INTO previous FROM governance_catalog.parse_provenance WHERE artifact_id=p_artifact;
 IF FOUND THEN
  IF previous.source_artifact_id<>p_source OR previous.signature<>p_signature OR previous.structural_status<>p_status THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
  RETURN;
 END IF;
 INSERT INTO governance_catalog.parse_provenance(artifact_id,source_artifact_id,job_id,revision_id,contract_version_id,policy,structural_status,signature)
 SELECT a.id,s.id,a.job_id,a.revision_id,(j->'contract'->>'versionId')::uuid,metadata->>'parserPolicy',p_status,p_signature FROM governance_catalog.import_input_revision WHERE id=a.revision_id AND metadata->>'kind'='FILE';
 IF NOT FOUND THEN RAISE EXCEPTION 'FILE_REVISION_REQUIRED'; END IF;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.register_parse(text,uuid,uuid,text,text) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.register_parse(text,uuid,uuid,text,text) TO hdi_prototype;
