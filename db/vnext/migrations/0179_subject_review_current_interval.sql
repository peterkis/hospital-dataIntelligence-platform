SELECT pg_advisory_xact_lock(901002);

-- Current code coverage chooses the greatest business start, then version number.
-- An expired winner leaves a gap; an earlier snapshot never resumes afterwards.
-- At approval this new (highest-numbered) snapshot can therefore be current only
-- until the first already-approved, later business start known at that approval R.
CREATE OR REPLACE FUNCTION care_organization.subject_reassess_code(p_actor text,p_system uuid,p_version uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE released jsonb;old jsonb;old_code jsonb;new_code jsonb;relation care_organization.subject_relation;version care_organization.subject_relation_version;reason text;blocking boolean;affected tsrange;ending timestamp;next_start timestamp;approval_r timestamp;released_from timestamp;BEGIN
 released:=governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',p_system,'versionId',p_version))->0;IF released->>'status' IS DISTINCT FROM 'APPROVED' THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 approval_r:=governance_catalog.contract_time(released->>'approvedAt');released_from:=governance_catalog.contract_time(released->>'validFrom');
 SELECT min(governance_catalog.contract_time(v.metadata->>'validFrom')) INTO next_start
 FROM governance_catalog.subject_code_version v JOIN governance_catalog.subject_code_approval a ON a.version_id=v.id
 WHERE v.system_id=p_system AND v.recorded_at<=approval_r AND a.recorded_at<=approval_r AND governance_catalog.contract_time(v.metadata->>'validFrom')>released_from;
 FOR relation IN SELECT * FROM care_organization.subject_relation LOOP
  SELECT * INTO version FROM care_organization.subject_relation_version WHERE relation_id=relation.id AND action IN ('RECORD','REVISE') ORDER BY number DESC LIMIT 1;
  IF version.id IS NULL OR version.facts->'adoption'->>'systemId'<>p_system::text THEN CONTINUE;END IF;
  SELECT min(valid_from) INTO ending FROM care_organization.subject_relation_version WHERE relation_id=relation.id AND action='RETIRE';ending:=least(ending,version.valid_to,next_start);
  IF ending IS NOT NULL AND ending<=version.valid_from THEN CONTINUE;END IF;
  affected:=tsrange(version.valid_from,ending,'[)')*tsrange(released_from,CASE WHEN released->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(released->>'validTo') END,'[)');IF isempty(affected) THEN CONTINUE;END IF;
  old:=governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',p_system,'versionId',version.facts->'adoption'->>'versionId'))->0;
  SELECT value INTO old_code FROM jsonb_array_elements(old->'codes') WHERE value->>'code'=version.facts->'adoption'->>'code';SELECT value INTO new_code FROM jsonb_array_elements(released->'codes') WHERE value->>'code'=version.facts->'adoption'->>'code';
  reason:=CASE WHEN new_code IS NULL THEN 'TARGET_MISSING' WHEN new_code->>'status'<>'ACTIVE' THEN 'TARGET_RETIRED' WHEN new_code->>'meaning' IS DISTINCT FROM old_code->>'meaning' THEN 'TARGET_MEANING_CHANGED' WHEN new_code->>'name' IS DISTINCT FROM old_code->>'name' THEN 'TARGET_LABEL_CHANGED' ELSE NULL END;
  IF reason IS NULL THEN CONTINUE;END IF;blocking:=reason<>'TARGET_LABEL_CHANGED';
  INSERT INTO care_organization.subject_review_case(relation_id,accepted_version_id,code_version_id,reason,blocking,valid_from,valid_to) VALUES(relation.id,version.id,p_version,reason,blocking,lower(affected),upper(affected)) ON CONFLICT DO NOTHING;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION care_organization.subject_reassess_code(text,uuid,uuid) FROM PUBLIC,hdi_prototype;
