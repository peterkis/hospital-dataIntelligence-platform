-- Effective/qualification reads authorize the persisted definition being read, never an unapproved candidate.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND application_name='hdi-vnext-catalog') THEN RAISE EXCEPTION 'CATALOG_RUNTIME_MUST_BE_STOPPED'; END IF;
END $$;
SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION vnext_control.definition_allowed(p_actor text,p_object uuid,p_payload jsonb,p_purpose text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,vnext_control,governance_catalog AS $$
 SELECT EXISTS(
  SELECT 1 FROM governance_catalog.object o
  JOIN vnext_control.actor a ON a.code=p_actor AND a.active
  JOIN vnext_control.actor_grant coarse ON coarse.actor_code=a.code AND coarse.scope=o.scope AND coarse.permission='READ'
  JOIN vnext_control.object_grant g ON g.actor_code=a.code AND g.object_id=o.id AND g.scope=o.scope AND g.object_kind=o.kind AND g.permission='READ' AND g.purpose=p_purpose
  CROSS JOIN LATERAL vnext_control.object_dimensions(o.kind,p_payload) d
  WHERE o.id=p_object AND g.campus=d->>'campus' AND g.field_group=d->>'fieldGroup'
 )
$$;
REVOKE ALL ON FUNCTION vnext_control.definition_allowed(text,uuid,jsonb,text) FROM PUBLIC,hdi_prototype;
CREATE OR REPLACE FUNCTION vnext_control.require_source_access(p_actor text,p_scope text,p_object uuid,p_version uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control,governance_catalog AS $$
DECLARE ver governance_catalog.version; visited uuid[]:='{}';
BEGIN
 PERFORM vnext_control.authorize(p_actor,p_scope,'READ');
 LOOP
  IF p_version IS NULL THEN SELECT version_id INTO p_version FROM governance_catalog.event WHERE object_id=p_object AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1; END IF;
  SELECT * INTO ver FROM governance_catalog.version WHERE id=p_version AND object_id=p_object;
  IF ver.id IS NULL THEN
   -- No accepted definition exists: authorize only the not-ready response; the qualification port still refuses admission.
   PERFORM vnext_control.require_object(p_actor,p_scope,p_object,'READ','SYNTHETIC_REFERENCE');RETURN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=p_object AND scope=p_scope AND kind='SOURCE') OR NOT vnext_control.definition_allowed(p_actor,p_object,ver.payload,'SYNTHETIC_REFERENCE') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF ver.id=ANY(visited) THEN RETURN; END IF;
  visited:=array_append(visited,ver.id);
  IF ver.payload->>'sourceEvidence'='SYNTHETIC_BOOTSTRAP' THEN RETURN; END IF;
  p_object:=(ver.payload->>'sourceEvidence')::uuid;p_version:=(ver.payload->>'sourceEvidenceVersion')::uuid;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION governance_catalog.read_effective(actor text, requested_scope text, business_at text, as_of text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE result jsonb; cutoff timestamp; business_time timestamp;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM vnext_control.authorize(actor,requested_scope,'READ');
 business_time:=governance_catalog.local_time(business_at);
 cutoff:=CASE WHEN as_of IS NULL THEN timezone('Asia/Shanghai',clock_timestamp()) ELSE governance_catalog.local_time(as_of) END;
 SELECT coalesce(jsonb_agg(row_value ORDER BY row_value->>'code'),'[]'::jsonb) INTO result FROM (
 SELECT jsonb_build_object('id',o.id,'kind',o.kind,'scope',o.scope,'code',o.code,'version',v.number,'versionId',v.id,'head',e.head::text,'status',e.status,'payload',v.payload,
 'reviewDigest',encode(sha256(convert_to(jsonb_build_object('payload',v.payload,'validFrom',v.valid_from,'validTo',v.valid_to)::text,'UTF8')),'hex'),
 'validFrom',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),
 'recordedAt',to_char(e.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')) AS row_value
 FROM governance_catalog.object o JOIN LATERAL(SELECT * FROM governance_catalog.definition_spans(o.id,cutoff) s WHERE s.effective_span @> business_time ORDER BY published_head DESC LIMIT 1) s ON true
 JOIN governance_catalog.version v ON v.id=s.version_id JOIN governance_catalog.event e ON e.head=s.published_head WHERE o.scope=requested_scope AND vnext_control.definition_allowed(actor,o.id,v.payload,'METADATA')) rows;
 RETURN governance_catalog.filter_catalog(actor,jsonb_build_object('items','[]'::jsonb,'domains',(SELECT content->'domains' FROM governance_catalog.source_snapshot WHERE source_key='PACKAGE_V2')))||jsonb_build_object('items',result);
END $$;
