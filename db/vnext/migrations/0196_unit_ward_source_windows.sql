SELECT pg_advisory_xact_lock(901002);

CREATE FUNCTION governance_catalog.unit_ward_source_windows(p_actor text,p_source uuid,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r timestamp:=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));pin uuid;spans tsmultirange;piece tsrange;parts jsonb:='[]';BEGIN
 IF p_from IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',p_source);
 FOR pin IN SELECT version_id FROM governance_catalog.definition_spans(p_source,r) LOOP
  spans:=governance_catalog.source_valid_spans(pin,r)*tsmultirange(tsrange(p_from,p_to,'[)'));IF spans='{}'::tsmultirange THEN CONTINUE;END IF;
  PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',p_source,pin);
  FOR piece IN SELECT unnest(spans) LOOP parts:=parts||jsonb_build_array(jsonb_build_object('from',to_char(lower(piece),'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(upper(piece),'YYYY-MM-DD"T"HH24:MI:SS.US')));END LOOP;
 END LOOP;
 RETURN parts;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.unit_ward_source_windows(text,uuid,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
