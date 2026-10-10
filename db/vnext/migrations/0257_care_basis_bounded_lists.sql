-- Read-only discovery delegates every returned row to its original Owner read.
SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION governance_catalog.parameter_value_list(p_actor text,p_campus text,p_after uuid,p_limit integer,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE entry governance_catalog.parameter_value;items jsonb:='[]';value jsonb;campus jsonb;last_id uuid;scanned integer:=0;BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 IF p_campus NOT IN ('NORTH','SOUTH') OR p_limit NOT BETWEEN 1 AND 100 OR p_r IS NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR entry IN SELECT * FROM governance_catalog.parameter_value WHERE p_after IS NULL OR id>p_after ORDER BY id LIMIT p_limit+1 LOOP
  scanned:=scanned+1;IF scanned>p_limit THEN RETURN jsonb_build_object('items',items,'nextAfterId',last_id);END IF;last_id:=entry.id;
  BEGIN
   value:=governance_catalog.parameter_value_read(p_actor,jsonb_build_object('id',entry.id,'recordAsOf',to_char(p_r,'YYYY-MM-DD"T"HH24:MI:SS.US')),false)->0;
   IF value IS NULL THEN CONTINUE;END IF;
   campus:=organization_master.campus_snapshot(p_actor,(entry.scope_context->'campus'->>'id')::uuid);
   IF campus->>'scope'=p_campus THEN items:=items||jsonb_build_array(value);END IF;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT IN ('ACCESS_DENIED','NOT_FOUND') THEN RAISE;END IF;CONTINUE;END;
 END LOOP;RETURN jsonb_build_object('items',items,'nextAfterId',NULL);
END $$;
CREATE FUNCTION governance_catalog.subject_code_list(p_actor text,p_after uuid,p_limit integer,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE entry governance_catalog.subject_code_system;items jsonb:='[]';value jsonb;last_id uuid;scanned integer:=0;BEGIN
 PERFORM governance_catalog.subject_code_authorize(p_actor,'READ');
 IF p_limit NOT BETWEEN 1 AND 100 OR p_r IS NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR entry IN SELECT * FROM governance_catalog.subject_code_system WHERE p_after IS NULL OR id>p_after ORDER BY id LIMIT p_limit+1 LOOP
  scanned:=scanned+1;IF scanned>p_limit THEN RETURN jsonb_build_object('items',items,'nextAfterId',last_id);END IF;last_id:=entry.id;
  value:=governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',entry.id,'recordAsOf',to_char(p_r,'YYYY-MM-DD"T"HH24:MI:SS.US')))->0;
  IF value IS NOT NULL THEN items:=items||jsonb_build_array(value);END IF;
 END LOOP;RETURN jsonb_build_object('items',items,'nextAfterId',NULL);
END $$;
CREATE FUNCTION care_organization.ward_nursing_scope_list(p_actor text,p_campus text,p_after uuid,p_limit integer,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE entry care_organization.ward_nursing_scope_set;items jsonb:='[]';last_id uuid;scanned integer:=0;BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 IF p_campus NOT IN ('NORTH','SOUTH') OR p_limit NOT BETWEEN 1 AND 100 OR p_r IS NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR entry IN SELECT * FROM care_organization.ward_nursing_scope_set WHERE scope=p_campus AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT p_limit+1 LOOP
  scanned:=scanned+1;IF scanned>p_limit THEN RETURN jsonb_build_object('items',items,'nextAfterId',last_id);END IF;last_id:=entry.id;
  BEGIN items:=items||jsonb_build_array(care_organization.ward_nursing_scope_set_read(p_actor,entry.id,p_r));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT IN ('ACCESS_DENIED','UNKNOWN_COVERAGE_SCOPE','NOT_FOUND') THEN RAISE;END IF;CONTINUE;END;
 END LOOP;RETURN jsonb_build_object('items',items,'nextAfterId',NULL);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.parameter_value_list(text,text,uuid,integer,timestamp),governance_catalog.subject_code_list(text,uuid,integer,timestamp),care_organization.ward_nursing_scope_list(text,text,uuid,integer,timestamp) FROM PUBLIC,hdi_prototype;
