SELECT pg_advisory_xact_lock(901002);

-- Capture contributors in the caller's MVCC snapshot. These are read
-- projections over the original Owner algorithms, not another fact ledger.
CREATE FUNCTION governance_catalog.care_source_window_references(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pin uuid;refs jsonb:='[]';BEGIN
 IF p_from IS NULL OR p_r IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',p_id);
 FOR pin IN SELECT version_id FROM governance_catalog.definition_spans(p_id,p_r) LOOP
  IF governance_catalog.source_valid_spans(pin,p_r)*tsmultirange(tsrange(p_from,p_to,'[)'))='{}'::tsmultirange THEN CONTINUE;END IF;
  PERFORM governance_catalog.unit_ward_source_reference(p_actor,p_id,pin);
  refs:=refs||jsonb_build_array(jsonb_build_object('kind','SOURCE','id',p_id,'versionId',pin));
 END LOOP;RETURN refs;
END $$;

CREATE FUNCTION governance_catalog.care_parameter_boundary_references(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE anchor governance_catalog.parameter_value;pin uuid;cutoff timestamp;to_b timestamp;refs jsonb:='[]';BEGIN
 -- The native read validates the closed input, anchor and scope authority.
 PERFORM governance_catalog.parameter_value_boundaries(p_actor,p_input);
 SELECT * INTO STRICT anchor FROM governance_catalog.parameter_value WHERE id=(p_input->>'id')::uuid;
 cutoff:=governance_catalog.contract_time(p_input->>'recordAsOf');to_b:=CASE WHEN p_input->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(p_input->>'validTo') END;
 FOR pin IN
  SELECT x.definition_version_id FROM governance_catalog.parameter_value_version x JOIN governance_catalog.parameter_value_approval a ON a.version_id=x.id WHERE x.value_id=anchor.id AND x.recorded_at<=cutoff AND a.recorded_at<=cutoff AND (to_b IS NULL OR x.valid_from<to_b)
  UNION SELECT x.id FROM governance_catalog.parameter_version x JOIN governance_catalog.parameter_approval a ON a.version_id=x.id WHERE x.parameter_id=anchor.parameter_id AND x.recorded_at<=cutoff AND a.recorded_at<=cutoff AND (to_b IS NULL OR x.valid_from<to_b)
 LOOP
  PERFORM governance_catalog.parameter_value_scope_access(p_actor,pin,anchor.scope_context,'READ');
  refs:=refs||jsonb_build_array(jsonb_build_object('kind','PARAMETER','versionId',pin,'applicability',anchor.scope_context));
 END LOOP;RETURN refs;
END $$;

CREATE FUNCTION governance_catalog.care_subject_boundary_references(p_actor text,p_pin jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v record;refs jsonb:='[]';BEGIN
 PERFORM governance_catalog.subject_code_boundaries(p_actor,p_pin,p_from,p_to,p_r);
 FOR v IN SELECT x.* FROM governance_catalog.subject_code_version x JOIN governance_catalog.subject_code_approval a ON a.version_id=x.id WHERE x.system_id=(p_pin->>'systemId')::uuid AND x.recorded_at<=p_r AND a.recorded_at<=p_r AND (p_to IS NULL OR governance_catalog.contract_time(x.metadata->>'validFrom')<p_to) LOOP
  refs:=refs||jsonb_build_array(jsonb_build_object('kind','SOURCE','id',v.metadata->>'sourceId','versionId',v.metadata->>'sourceVersionId'));
 END LOOP;RETURN refs;
END $$;

-- Recheck exactly the captured pins with current grants, including each
-- original recursive source parent. Never reselect contributors here.
CREATE FUNCTION governance_catalog.care_read_reference_authority(p_actor text,p_references jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ref jsonb;BEGIN
 IF jsonb_typeof(p_references) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(p_references) LOOP
  IF jsonb_typeof(ref) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
  IF ref->>'kind'='SOURCE' THEN
   IF NOT ref ?& ARRAY['kind','id','versionId'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(ref) k WHERE k NOT IN ('kind','id','versionId')) OR ref->>'id' IS NULL OR ref->>'versionId' IS NULL THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
   PERFORM governance_catalog.unit_ward_source_reference(p_actor,(ref->>'id')::uuid,(ref->>'versionId')::uuid);
  ELSIF ref->>'kind'='PARAMETER' THEN
   IF NOT ref ?& ARRAY['kind','versionId','applicability'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(ref) k WHERE k NOT IN ('kind','versionId','applicability')) OR ref->>'versionId' IS NULL OR jsonb_typeof(ref->'applicability') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
   PERFORM governance_catalog.parameter_value_scope_access(p_actor,(ref->>'versionId')::uuid,ref->'applicability','READ');
  ELSE RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.care_source_window_references(text,uuid,timestamp,timestamp,timestamp),governance_catalog.care_parameter_boundary_references(text,jsonb),governance_catalog.care_subject_boundary_references(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.care_read_reference_authority(text,jsonb) FROM PUBLIC,hdi_prototype;
