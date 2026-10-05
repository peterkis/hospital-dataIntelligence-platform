SELECT pg_advisory_xact_lock(901002);

-- The accepted snapshot freezes code identity/meaning, not the last possible end
-- of all later use. Approved unchanged successors must prove their own period and
-- source coverage; no successor can revive an expired winner or change the pin.
CREATE OR REPLACE FUNCTION governance_catalog.subject_code_coverage(p_actor text,p_pin jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item jsonb;code jsonb;current_version governance_catalog.subject_code_version;current_code jsonb;part record;semantic text;BEGIN
 item:=governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',p_pin->>'systemId','versionId',p_pin->>'versionId','recordAsOf',to_char(p_r,'YYYY-MM-DD"T"HH24:MI:SS.US')))->0;
 IF p_pin->>'owner' IS DISTINCT FROM 'governance-catalog/subject-code' OR item IS NULL OR item->>'head' IS DISTINCT FROM p_pin->>'version' THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 SELECT value INTO code FROM jsonb_array_elements(item->'codes') WHERE value->>'code'=p_pin->>'code';
 IF code IS NULL OR item->>'status' IS DISTINCT FROM 'APPROVED' OR code->>'status' IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'SUBJECT_CODE_REVIEW_REQUIRED';END IF;
 IF governance_catalog.contract_time(item->>'validFrom')>p_from THEN RAISE EXCEPTION 'SUBJECT_CODE_PERIOD_NOT_COVERED';END IF;
 semantic:=encode(sha256(convert_to((code-ARRAY['name','replacement'])::text,'UTF8')),'hex');
 FOR part IN
  WITH known AS(SELECT v.* FROM governance_catalog.subject_code_version v JOIN governance_catalog.subject_code_approval a ON a.version_id=v.id WHERE v.system_id=(p_pin->>'systemId')::uuid AND v.recorded_at<=p_r AND a.recorded_at<=p_r),
  points AS(SELECT p_from b UNION SELECT p_to WHERE p_to IS NOT NULL UNION SELECT governance_catalog.contract_time(metadata->>'validFrom') FROM known WHERE governance_catalog.contract_time(metadata->>'validFrom')>p_from AND (p_to IS NULL OR governance_catalog.contract_time(metadata->>'validFrom')<p_to) UNION SELECT governance_catalog.contract_time(metadata->>'validTo') FROM known WHERE metadata->>'validTo' IS NOT NULL AND governance_catalog.contract_time(metadata->>'validTo')>p_from AND (p_to IS NULL OR governance_catalog.contract_time(metadata->>'validTo')<p_to)),
  pieces AS(SELECT b,lead(b) OVER(ORDER BY b) e FROM points) SELECT b,e FROM pieces WHERE p_to IS NULL OR b<p_to
 LOOP
  SELECT v.* INTO current_version FROM governance_catalog.subject_code_version v JOIN governance_catalog.subject_code_approval a ON a.version_id=v.id WHERE v.system_id=(p_pin->>'systemId')::uuid AND v.recorded_at<=p_r AND a.recorded_at<=p_r AND governance_catalog.contract_time(v.metadata->>'validFrom')<=part.b ORDER BY governance_catalog.contract_time(v.metadata->>'validFrom') DESC,v.number DESC LIMIT 1;
  IF current_version.id IS NULL OR (current_version.metadata->>'validTo' IS NOT NULL AND governance_catalog.contract_time(current_version.metadata->>'validTo')<=part.b) THEN RAISE EXCEPTION 'SUBJECT_CODE_PERIOD_NOT_COVERED';END IF;
  SELECT value INTO current_code FROM jsonb_array_elements(current_version.metadata->'codes') WHERE value->>'code'=p_pin->>'code';
  IF current_code IS NULL OR current_code->>'status' IS DISTINCT FROM 'ACTIVE' OR encode(sha256(convert_to((current_code-ARRAY['name','replacement'])::text,'UTF8')),'hex')<>semantic THEN RAISE EXCEPTION 'SUBJECT_CODE_REVIEW_REQUIRED';END IF;
  PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',(current_version.metadata->>'sourceId')::uuid,(current_version.metadata->>'sourceVersionId')::uuid);
  IF NOT governance_catalog.source_valid_spans((current_version.metadata->>'sourceVersionId')::uuid,p_r) @> tsrange(part.b,part.e,'[)') THEN RAISE EXCEPTION 'SUBJECT_CODE_PERIOD_NOT_COVERED';END IF;
 END LOOP;
 RETURN jsonb_build_object('adoption',p_pin,'semanticDigest',encode(sha256(convert_to((code-ARRAY['name','replacement'])::text,'UTF8')),'hex'),'sourceVersionId',item->>'sourceVersionId');
END $$;
REVOKE ALL ON FUNCTION governance_catalog.subject_code_coverage(text,jsonb,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
