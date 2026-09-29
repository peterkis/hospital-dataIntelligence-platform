SELECT pg_advisory_xact_lock(901002);

CREATE FUNCTION department_master.hierarchy_read(p_actor text,p_mode text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,department_master AS $$
DECLARE c department_master.hierarchy_candidate; v department_master.hierarchy_view_version;
 target_view uuid; source_key text; matches jsonb;
BEGIN
 PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 IF p_mode='VIEW_FOR_WRITE' THEN
  IF NOT (p_input ? 'sourceClientKey') OR p_input-ARRAY['sourceClientKey']<>'{}'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  SELECT h.id INTO target_view FROM department_master.hierarchy_view h WHERE h.source_client_key=p_input->>'sourceClientKey';
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM department_master.hierarchy_authorize(p_actor,target_view,'WRITE');
  RETURN jsonb_build_object('id',target_view);
 ELSIF p_mode IN ('CANDIDATE','COMMITTED','REQUEST') THEN
  IF NOT (p_input ? 'id') OR p_input-ARRAY['id']<>'{}'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  IF p_mode='REQUEST' THEN SELECT * INTO c FROM department_master.hierarchy_candidate WHERE request_id=(p_input->>'id')::uuid;
  ELSE SELECT * INTO c FROM department_master.hierarchy_candidate WHERE id=(p_input->>'id')::uuid; END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM department_master.hierarchy_authorize(p_actor,c.view_id,'READ');
  IF p_mode='REQUEST' THEN
   PERFORM department_master.hierarchy_authorize(p_actor,c.view_id,'WRITE');
   RETURN jsonb_build_object('id',c.id,'digest',c.digest,'status',c.status);
  ELSIF p_mode='CANDIDATE' THEN
   RETURN jsonb_build_object('id',c.id,'viewId',c.view_id,'digest',c.digest,'maker',c.maker,'makerIdentity',c.maker_identity,'requestId',c.request_id,'status',c.status,'envelope',c.envelope,'approvedBy',c.approved_by,'payload',c.payload);
  END IF;
  IF c.status<>'APPLIED' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT jsonb_agg(jsonb_build_object('viewId',s.view_id,'version',s.version_no::text)) INTO matches
   FROM department_master.hierarchy_view_version s WHERE s.view_id=c.view_id AND s.content_digest=c.payload->>'validationDigest' AND s.status='PUBLISHED';
  IF coalesce(jsonb_array_length(matches),0)<>1 THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
  RETURN matches->0;
 ELSIF p_mode='SNAPSHOT' THEN
  IF NOT (p_input ? 'viewId') OR p_input-ARRAY['viewId','version']<>'{}'::jsonb
   OR (p_input ? 'version' AND coalesce(p_input->>'version','') !~ '^[1-9][0-9]*$') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  target_view:=(p_input->>'viewId')::uuid;
  PERFORM department_master.hierarchy_authorize(p_actor,target_view,'READ');
  IF NOT (p_input ? 'version') AND EXISTS(SELECT 1 FROM department_master.hierarchy_closure WHERE view_id=target_view) THEN RETURN NULL; END IF;
  SELECT s.* INTO v FROM department_master.hierarchy_view_version s WHERE s.view_id=target_view AND s.status='PUBLISHED'
   AND (NOT (p_input ? 'version') OR s.version_no=(p_input->>'version')::bigint) ORDER BY s.version_no DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT source_client_key INTO source_key FROM department_master.hierarchy_view WHERE id=target_view;
  RETURN jsonb_build_object('version',to_jsonb(v)||jsonb_build_object('source_client_key',source_key,'version_no',v.version_no::text),
   'nodes',coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.depth,n.sort_order,n.node_key) FROM department_master.hierarchy_node n WHERE n.view_version_id=v.id),'[]'::jsonb));
 ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
END $$;
REVOKE ALL ON FUNCTION department_master.hierarchy_read(text,text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION department_master.hierarchy_read(text,text,jsonb) TO hdi_prototype;
REVOKE ALL ON department_master.hierarchy_view,department_master.hierarchy_view_version,department_master.hierarchy_candidate,department_master.hierarchy_node,department_master.hierarchy_closure FROM PUBLIC,hdi_prototype;
