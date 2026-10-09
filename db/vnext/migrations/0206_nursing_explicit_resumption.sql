SELECT pg_advisory_xact_lock(901002);

-- Lifecycle events never replace content. A finite explicit resume only removes
-- its own part of an existing suspension; permanent CLOSE remains a barrier.
CREATE FUNCTION care_organization.care_unavailable(p_history jsonb) RETURNS tsmultirange
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE s jsonb;r jsonb;gap tsmultirange;result tsmultirange:='{}';BEGIN
 FOR s IN SELECT value FROM jsonb_array_elements(p_history->'versions') WHERE value->>'action'='SUSPEND' LOOP
  gap:=tsmultirange(tsrange((s->>'validFrom')::timestamp,NULL,'[)'));
  FOR r IN SELECT value FROM jsonb_array_elements(p_history->'versions') WHERE value->>'action'='RESUME' AND (value->>'number')::bigint>(s->>'number')::bigint LOOP
   gap:=gap-tsmultirange(tsrange((r->>'validFrom')::timestamp,(r->>'validTo')::timestamp,'[)'));
  END LOOP;
  result:=result+gap;
 END LOOP;
 FOR s IN SELECT value FROM jsonb_array_elements(p_history->'versions') WHERE value->>'action'='CLOSE' LOOP result:=result+tsmultirange(tsrange((s->>'validFrom')::timestamp,NULL,'[)'));END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION care_organization.care_unavailable(jsonb) FROM PUBLIC,hdi_prototype;

ALTER TABLE care_organization.nursing_version DROP CONSTRAINT nursing_version_action_check;
ALTER TABLE care_organization.nursing_version ADD CONSTRAINT nursing_version_action_check CHECK(action IN ('CREATE','REVISE','REBIND','SUSPEND','RESUME'));

-- Amend only the installed current functions, preserving their identities and
-- grants. Each exact baseline is checked before replacing its forward guard.
DO $$
DECLARE body text;needle text;replacement text;BEGIN
 body:=pg_get_functiondef('care_organization.nursing_mutate(text,text)'::regprocedure);
 needle:=$old$IF EXISTS(SELECT 1 FROM care_organization.nursing_version WHERE unit_id=target AND action='SUSPEND' AND (to_at IS NULL OR valid_from<to_at)) THEN RAISE EXCEPTION 'NURSING_SUSPENDED';END IF;$old$;
 replacement:=$new$IF w->>'action'<>'RESUME' AND care_organization.care_unavailable(care_organization.nursing_snapshot(actor,target)) && tsmultirange(tsrange(from_at,to_at,'[)')) THEN RAISE EXCEPTION 'NURSING_SUSPENDED';END IF;$new$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_NURSING_GUARD_BASELINE_MISMATCH';END IF;body:=replace(body,needle,replacement);
 needle:=$old$IF w->>'action' NOT IN ('CREATE','REVISE','REBIND','SUSPEND') THEN$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_NURSING_ACTION_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$IF w->>'action' NOT IN ('CREATE','REVISE','REBIND','SUSPEND','RESUME') THEN$new$);
 needle:=$old$IF w->>'action'='REBIND' THEN$old$;
 replacement:=$new$IF w->>'action'='RESUME' THEN
   IF NOT care_organization.care_unavailable(care_organization.nursing_snapshot(actor,target)) @> from_at THEN RAISE EXCEPTION 'UNSUPPORTED_STATE_TRANSITION';END IF;
   SELECT * INTO at_version FROM care_organization.nursing_version WHERE unit_id=target AND action IN ('CREATE','REVISE') AND valid_from<=from_at AND (valid_to IS NULL OR from_at<valid_to) ORDER BY number DESC LIMIT 1;
   IF at_version.id IS NULL OR jsonb_array_length(w->'bindingChanges')<>0 OR ((w->'facts')-ARRAY['source','contractVersionId','managementBasis']) IS DISTINCT FROM (at_version.facts-ARRAY['source','contractVersionId','managementBasis']) OR w->'facts'->'managementBasis' IS DISTINCT FROM at_version.facts->'managementBasis' THEN RAISE EXCEPTION 'NURSING_CONTENT_CHANGED';END IF;
   PERFORM care_organization.nursing_admission(actor,w->'binding',from_at,to_at,record_at);
   PERFORM care_organization.nursing_admission(approved_by,w->'binding',from_at,to_at,record_at);
   PERFORM governance_catalog.nursing_source_coverage(actor,(w->'facts'->'source'->>'sourceSystemId')::uuid,from_at,to_at,record_at);
   PERFORM governance_catalog.nursing_source_coverage(approved_by,(w->'facts'->'source'->>'sourceSystemId')::uuid,from_at,to_at,record_at);
  END IF;
  IF w->>'action'='REBIND' THEN$new$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_NURSING_RESUME_BASELINE_MISMATCH';END IF;EXECUTE replace(body,needle,replacement);

 body:=pg_get_functiondef('care_organization.ward_nursing_master_window(text,text,uuid,uuid,timestamp,timestamp,timestamp)'::regprocedure);
 needle:=$old$value->>'action'<>'REBIND' AND (value->>'number')::bigint>(property->>'number')::bigint$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_MASTER_WINDOW_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$value->>'action' IN ('CREATE','REVISE') AND (value->>'number')::bigint>(property->>'number')::bigint$new$);
 needle:=$old$FOR b IN SELECT value FROM jsonb_array_elements(h->'bindings') LOOP$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_MASTER_BINDING_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$spans:=spans-care_organization.care_unavailable(h);
  FOR b IN SELECT value FROM jsonb_array_elements(h->'bindings') LOOP$new$);EXECUTE body;
END $$;

CREATE OR REPLACE FUNCTION care_organization.nursing_current_end(p_unit uuid) RETURNS timestamp
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ending timestamp;closing timestamp;suspended timestamp;at_r timestamp:=timezone('Asia/Shanghai',clock_timestamp());BEGIN
 SELECT CASE WHEN bool_or(valid_to IS NULL) THEN NULL ELSE max(valid_to) END INTO ending FROM care_organization.nursing_version WHERE unit_id=p_unit AND action IN ('CREATE','REVISE');
 SELECT min(valid_from) INTO closing FROM care_organization.nursing_version WHERE unit_id=p_unit AND action='CLOSE';
 SELECT min(s.valid_from) INTO suspended FROM care_organization.nursing_version s WHERE s.unit_id=p_unit AND s.action='SUSPEND' AND NOT EXISTS(SELECT 1 FROM care_organization.nursing_version r WHERE r.unit_id=p_unit AND r.action='RESUME' AND r.number>s.number AND r.valid_from<=at_r AND (r.valid_to IS NULL OR at_r<r.valid_to));
 RETURN least(ending,closing,suspended);
END $$;
