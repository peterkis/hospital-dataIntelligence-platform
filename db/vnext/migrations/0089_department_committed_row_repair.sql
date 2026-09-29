-- Forward-only repair for the persistent 0087 installation.
-- The function was added and then refined after 0087 was deployed; keep the
-- installed 0087 ledger bytes immutable and install the current contract here.
SELECT pg_advisory_xact_lock(901002);

CREATE OR REPLACE FUNCTION department_master.committed_row(p_actor text,p_job_id uuid,p_source_row integer,p_intent text,p_target_id uuid,p_expected_version bigint,p_org_code text,p_valid_from timestamp,p_valid_to timestamp,p_facts jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');
 IF p_source_row NOT BETWEEN 1 AND 1048576 OR p_intent NOT IN ('CREATE','REVISE') OR p_intent='CREATE' AND p_target_id IS NOT NULL OR p_intent='REVISE' AND p_target_id IS NULL OR jsonb_typeof(p_facts) IS DISTINCT FROM 'object' OR p_facts->>'commandDigest' !~ '^[a-f0-9]{64}$' OR nullif(btrim(p_org_code),'') IS NULL OR p_valid_from IS NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 RETURN EXISTS(
  SELECT 1
  FROM department_master.version v
  JOIN department_master.input i ON i.id=v.input_id
  JOIN department_master.department d ON d.id=v.department_id
  WHERE i.job_id=p_job_id AND d.code=p_org_code AND v.valid_from=p_valid_from AND v.valid_to IS NOT DISTINCT FROM p_valid_to
    AND v.facts->>'commandDigest'=p_facts->>'commandDigest'
    AND (v.facts-'verificationId'-'commandDigest')=(p_facts-'verificationId'-'commandDigest')
    AND ((p_intent='CREATE' AND p_expected_version IS NULL AND v.number=1)
      OR (p_intent='REVISE' AND p_expected_version IS NOT NULL AND v.department_id=p_target_id AND v.number-1=p_expected_version))
 );
END $$;
REVOKE ALL ON FUNCTION department_master.committed_row(text,uuid,integer,text,uuid,bigint,text,timestamp,timestamp,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION department_master.committed_row(text,uuid,integer,text,uuid,bigint,text,timestamp,timestamp,jsonb) TO hdi_prototype;
