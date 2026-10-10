SELECT pg_advisory_xact_lock(901002);
ALTER FUNCTION care_organization.workspace_record(text,text) RENAME TO workspace_record_before_basis_list;
CREATE FUNCTION care_organization.workspace_record(p_ticket text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=care_organization.lifecycle_attest(p_ticket,p_signature);actor text:=t->>'actor';identity text;r care_organization.workspace_draft_revision;items jsonb:='[]';last_id uuid;scanned integer:=0;BEGIN
 IF t->>'operation'<>'LIST' THEN RETURN care_organization.workspace_record_before_basis_list(p_ticket,p_signature);END IF;
 PERFORM pg_advisory_xact_lock(901002);identity:=vnext_control.authorize(actor,'SYNTHETIC','READ');
 IF (t->>'limit')::integer NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR r IN SELECT * FROM(SELECT DISTINCT ON(id) * FROM care_organization.workspace_draft_revision WHERE identity_code=identity AND metadata->>'format'='CARE_WORKSPACE_METADATA_V1' AND (t->>'after' IS NULL OR id>(t->>'after')::uuid) ORDER BY id,number DESC) heads WHERE (t->>'kind' IS NULL OR metadata->>'kind'=t->>'kind') AND (t->>'campus' IS NULL OR metadata->>'campus'=t->>'campus') ORDER BY id LIMIT (t->>'limit')::integer+1 LOOP
  scanned:=scanned+1;IF scanned>(t->>'limit')::integer THEN RETURN jsonb_build_object('items',items,'nextAfterId',last_id);END IF;last_id:=r.id;
  BEGIN PERFORM care_organization.workspace_authorize(actor,r.metadata,'READ');PERFORM care_organization.workspace_authorize(actor,r.metadata,'READ_RESTRICTED');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT IN ('ACCESS_DENIED','NOT_FOUND') THEN RAISE;END IF;CONTINUE;END;
  items:=items||jsonb_build_array(jsonb_build_object('id',r.id,'version',r.number::text,'kind',r.metadata->>'kind','campus',r.metadata->>'campus','state',r.state,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')));
 END LOOP;RETURN jsonb_build_object('items',items,'nextAfterId',NULL);
END $$;
REVOKE ALL ON FUNCTION care_organization.workspace_record(text,text),care_organization.workspace_record_before_basis_list(text,text) FROM PUBLIC,hdi_prototype;
