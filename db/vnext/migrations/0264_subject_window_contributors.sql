SELECT pg_advisory_xact_lock(901002);

-- One native winner projection for coverage and its read-only diagnostics.
-- An expired winner remains selected and creates a gap; never fall back.
CREATE FUNCTION governance_catalog.subject_code_window_contributors(p_system uuid,p_from timestamp,p_to timestamp,p_r timestamp)
RETURNS TABLE(b timestamp,e timestamp,version_id uuid,metadata jsonb,contribution tsrange)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH known AS (
  SELECT v.*,governance_catalog.contract_time(v.metadata->>'validFrom') f,
   CASE WHEN v.metadata->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(v.metadata->>'validTo') END t
  FROM governance_catalog.subject_code_version v JOIN governance_catalog.subject_code_approval a ON a.version_id=v.id
  WHERE v.system_id=p_system AND v.recorded_at<=p_r AND a.recorded_at<=p_r
 ), points AS (
  SELECT p_from b UNION SELECT p_to WHERE p_to IS NOT NULL
  UNION SELECT f FROM known WHERE f>p_from AND (p_to IS NULL OR f<p_to)
  UNION SELECT t FROM known WHERE t>p_from AND (p_to IS NULL OR t<p_to)
 ), cells AS (SELECT b,lead(b) OVER(ORDER BY b) e FROM points)
 SELECT c.b,c.e,w.id,w.metadata,
  CASE WHEN w.id IS NULL THEN 'empty'::tsrange ELSE tsrange(c.b,c.e,'[)')*tsrange(w.f,w.t,'[)') END
 FROM cells c LEFT JOIN LATERAL (
  SELECT * FROM known WHERE f<=c.b ORDER BY f DESC,number DESC LIMIT 1
 ) w ON true WHERE p_to IS NULL OR c.b<p_to
$$;

-- Extract the installed native traversal only. Preserve all accepted code,
-- replacement, source and no-fallback checks from 0180/0181.
DO $coverage$ DECLARE body text;old_loop text;new_loop text;old_select text;BEGIN
 body:=pg_get_functiondef('governance_catalog.subject_code_coverage(text,jsonb,timestamp,timestamp,timestamp)'::regprocedure);
 old_loop:=substring(body FROM '(FOR part IN[\s\S]*? LOOP)');
 old_select:=substring(body FROM '(SELECT v\.\* INTO current_version[^;]*;)');
 IF old_loop IS NULL OR old_select IS NULL OR position('WITH known AS' IN old_loop)=0 OR position('ORDER BY governance_catalog.contract_time' IN old_select)=0 THEN RAISE EXCEPTION 'SUBJECT_CONTRIBUTOR_BASELINE_MISMATCH';END IF;
 new_loop:=$new$FOR part IN SELECT * FROM governance_catalog.subject_code_window_contributors((p_pin->>'systemId')::uuid,p_from,p_to,p_r) LOOP$new$;
 body:=replace(body,old_loop,new_loop);
 body:=replace(body,old_select,'SELECT * INTO current_version FROM governance_catalog.subject_code_version WHERE id=part.version_id;');
 EXECUTE body;
END $coverage$;

CREATE OR REPLACE FUNCTION governance_catalog.subject_code_boundaries(p_actor text,p_pin jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item jsonb;v record;piece tsrange;points timestamp[]:=ARRAY[]::timestamp[];BEGIN
 IF jsonb_typeof(p_pin) IS DISTINCT FROM 'object' OR NOT p_pin ?& ARRAY['owner','systemId','versionId','version','code'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_pin) k WHERE k NOT IN ('owner','systemId','versionId','version','code')) THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 IF p_from IS NULL OR p_r IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 item:=governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',p_pin->>'systemId','versionId',p_pin->>'versionId','recordAsOf',to_char(p_r,'YYYY-MM-DD"T"HH24:MI:SS.US')))->0;
 IF p_pin->>'owner' IS DISTINCT FROM 'governance-catalog/subject-code' OR item IS NULL OR item->>'head' IS DISTINCT FROM p_pin->>'version' THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 FOR v IN SELECT * FROM governance_catalog.subject_code_window_contributors((p_pin->>'systemId')::uuid,p_from,p_to,p_r) LOOP
  points:=points||ARRAY[v.b,v.e];
  IF isempty(v.contribution) THEN CONTINUE;END IF;
  PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',(v.metadata->>'sourceId')::uuid,(v.metadata->>'sourceVersionId')::uuid);
  FOR piece IN SELECT unnest(governance_catalog.source_valid_spans((v.metadata->>'sourceVersionId')::uuid,p_r)*tsmultirange(v.contribution)) LOOP points:=points||ARRAY[lower(piece),upper(piece)];END LOOP;
 END LOOP;
 RETURN coalesce((SELECT jsonb_agg(to_char(p,'YYYY-MM-DD"T"HH24:MI:SS.US') ORDER BY p) FROM (SELECT DISTINCT unnest(points) p) b WHERE p>p_from AND (p_to IS NULL OR p<p_to)),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION governance_catalog.care_subject_boundary_references(p_actor text,p_pin jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE anchor jsonb;v record;refs jsonb;BEGIN
 PERFORM governance_catalog.subject_code_boundaries(p_actor,p_pin,p_from,p_to,p_r);
 anchor:=governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',p_pin->>'systemId','versionId',p_pin->>'versionId','recordAsOf',to_char(p_r,'YYYY-MM-DD"T"HH24:MI:SS.US')))->0;
 refs:=jsonb_build_array(jsonb_build_object('kind','SOURCE','id',anchor->>'sourceId','versionId',anchor->>'sourceVersionId'));
 FOR v IN SELECT * FROM governance_catalog.subject_code_window_contributors((p_pin->>'systemId')::uuid,p_from,p_to,p_r) WHERE NOT isempty(contribution) LOOP
  refs:=refs||jsonb_build_array(jsonb_build_object('kind','SOURCE','id',v.metadata->>'sourceId','versionId',v.metadata->>'sourceVersionId'));
 END LOOP;
 RETURN (SELECT jsonb_agg(value ORDER BY value::text) FROM (SELECT DISTINCT value FROM jsonb_array_elements(refs)) pins);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.subject_code_window_contributors(uuid,timestamp,timestamp,timestamp),governance_catalog.subject_code_boundaries(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.care_subject_boundary_references(text,jsonb,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
