-- Read-only native relation paging. Each row retains its original exact tuple
-- authorizer; scanning an unreadable row advances the bounded cursor.
SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION care_organization.subject_list(p_actor text,p_scope text,p_kind text,p_campus uuid,p_target_type text,p_after uuid,p_limit integer,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE entry care_organization.subject_relation;campus jsonb;items jsonb:='[]';last_id uuid;scanned integer:=0;BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 IF p_scope NOT IN ('NORTH','SOUTH') OR p_limit NOT BETWEEN 1 AND 100 OR (p_kind IS NOT NULL AND p_kind NOT IN ('MAPPING','PERMISSION')) OR (p_target_type IS NOT NULL AND p_target_type NOT IN ('LEGAL','ORG','UNIT')) OR p_r IS NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR entry IN SELECT * FROM care_organization.subject_relation WHERE (p_kind IS NULL OR kind=p_kind) AND (p_campus IS NULL OR scope->'campus'->>'id'=p_campus::text) AND (p_target_type IS NULL OR scope->'target'->>'type'=p_target_type) AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT p_limit+1 LOOP
  scanned:=scanned+1;IF scanned>p_limit THEN RETURN jsonb_build_object('items',items,'nextAfterId',last_id);END IF;last_id:=entry.id;
  BEGIN
   PERFORM care_organization.subject_authorize(p_actor,entry.scope,entry.kind,'READ');
   campus:=organization_master.campus_snapshot(p_actor,(entry.scope->'campus'->>'id')::uuid);
   IF campus->>'scope'<>p_scope THEN CONTINUE;END IF;
   items:=items||jsonb_build_array(care_organization.subject_snapshot(p_actor,entry.id,p_r));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT IN ('ACCESS_DENIED','NOT_FOUND') THEN RAISE;END IF;CONTINUE;END;
 END LOOP;RETURN jsonb_build_object('items',items,'nextAfterId',NULL);
END $$;
REVOKE ALL ON FUNCTION care_organization.subject_list(text,text,text,uuid,text,uuid,integer,timestamp) FROM PUBLIC,hdi_prototype;
