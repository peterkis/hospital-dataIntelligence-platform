-- Forward-only authorization repair. Keep 0071/0072 and stored drafts immutable.
SELECT pg_advisory_xact_lock(901002);

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
 SELECT v.* INTO selected FROM governance_catalog.import_contract_version v
 JOIN governance_catalog.import_contract c ON c.id=v.contract_id
 JOIN governance_catalog.object o ON o.id=c.dataset_id
 WHERE v.id=(p_input->>'contractVersionId')::uuid AND c.id=(p_input->>'contractId')::uuid
 AND o.scope='SYNTHETIC' AND o.kind='DATASET' AND o.code=v_domain AND c.profile='CORE' AND NOT c.bundle_org
 AND v.definition->>'templateVersion'=v_domain||'_MANUAL_CORE_V1';
 IF selected.id IS NULL OR selected.definition->>'sourceVersionId' IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',selected.id,'READ');
 source_version:=selected.definition->>'sourceVersionId';
 -- The subject is not a provenance union of all licenses held by it. Revisions
 -- of a license must use that exact license version and its actual subject.
 -- Legacy metadata without licenseTarget cannot establish this exception;
 -- the owner can explicitly resave the authenticated draft with the new metadata.
 IF NOT EXISTS(
  SELECT 1 FROM organization_master.input i
  JOIN governance_catalog.import_job j ON j.id=i.job_id
  JOIN governance_catalog.import_contract_version original ON original.id=j.contract_version_id
  WHERE i.domain=v_domain AND (
   (v_domain='ORG01' AND (
    (r.metadata->>'action' IN ('REVISE','VERIFY_REGISTRATION') AND EXISTS(
     SELECT 1 FROM organization_master.version v WHERE v.input_id=i.id AND v.subject_id=(r.metadata->>'target')::uuid
    )) OR
    (r.metadata->>'action' IN ('REVISE_LICENSE','REVOKE_LICENSE') AND EXISTS(
     SELECT 1 FROM organization_master.license_version v JOIN organization_master.license l ON l.id=v.license_id
     WHERE v.input_id=i.id AND l.subject_id=(r.metadata->>'target')::uuid
      AND v.license_id=(r.metadata->'licenseTarget'->>'id')::uuid
      AND v.number::text=r.metadata->'licenseTarget'->>'version' AND NOT v.revoked
    ))
   )) OR
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
REVOKE ALL ON FUNCTION organization_master.workspace_transport_authorize(text,jsonb) FROM PUBLIC,hdi_prototype;
