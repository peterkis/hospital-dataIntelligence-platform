SELECT pg_advisory_xact_lock(901002);

-- An evolution FILE revision has exactly one immutable original and one
-- signed Owner input. Unresolved/rejected revisions stay quarantined.
-- Catalog retains its table ownership; this finite port releases only the
-- revision binding after the same current authority as a generic READ.
CREATE FUNCTION governance_catalog.protected_original_context(p_actor text,p_artifact uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a governance_catalog.protected_artifact;j governance_catalog.import_job;rev governance_catalog.import_input_revision;dataset uuid;original uuid;identity text;BEGIN
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 SELECT * INTO a FROM governance_catalog.protected_artifact WHERE id=p_artifact;
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=a.job_id AND scope='SYNTHETIC';
 IF j.id IS NULL OR identity IS DISTINCT FROM j.submitter_identity THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));
 SELECT v.object_id INTO dataset FROM governance_catalog.import_contract_version c JOIN governance_catalog.version v ON v.id=c.dataset_version_id WHERE c.id=j.contract_version_id;
 IF NOT EXISTS(SELECT 1 FROM vnext_control.protected_grant WHERE actor_code=p_actor AND dataset_id=dataset AND campus=a.campus AND purpose=a.purpose AND permission='READ') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF timezone('Asia/Shanghai',clock_timestamp())>=a.expires_at OR NOT EXISTS(SELECT 1 FROM governance_catalog.protected_payload WHERE artifact_id=a.id) THEN RAISE EXCEPTION 'PAYLOAD_UNAVAILABLE';END IF;
 SELECT * INTO rev FROM governance_catalog.import_input_revision WHERE id=a.revision_id AND job_id=a.job_id;
 IF rev.metadata->>'parserPolicy' IS DISTINCT FROM 'STRICT_ORGANIZATION_EVOLUTION_V1' THEN RETURN NULL;END IF;
 IF a.purpose<>'IDENTITY_VERIFY' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 SELECT id INTO original FROM governance_catalog.protected_artifact WHERE job_id=a.job_id AND revision_id=a.revision_id AND kind='RAW_FILE';
 RETURN jsonb_build_object('artifactId',a.id,'originalArtifactId',original,'jobId',a.job_id,'revisionId',a.revision_id,'campus',a.campus);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.protected_original_context(text,uuid) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION department_master.evolution_original_context(p_actor text,p_artifact uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE context jsonb;r department_master.evolution_input;BEGIN
 context:=governance_catalog.protected_original_context(p_actor,p_artifact);
 IF context IS NULL THEN RETURN NULL;END IF;
 PERFORM department_master.evolution_authorize(p_actor,context->>'campus','READ_RESTRICTED');
 SELECT * INTO r FROM department_master.evolution_input WHERE job_id=(context->>'jobId')::uuid AND job_revision=(context->>'revisionId')::uuid;
 RETURN context||jsonb_build_object('input',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('digest',r.digest,'envelope',r.envelope) END);
END $$;
REVOKE ALL ON FUNCTION department_master.evolution_original_context(text,uuid) FROM PUBLIC,hdi_prototype;

-- The host authenticates this complete input before using the finite port.
-- Recheck raw references in SQL and retain a minimal source-access verdict.
CREATE FUNCTION department_master.evolution_original_authorize(p_actor text,p_artifact uuid,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE context jsonb;denied boolean:=false;BEGIN
 BEGIN
  context:=department_master.evolution_original_context(p_actor,p_artifact);
  IF context IS NULL OR context->'input'='null'::jsonb
   OR p_input->>'jobId' IS DISTINCT FROM context->>'jobId'
   OR p_input->>'revisionId' IS DISTINCT FROM context->>'revisionId'
   OR p_input->>'campus' IS DISTINCT FROM context->>'campus'
   OR p_input->>'sourceArtifactId' IS DISTINCT FROM context->>'originalArtifactId'
  THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  PERFORM department_master.evolution_stage_references_authorize(p_actor,p_input);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='ACCESS_DENIED' THEN denied:=true;ELSE RAISE;END IF;END;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest)
 VALUES(p_actor,p_artifact,'EVOLUTION_ORIGINAL_READ',CASE WHEN denied THEN 'ACCESS_DENIED' ELSE 'RAW_REFERENCES_AUTHORIZED' END,encode(sha256(convert_to(p_artifact::text,'UTF8')),'hex'));
 RETURN CASE WHEN denied THEN jsonb_build_object('error','ACCESS_DENIED') ELSE '{}'::jsonb END;
END $$;
REVOKE ALL ON FUNCTION department_master.evolution_original_authorize(text,uuid,jsonb) FROM PUBLIC,hdi_prototype;

-- Only READ returns this private, authenticated scope context. Existing
-- non-evolution and historical-prefix protocols keep their original shape.
DO $repair$
DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('governance_catalog.protected_command(text,text,jsonb,jsonb,text)'::regprocedure);
 needle:='result:=result||jsonb_build_object(''binding'',';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'EVOLUTION_ORIGINAL_READ_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'result:=result||jsonb_build_object(''evolutionScope'',department_master.evolution_original_context(p_actor,a.id));'||chr(10)||needle);
 EXECUTE body;
END $repair$;
