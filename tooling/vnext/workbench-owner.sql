-- Receipt-owned, finite E2E only. Never installed in the persistent database.
CREATE SCHEMA p0_09_owner;
CREATE TABLE p0_09_owner.fact(id uuid PRIMARY KEY DEFAULT uuidv7(),version integer NOT NULL DEFAULT 1,value jsonb NOT NULL);
CREATE FUNCTION p0_09_owner.read_source(actor text,input jsonb,contract_version uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE access jsonb;
BEGIN
 access:=governance_catalog.import_workbench_file_access(actor,jsonb_build_object('scope','SYNTHETIC','contractVersionId',contract_version,'campus',input->>'campus','purpose',input->>'purpose'));
 IF NOT (access->>'canReadProtected')::boolean THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.import_job j WHERE j.id=(input->>'jobId')::uuid AND j.contract_version_id=contract_version AND j.submitter_identity='SYNTHETIC_MAKER') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest)
 VALUES(actor,(input->>'jobId')::uuid,'FINITE_FILE_SOURCE_READ','FINITE_E2E_SOURCE_USE',encode(sha256(convert_to(jsonb_build_object('jobId',input->>'jobId','revisionId',input->>'revisionId','contractVersionId',contract_version,'campus',input->>'campus','purpose',input->>'purpose')::text,'UTF8')),'hex'));
END $$;
CREATE FUNCTION p0_09_owner.write_fact(command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE f p0_09_owner.fact;
BEGIN
 IF command->>'owner'<>'FINITE_FILE_ROW' OR command->>'intent'<>'CREATE' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
 INSERT INTO p0_09_owner.fact(value) VALUES(command->'value') RETURNING * INTO f;
 RETURN jsonb_build_object('owner','FINITE_FILE_ROW','id',f.id,'version',f.version::text);
END $$;
CREATE FUNCTION p0_09_owner.exact_fact(p_fact jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('owner','FINITE_FILE_ROW','id',id,'version',version::text) FROM p0_09_owner.fact WHERE id=(p_fact->>'id')::uuid AND version::text=p_fact->>'version' AND p_fact->>'owner'='FINITE_FILE_ROW';
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA p0_09_owner FROM PUBLIC,hdi_prototype;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA p0_09_owner FROM PUBLIC,hdi_prototype;
