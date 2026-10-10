SELECT pg_advisory_xact_lock(901002);

-- Boundary discovery does not select a replacement value or grant admission.
-- Each interval is evaluated by the original parameter_value_evaluate routine.
CREATE FUNCTION governance_catalog.parameter_value_boundaries(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE anchor governance_catalog.parameter_value;v record;d record;point timestamp;piece tsrange;
 from_b timestamp;to_b timestamp;cutoff timestamp;points timestamp[]:=ARRAY[]::timestamp[];
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR NOT p_input ?& ARRAY['id','validFrom','validTo','recordAsOf']
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('id','versionId','validFrom','validTo','recordAsOf')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 from_b:=governance_catalog.contract_time(p_input->>'validFrom');to_b:=CASE WHEN p_input->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(p_input->>'validTo') END;
 cutoff:=governance_catalog.contract_time(p_input->>'recordAsOf');
 IF from_b IS NULL OR cutoff IS NULL OR to_b<=from_b THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 PERFORM governance_catalog.parameter_value_read(p_actor,p_input-ARRAY['validFrom','validTo'],false);
 SELECT * INTO anchor FROM governance_catalog.parameter_value WHERE id=(p_input->>'id')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 -- Approval and knowledge use R; expired finite successors remain contributors
 -- because the original evaluator never restores a superseded older version.
 FOR v IN SELECT x.* FROM governance_catalog.parameter_value_version x JOIN governance_catalog.parameter_value_approval a ON a.version_id=x.id
  WHERE x.value_id=anchor.id AND x.recorded_at<=cutoff AND a.recorded_at<=cutoff AND (to_b IS NULL OR x.valid_from<to_b) LOOP
  PERFORM governance_catalog.parameter_value_scope_access(p_actor,v.definition_version_id,anchor.scope_context,'READ');
  points:=points||ARRAY[v.valid_from,v.valid_to];
 END LOOP;
 FOR d IN SELECT x.* FROM governance_catalog.parameter_version x JOIN governance_catalog.parameter_approval a ON a.version_id=x.id
  WHERE x.parameter_id=anchor.parameter_id AND x.recorded_at<=cutoff AND a.recorded_at<=cutoff AND (to_b IS NULL OR x.valid_from<to_b) LOOP
  PERFORM governance_catalog.parameter_value_scope_access(p_actor,d.id,anchor.scope_context,'READ');
  points:=points||ARRAY[d.valid_from,d.valid_to];
  FOR piece IN SELECT unnest(governance_catalog.source_valid_spans(d.system_version_id,cutoff)*tsmultirange(tsrange(from_b,to_b,'[)'))) LOOP
   points:=points||ARRAY[lower(piece),upper(piece)];
  END LOOP;
 END LOOP;
 RETURN coalesce((SELECT jsonb_agg(to_char(p,'YYYY-MM-DD"T"HH24:MI:SS.US') ORDER BY p) FROM
  (SELECT DISTINCT unnest(points) p) b WHERE p>from_b AND (to_b IS NULL OR p<to_b)),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.parameter_value_boundaries(text,jsonb) FROM PUBLIC,hdi_prototype;
