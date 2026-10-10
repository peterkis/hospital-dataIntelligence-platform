SELECT pg_advisory_xact_lock(901002);

-- The existing location projection, with knowledge restricted to the common R.
CREATE FUNCTION organization_master.location_coverage_at(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE snapshot jsonb;segments jsonb;spans tsmultirange;retired timestamp;BEGIN
 snapshot:=organization_master.campus_snapshot(p_actor,p_id);
 IF p_r IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 WITH profiles AS (SELECT e.* FROM organization_master.campus_event e JOIN organization_master.campus_version v ON v.event_id=e.id WHERE e.campus_id=p_id AND e.recorded_at<=p_r),parts AS (
 SELECT v.id,v.number,v.recorded_at,unnest(tsmultirange(tsrange(v.valid_from,v.valid_to,'[)'))-coalesce((SELECT range_agg(tsrange(later.valid_from,later.valid_to,'[)')) FROM profiles later WHERE later.number>v.number),'{}'::tsmultirange)) span FROM profiles v
 ),clipped AS (SELECT id,number,recorded_at,span * tsrange(p_from,p_to,'[)') span FROM parts WHERE span && tsrange(p_from,p_to,'[)'))
 SELECT coalesce(jsonb_agg(jsonb_build_object('versionId',id,'version',number::text,'from',to_char(lower(span),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',CASE WHEN upper_inf(span) THEN NULL ELSE to_char(upper(span),'YYYY-MM-DD"T"HH24:MI:SS.US') END) ORDER BY lower(span)),'[]'),range_agg(span) INTO segments,spans FROM clipped;
 SELECT min(e.valid_from) INTO retired FROM organization_master.campus_event e JOIN organization_master.campus_operation o ON o.event_id=e.id WHERE e.campus_id=p_id AND e.recorded_at<=p_r AND o.state='RETIRED';
 RETURN jsonb_build_object('campusId',p_id,'scope',snapshot->>'scope','covered',coalesce(spans @> tsrange(p_from,p_to,'[)'),false),'segments',segments,'retiredAt',CASE WHEN retired IS NULL THEN NULL ELSE to_char(retired,'YYYY-MM-DD"T"HH24:MI:SS.US') END);
END $$;

-- Preserve the original one-source-version requirement rather than combining
-- separate source versions that are individually valid in adjacent intervals.
CREATE FUNCTION governance_catalog.location_source_at(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_expected_version uuid,p_r timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pin uuid;BEGIN
 PERFORM governance_catalog.location_source(p_actor,p_id,NULL,NULL,false,p_expected_version);
 IF p_r IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 SELECT s.version_id INTO pin FROM governance_catalog.definition_spans(p_id,p_r) s WHERE governance_catalog.source_valid_spans(s.version_id,p_r) @> tsrange(p_from,p_to,'[)');
 IF pin IS NULL THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',p_id,pin);
 RETURN jsonb_build_object('sourceId',p_id,'versionId',pin);
END $$;

CREATE FUNCTION governance_catalog.subject_code_boundaries(p_actor text,p_pin jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item jsonb;v record;piece tsrange;points timestamp[]:=ARRAY[]::timestamp[];BEGIN
 IF jsonb_typeof(p_pin) IS DISTINCT FROM 'object' OR NOT p_pin ?& ARRAY['owner','systemId','versionId','version','code'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_pin) k WHERE k NOT IN ('owner','systemId','versionId','version','code')) THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 item:=governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',p_pin->>'systemId','versionId',p_pin->>'versionId','recordAsOf',to_char(p_r,'YYYY-MM-DD"T"HH24:MI:SS.US')))->0;
 IF p_pin->>'owner' IS DISTINCT FROM 'governance-catalog/subject-code' OR item IS NULL OR item->>'head' IS DISTINCT FROM p_pin->>'version' THEN RAISE EXCEPTION 'REFERENCE_INVALID';END IF;
 IF p_r IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 FOR v IN SELECT x.* FROM governance_catalog.subject_code_version x JOIN governance_catalog.subject_code_approval a ON a.version_id=x.id WHERE x.system_id=(p_pin->>'systemId')::uuid AND x.recorded_at<=p_r AND a.recorded_at<=p_r AND (p_to IS NULL OR governance_catalog.contract_time(x.metadata->>'validFrom')<p_to) LOOP
  PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',(v.metadata->>'sourceId')::uuid,(v.metadata->>'sourceVersionId')::uuid);
  points:=points||ARRAY[governance_catalog.contract_time(v.metadata->>'validFrom'),CASE WHEN v.metadata->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(v.metadata->>'validTo') END];
  FOR piece IN SELECT unnest(governance_catalog.source_valid_spans((v.metadata->>'sourceVersionId')::uuid,p_r)*tsmultirange(tsrange(p_from,p_to,'[)'))) LOOP points:=points||ARRAY[lower(piece),upper(piece)];END LOOP;
 END LOOP;
 RETURN coalesce((SELECT jsonb_agg(to_char(p,'YYYY-MM-DD"T"HH24:MI:SS.US') ORDER BY p) FROM (SELECT DISTINCT unnest(points) p) b WHERE p>p_from AND (p_to IS NULL OR p<p_to)),'[]'::jsonb);
END $$;

CREATE FUNCTION organization_master.subject_profile_boundaries(p_actor text,p_scope jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE registration jsonb;campus jsonb;BEGIN
 registration:=organization_master.qualification_snapshot(p_actor,(p_scope->'subject'->>'id')::uuid);campus:=organization_master.campus_snapshot(p_actor,(p_scope->'campus'->>'id')::uuid);
 IF p_r IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 RETURN coalesce((SELECT jsonb_agg(to_char(p,'YYYY-MM-DD"T"HH24:MI:SS.US') ORDER BY p) FROM(
  SELECT DISTINCT (value->>'valid_from')::timestamp p FROM jsonb_array_elements(registration->'versions') WHERE (value->>'recorded_at')::timestamp<=p_r
  UNION SELECT (value->>'valid_to')::timestamp FROM jsonb_array_elements(registration->'versions') WHERE (value->>'recorded_at')::timestamp<=p_r
  UNION SELECT (value->>'valid_from')::timestamp FROM jsonb_array_elements(campus->'events') WHERE (value->>'recorded_at')::timestamp<=p_r
  UNION SELECT (value->>'valid_to')::timestamp FROM jsonb_array_elements(campus->'events') WHERE (value->>'recorded_at')::timestamp<=p_r
 ) b WHERE p>p_from AND (p_to IS NULL OR p<p_to)),'[]'::jsonb);
END $$;

-- The existing capability guard already accepts R. Its campus-profile call must
-- use that same R, including when reached from the native subject Owner.
DO $patch$ DECLARE body text;needle text:='organization_master.location_coverage(p_actor,(p_scope->''campus''->>''id'')::uuid,lower(requested),upper(requested))';BEGIN
 body:=pg_get_functiondef('organization_master.capability_operating_guard(text,jsonb,jsonb,timestamp,timestamp,timestamp)'::regprocedure);
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CARE_RECORD_TIME_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'organization_master.location_coverage_at(p_actor,(p_scope->''campus''->>''id'')::uuid,lower(requested),upper(requested),p_r)');
END $patch$;
REVOKE ALL ON FUNCTION organization_master.location_coverage_at(text,uuid,timestamp,timestamp,timestamp),governance_catalog.location_source_at(text,uuid,timestamp,timestamp,uuid,timestamp),governance_catalog.subject_code_boundaries(text,jsonb,timestamp,timestamp,timestamp),organization_master.subject_profile_boundaries(text,jsonb,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
