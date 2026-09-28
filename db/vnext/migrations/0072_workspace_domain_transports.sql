-- Forward-only repair: do not rewrite the installed 0071 migration or its ledger.
SELECT pg_advisory_xact_lock(901002);

CREATE OR REPLACE FUNCTION organization_master.workspace_version_source(p_actor text,p_kind text,p_id uuid,p_version text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE context jsonb;source_input uuid;r organization_master.input;source_version text;transport jsonb;candidate jsonb;v_domain text;
BEGIN
 context:=organization_master.workspace_object_context(p_actor,p_kind,p_id);
 IF context->>'canWrite' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 v_domain:=CASE WHEN p_kind IN ('ORGANIZATION','LICENSE') THEN 'ORG01' WHEN p_kind='CAMPUS' THEN 'ORG02' ELSE 'ORG03' END;
 IF p_kind='ORGANIZATION' THEN SELECT input_id INTO source_input FROM organization_master.version WHERE subject_id=p_id AND number::text=p_version;
 ELSIF p_kind='LICENSE' THEN SELECT input_id INTO source_input FROM organization_master.license_version WHERE license_id=p_id AND number::text=p_version AND NOT revoked;
 ELSIF p_kind='CAMPUS' THEN SELECT e.input_id INTO source_input FROM organization_master.campus_event e JOIN organization_master.campus_version v ON v.event_id=e.id WHERE e.campus_id=p_id AND e.number::text=p_version;
 ELSE SELECT input_id INTO source_input FROM organization_master.operating_version WHERE object_id=p_id AND number::text=p_version AND facts IS NOT NULL;END IF;
 IF source_input IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF p_kind IN ('RELATION','SCOPE') THEN PERFORM organization_master.operating_input_read(p_actor,source_input,'READ_RESTRICTED');ELSE PERFORM organization_master.input_read(p_actor,source_input,'READ_RESTRICTED');END IF;
 SELECT * INTO r FROM organization_master.input WHERE id=source_input;
 IF r.domain IS DISTINCT FROM v_domain THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 -- Bundle jobs have a transport contract for the whole workbook. The immutable
 -- per-domain binding, not that root transport, identifies this child's source.
 IF EXISTS(SELECT 1 FROM organization_master.bundle_child WHERE input_id=r.id) THEN
  SELECT v.definition->>'sourceVersionId' INTO source_version
  FROM organization_master.bundle_revision b CROSS JOIN LATERAL jsonb_array_elements(b.bindings) binding
  JOIN governance_catalog.import_contract_version v ON v.id=(binding->>'contractVersionId')::uuid AND v.contract_id=(binding->>'contractId')::uuid
  JOIN governance_catalog.import_contract c ON c.id=v.contract_id
  JOIN governance_catalog.object o ON o.id=c.dataset_id
  WHERE b.job_id=r.job_id AND b.revision_id=r.job_revision AND binding->>'dataset'=v_domain AND o.code=v_domain AND c.bundle_org;
 ELSE
  SELECT v.definition->>'sourceVersionId' INTO source_version FROM governance_catalog.import_job j JOIN governance_catalog.import_contract_version v ON v.id=j.contract_version_id WHERE j.id=r.job_id;
 END IF;
 -- A readable, explicitly published domain transport may be selected, but never
 -- provisioned here. No source/version or authority is inferred from its name.
 IF source_version IS NOT NULL THEN
  FOR candidate IN SELECT value FROM jsonb_array_elements(governance_catalog.contract_read(p_actor,jsonb_build_object('scope','SYNTHETIC','mode','CURRENT'))) LOOP
   IF candidate->>'status'='PUBLISHED' AND candidate->>'dataset'=v_domain AND candidate->>'profile'='CORE'
    AND candidate->'definition'->>'templateVersion'=v_domain||'_MANUAL_CORE_V1'
    AND candidate->'definition'->>'sourceVersionId'=source_version THEN
    transport:=jsonb_build_object('contractId',candidate->>'id','contractVersionId',candidate->>'versionId');EXIT;
   END IF;
  END LOOP;
 END IF;
 RETURN context||jsonb_build_object('inputId',source_input,'transport',transport);
END $$;

CREATE OR REPLACE FUNCTION organization_master.workspace_transport_authorize(p_actor text,p_input jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r organization_master.workspace_draft_revision;identity text;ref jsonb:=p_input->'workspaceDraft';selected governance_catalog.import_contract_version;v_domain text;source_version text;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE');
 IF p_input->>'action' IS DISTINCT FROM 'CREATE' OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR p_input->>'profile' IS DISTINCT FROM 'CORE' OR p_input->>'reason' IS DISTINCT FROM 'WORKSPACE_MANUAL' OR p_input->'input'->>'kind' IS DISTINCT FROM 'METADATA_ONLY' OR jsonb_typeof(ref) IS DISTINCT FROM 'object' OR ref-ARRAY['id','expectedVersion']<>'{}'::jsonb THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 SELECT * INTO r FROM organization_master.workspace_draft_revision WHERE id=(ref->>'id')::uuid ORDER BY number DESC LIMIT 1;
 v_domain:=r.metadata->>'domain';
 IF r.identity_code IS DISTINCT FROM identity OR r.state IS DISTINCT FROM 'EDITING' OR r.number::text IS DISTINCT FROM ref->>'expectedVersion' OR coalesce(v_domain,'') NOT IN ('ORG01','ORG02','ORG03') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM organization_master.workspace_authorize(p_actor,r.metadata,'READ');
 PERFORM organization_master.workspace_authorize(p_actor,r.metadata,'READ_RESTRICTED');
 PERFORM organization_master.workspace_authorize(p_actor,r.metadata,'WRITE');
 IF r.metadata->'transport'->>'contractId' IS DISTINCT FROM p_input->>'contractId' OR r.metadata->'transport'->>'contractVersionId' IS DISTINCT FROM p_input->>'contractVersionId' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 -- Repeat the domain check at the SQL boundary, even for catalog administrators.
 SELECT v.* INTO selected FROM governance_catalog.import_contract_version v
 JOIN governance_catalog.import_contract c ON c.id=v.contract_id
 JOIN governance_catalog.object o ON o.id=c.dataset_id
 WHERE v.id=(p_input->>'contractVersionId')::uuid AND c.id=(p_input->>'contractId')::uuid
 AND o.scope='SYNTHETIC' AND o.kind='DATASET' AND o.code=v_domain AND c.profile='CORE' AND NOT c.bundle_org
 AND v.definition->>'templateVersion'=v_domain||'_MANUAL_CORE_V1';
 IF selected.id IS NULL OR selected.definition->>'sourceVersionId' IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',selected.id,'READ');
 source_version:=selected.definition->>'sourceVersionId';
 -- Only re-expression of an authorized target's genuine immutable facts under
 -- the same source version qualifies. A changed source, new object or unbound
 -- transport still requires ordinary dataset-wide catalog WRITE. No grant rows
 -- are created, and FILE transports never enter this exception.
 IF NOT EXISTS(
  SELECT 1 FROM organization_master.input i
  JOIN governance_catalog.import_job j ON j.id=i.job_id
  JOIN governance_catalog.import_contract_version original ON original.id=j.contract_version_id
  WHERE i.domain=v_domain AND (
   (v_domain='ORG01' AND (EXISTS(SELECT 1 FROM organization_master.version v WHERE v.input_id=i.id AND v.subject_id=(r.metadata->>'target')::uuid)
    OR EXISTS(SELECT 1 FROM organization_master.license_version v JOIN organization_master.license l ON l.id=v.license_id WHERE v.input_id=i.id AND l.subject_id=(r.metadata->>'target')::uuid))) OR
   (v_domain='ORG02' AND EXISTS(SELECT 1 FROM organization_master.campus_event e WHERE e.input_id=i.id AND e.campus_id=(r.metadata->>'target')::uuid)) OR
   (v_domain='ORG03' AND EXISTS(SELECT 1 FROM organization_master.operating_version v WHERE v.input_id=i.id AND v.object_id=(r.metadata->>'target')::uuid))
  ) AND (
   (NOT EXISTS(SELECT 1 FROM organization_master.bundle_child bc WHERE bc.input_id=i.id) AND original.definition->>'sourceVersionId'=source_version)
   OR EXISTS(
    SELECT 1 FROM organization_master.bundle_child bc
    JOIN organization_master.bundle_revision b ON b.job_id=i.job_id AND b.revision_id=i.job_revision
    CROSS JOIN LATERAL jsonb_array_elements(b.bindings) binding
    JOIN governance_catalog.import_contract_version v ON v.id=(binding->>'contractVersionId')::uuid AND v.contract_id=(binding->>'contractId')::uuid
    JOIN governance_catalog.import_contract c ON c.id=v.contract_id
    JOIN governance_catalog.object o ON o.id=c.dataset_id
    WHERE bc.input_id=i.id AND binding->>'dataset'=v_domain AND o.code=v_domain AND c.bundle_org AND v.definition->>'sourceVersionId'=source_version
   )
  )
 ) THEN PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',selected.id,'WRITE');END IF;
END $$;
REVOKE ALL ON FUNCTION organization_master.workspace_version_source(text,text,uuid,text),organization_master.workspace_transport_authorize(text,jsonb) FROM PUBLIC,hdi_prototype;
