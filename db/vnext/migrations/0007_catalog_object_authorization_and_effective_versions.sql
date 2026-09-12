-- Explicit metadata-object authorization. Existing historical facts remain unchanged.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND application_name='hdi-vnext-catalog') THEN RAISE EXCEPTION 'CATALOG_RUNTIME_MUST_BE_STOPPED'; END IF;
END $$;
SELECT pg_advisory_xact_lock(901002);
ALTER TABLE vnext_control.actor_grant DROP CONSTRAINT actor_grant_permission_check;
ALTER TABLE vnext_control.actor_grant ADD CONSTRAINT actor_grant_permission_check CHECK(permission IN ('READ','WRITE','REVIEW','PUBLISH','AUDIT'));
CREATE TABLE vnext_control.object_grant (
 actor_code text NOT NULL REFERENCES vnext_control.actor(code), object_id uuid NOT NULL REFERENCES governance_catalog.object(id),
 scope text NOT NULL CHECK(scope IN ('BASELINE','SYNTHETIC')), object_kind text NOT NULL CHECK(object_kind IN ('DATASET','SOURCE','RESPONSIBILITY')),
 campus text NOT NULL CHECK(campus IN ('N_A','UNRESOLVED_DECLARATION','SYNTHETIC_ALL','SYNTHETIC_NORTH','SYNTHETIC_SOUTH')),
 purpose text NOT NULL CHECK(purpose IN ('METADATA','SYNTHETIC_REFERENCE')), field_group text NOT NULL CHECK(field_group IN ('DEFINITION','ALL','IDENTITY','CONTACT')),
 permission text NOT NULL CHECK(permission IN ('READ','WRITE','REVIEW','PUBLISH')),
 PRIMARY KEY(actor_code,object_id,scope,object_kind,campus,purpose,field_group,permission),
 CHECK(scope<>'BASELINE' OR permission='READ'), CHECK(purpose<>'SYNTHETIC_REFERENCE' OR (object_kind='SOURCE' AND permission='READ'))
);
CREATE TABLE vnext_control.creation_policy (
 creator_actor text NOT NULL REFERENCES vnext_control.actor(code), recipient_actor text NOT NULL REFERENCES vnext_control.actor(code),
 object_kind text NOT NULL CHECK(object_kind IN ('DATASET','SOURCE','RESPONSIBILITY')),
 campus text NOT NULL CHECK(campus IN ('N_A','UNRESOLVED_DECLARATION','SYNTHETIC_ALL','SYNTHETIC_NORTH','SYNTHETIC_SOUTH')),
 field_group text NOT NULL CHECK(field_group IN ('DEFINITION','ALL','IDENTITY','CONTACT')),
 purpose text NOT NULL CHECK(purpose IN ('METADATA','SYNTHETIC_REFERENCE')), permission text NOT NULL CHECK(permission IN ('READ','WRITE','REVIEW','PUBLISH')),
 PRIMARY KEY(creator_actor,recipient_actor,object_kind,campus,field_group,purpose,permission),
 CHECK(purpose<>'SYNTHETIC_REFERENCE' OR (object_kind='SOURCE' AND permission='READ'))
);
CREATE TABLE vnext_control.audit_stream_grant (
 actor_code text NOT NULL REFERENCES vnext_control.actor(code), stream_id text NOT NULL CHECK(stream_id='GOVERNANCE_CATALOG'),
 purpose text NOT NULL CHECK(purpose='AUDIT_VERIFY'), PRIMARY KEY(actor_code,stream_id,purpose)
);
REVOKE ALL ON vnext_control.object_grant,vnext_control.creation_policy,vnext_control.audit_stream_grant FROM PUBLIC,hdi_prototype;
CREATE FUNCTION vnext_control.lock_authorization_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(901002); RETURN NULL; END $$;
CREATE TRIGGER object_grant_lock BEFORE INSERT OR UPDATE OR DELETE ON vnext_control.object_grant FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER actor_grant_lock BEFORE INSERT OR UPDATE OR DELETE ON vnext_control.actor_grant FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER actor_lock BEFORE INSERT OR UPDATE OR DELETE ON vnext_control.actor FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER creation_policy_lock BEFORE INSERT OR UPDATE OR DELETE ON vnext_control.creation_policy FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER audit_stream_grant_lock BEFORE INSERT OR UPDATE OR DELETE ON vnext_control.audit_stream_grant FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE FUNCTION vnext_control.audit_object_grant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control AS $$
BEGIN
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES('VNEXT_GRANT_CONTROL',CASE WHEN TG_OP='DELETE' THEN OLD.object_id ELSE NEW.object_id END,'OBJECT_GRANT_'||TG_OP,'CONTROLLED_AUTHORIZATION',encode(sha256(convert_to(jsonb_build_object('before',to_jsonb(OLD),'after',to_jsonb(NEW))::text,'UTF8')),'hex'));
 RETURN NULL;
END $$;
CREATE TRIGGER object_grant_audit AFTER INSERT OR UPDATE OR DELETE ON vnext_control.object_grant FOR EACH ROW EXECUTE FUNCTION vnext_control.audit_object_grant();
REVOKE ALL ON FUNCTION vnext_control.lock_authorization_change(),vnext_control.audit_object_grant() FROM PUBLIC,hdi_prototype;
CREATE FUNCTION vnext_control.object_dimensions(p_kind text,p_payload jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('campus',CASE p_kind WHEN 'DATASET' THEN 'N_A' WHEN 'SOURCE' THEN CASE WHEN p_payload->>'deploymentScope' IN ('UNRESOLVED_DECLARATION','SYNTHETIC_ALL') THEN p_payload->>'deploymentScope' ELSE 'INVALID' END WHEN 'RESPONSIBILITY' THEN CASE p_payload->>'authorityScope' WHEN 'ALL' THEN 'SYNTHETIC_ALL' WHEN 'NORTH' THEN 'SYNTHETIC_NORTH' WHEN 'SOUTH' THEN 'SYNTHETIC_SOUTH' ELSE 'INVALID' END ELSE 'INVALID' END,
 'fieldGroup',CASE WHEN p_kind IN ('DATASET','SOURCE') THEN 'DEFINITION' WHEN p_kind='RESPONSIBILITY' AND p_payload->>'fieldGroup' IN ('ALL','IDENTITY','CONTACT') THEN p_payload->>'fieldGroup' ELSE 'INVALID' END)
$$;
CREATE FUNCTION vnext_control.object_allowed(p_actor text,p_object uuid,p_permission text,p_purpose text,p_payload jsonb DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control,governance_catalog AS $$
DECLARE obj governance_catalog.object; current_payload jsonb; candidate jsonb; dimensions jsonb;
BEGIN
 SELECT * INTO obj FROM governance_catalog.object WHERE id=p_object;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM vnext_control.actor a JOIN vnext_control.actor_grant g ON g.actor_code=a.code WHERE a.code=p_actor AND a.active AND g.scope=obj.scope AND g.permission=p_permission) THEN RETURN false; END IF;
 SELECT v.payload INTO current_payload FROM governance_catalog.event e JOIN governance_catalog.version v ON v.id=e.version_id WHERE e.object_id=p_object ORDER BY e.head DESC LIMIT 1;
 FOR candidate IN SELECT value FROM jsonb_array_elements(jsonb_build_array(current_payload,coalesce(p_payload,current_payload))) LOOP
  dimensions:=vnext_control.object_dimensions(obj.kind,candidate);
  IF NOT EXISTS(SELECT 1 FROM vnext_control.object_grant g WHERE g.actor_code=p_actor AND g.object_id=p_object AND g.scope=obj.scope AND g.object_kind=obj.kind AND g.permission=p_permission AND g.purpose=p_purpose AND g.campus=dimensions->>'campus' AND g.field_group=dimensions->>'fieldGroup') THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION vnext_control.require_object(p_actor text,p_scope text,p_object uuid,p_permission text,p_purpose text,p_payload jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control,governance_catalog AS $$
BEGIN
 PERFORM vnext_control.authorize(p_actor,p_scope,p_permission);
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=p_object AND scope=p_scope) OR NOT vnext_control.object_allowed(p_actor,p_object,p_permission,p_purpose,p_payload) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
END $$;
CREATE FUNCTION vnext_control.bootstrap_catalog_grants() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control,governance_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 INSERT INTO vnext_control.actor_grant SELECT actor_code,scope,'PUBLISH' FROM vnext_control.actor_grant WHERE permission='REVIEW' AND scope='SYNTHETIC' ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.object_grant
 SELECT DISTINCT g.actor_code,o.id,o.scope,o.kind,d->>'campus','METADATA',d->>'fieldGroup',g.permission
 FROM governance_catalog.object o JOIN governance_catalog.version v ON v.object_id=o.id JOIN vnext_control.actor_grant g ON g.scope=o.scope CROSS JOIN LATERAL vnext_control.object_dimensions(o.kind,v.payload) d
 WHERE g.actor_code IN ('maker','maker-alias','reviewer') AND g.permission IN ('READ','WRITE','REVIEW','PUBLISH') AND (o.scope='SYNTHETIC' OR g.permission='READ') AND d->>'campus'<>'INVALID' AND d->>'fieldGroup'<>'INVALID' ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.object_grant SELECT actor_code,object_id,scope,object_kind,campus,'SYNTHETIC_REFERENCE',field_group,permission FROM vnext_control.object_grant WHERE object_kind='SOURCE' AND permission='READ' AND purpose='METADATA' ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.audit_stream_grant SELECT code,'GOVERNANCE_CATALOG','AUDIT_VERIFY' FROM vnext_control.actor WHERE code='auditor' ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.creation_policy
 SELECT a.code,g.actor_code,t.kind,t.campus,t.field_group,'METADATA',g.permission FROM vnext_control.actor a CROSS JOIN vnext_control.actor_grant g CROSS JOIN (
  VALUES ('DATASET','N_A','DEFINITION'),('SOURCE','UNRESOLVED_DECLARATION','DEFINITION'),('SOURCE','SYNTHETIC_ALL','DEFINITION'),
  ('RESPONSIBILITY','SYNTHETIC_ALL','ALL'),('RESPONSIBILITY','SYNTHETIC_ALL','IDENTITY'),('RESPONSIBILITY','SYNTHETIC_ALL','CONTACT'),
  ('RESPONSIBILITY','SYNTHETIC_NORTH','ALL'),('RESPONSIBILITY','SYNTHETIC_NORTH','IDENTITY'),('RESPONSIBILITY','SYNTHETIC_NORTH','CONTACT'),
  ('RESPONSIBILITY','SYNTHETIC_SOUTH','ALL'),('RESPONSIBILITY','SYNTHETIC_SOUTH','IDENTITY'),('RESPONSIBILITY','SYNTHETIC_SOUTH','CONTACT')
 ) t(kind,campus,field_group)
 WHERE a.code IN ('maker','maker-alias','reviewer') AND g.actor_code IN ('maker','maker-alias','reviewer') AND g.scope='SYNTHETIC' AND g.permission IN ('READ','WRITE','REVIEW','PUBLISH') ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.creation_policy SELECT creator_actor,recipient_actor,object_kind,campus,field_group,'SYNTHETIC_REFERENCE',permission FROM vnext_control.creation_policy WHERE object_kind='SOURCE' AND permission='READ' AND purpose='METADATA' ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION vnext_control.grant_created_object(p_actor text,p_object uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control,governance_catalog AS $$
DECLARE obj governance_catalog.object; payload jsonb; dimensions jsonb;
BEGIN
 SELECT * INTO STRICT obj FROM governance_catalog.object WHERE id=p_object;
 SELECT v.payload INTO payload FROM governance_catalog.event e JOIN governance_catalog.version v ON v.id=e.version_id WHERE e.object_id=p_object ORDER BY head DESC LIMIT 1;
 dimensions:=vnext_control.object_dimensions(obj.kind,payload);
 INSERT INTO vnext_control.object_grant SELECT p.recipient_actor,obj.id,obj.scope,obj.kind,p.campus,p.purpose,p.field_group,p.permission FROM vnext_control.creation_policy p JOIN vnext_control.actor a ON a.code=p.recipient_actor AND a.active JOIN vnext_control.actor_grant g ON g.actor_code=a.code AND g.scope=obj.scope AND g.permission=p.permission
 WHERE p.creator_actor=p_actor AND p.object_kind=obj.kind AND p.campus=dimensions->>'campus' AND p.field_group=dimensions->>'fieldGroup' AND obj.scope='SYNTHETIC';
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
END $$;
REVOKE ALL ON FUNCTION vnext_control.object_dimensions(text,jsonb),vnext_control.object_allowed(text,uuid,text,text,jsonb),vnext_control.require_object(text,text,uuid,text,text,jsonb),vnext_control.bootstrap_catalog_grants(),vnext_control.grant_created_object(text,uuid) FROM PUBLIC,hdi_prototype;
SELECT vnext_control.bootstrap_catalog_grants();

-- Same business-start revisions correct that assertion; different starts are timed definitions.
CREATE FUNCTION governance_catalog.definition_spans(p_object uuid,p_as_of timestamp,p_preview_version uuid DEFAULT NULL) RETURNS TABLE(version_id uuid,effective_span tsmultirange,published_head bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
 WITH candidates AS (
  SELECT v.id,v.valid_from,v.valid_to,e.head,false AS preview FROM governance_catalog.version v JOIN governance_catalog.event e ON e.version_id=v.id
  WHERE v.object_id=p_object AND e.status='PUBLISHED' AND e.recorded_at<=p_as_of
  UNION ALL
  SELECT v.id,v.valid_from,v.valid_to,e.head,true FROM governance_catalog.version v JOIN LATERAL (SELECT head FROM governance_catalog.event WHERE version_id=v.id ORDER BY head DESC LIMIT 1) e ON true
  WHERE v.object_id=p_object AND v.id=p_preview_version
 ), known AS (
  SELECT DISTINCT ON(valid_from) * FROM candidates ORDER BY valid_from,preview DESC,head DESC
 )
 SELECT k.id,tsmultirange(tsrange(k.valid_from,k.valid_to,'[)'))-coalesce((SELECT range_agg(tsrange(n.valid_from,n.valid_to,'[)')) FROM known n WHERE (n.preview,n.head)>(k.preview,k.head)),'{}'::tsmultirange),k.head FROM known k
 WHERE p_preview_version IS NOT NULL OR (SELECT status FROM governance_catalog.event WHERE object_id=p_object AND status IN ('PUBLISHED','RETIRED') AND recorded_at<=p_as_of ORDER BY head DESC LIMIT 1)='PUBLISHED'
$$;
REVOKE ALL ON FUNCTION governance_catalog.definition_spans(uuid,timestamp,uuid) FROM PUBLIC,hdi_prototype;

ALTER FUNCTION governance_catalog.command(text,jsonb) RENAME TO command_raw;
ALTER FUNCTION governance_catalog.read_catalog(text,text,text) RENAME TO read_catalog_raw;
ALTER FUNCTION governance_catalog.history(text,text,uuid) RENAME TO history_raw;
ALTER FUNCTION governance_catalog.resolve_source(text,text,uuid,text) RENAME TO resolve_source_raw;
ALTER FUNCTION governance_catalog.change_impact(text,text,uuid) RENAME TO change_impact_raw;
ALTER FUNCTION governance_catalog.impact_cases(text,text,uuid) RENAME TO impact_cases_raw;
REVOKE ALL ON FUNCTION governance_catalog.command_raw(text,jsonb),governance_catalog.read_catalog_raw(text,text,text),governance_catalog.history_raw(text,text,uuid),governance_catalog.resolve_source_raw(text,text,uuid,text),governance_catalog.change_impact_raw(text,text,uuid),governance_catalog.impact_cases_raw(text,text,uuid) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION vnext_control.require_source_access(p_actor text,p_scope text,p_object uuid,p_version uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control,governance_catalog AS $$
DECLARE ver governance_catalog.version; visited uuid[]:='{}';
BEGIN
 LOOP
  IF p_version IS NULL THEN SELECT version_id INTO p_version FROM governance_catalog.event WHERE object_id=p_object AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1; END IF;
  SELECT * INTO ver FROM governance_catalog.version WHERE id=p_version AND object_id=p_object;
  PERFORM vnext_control.require_object(p_actor,p_scope,p_object,'READ','SYNTHETIC_REFERENCE',ver.payload);
  IF ver.id IS NULL OR ver.id=ANY(visited) THEN RETURN; END IF;
  visited:=array_append(visited,ver.id);
  IF ver.payload->>'sourceEvidence'='SYNTHETIC_BOOTSTRAP' THEN RETURN; END IF;
  p_object:=(ver.payload->>'sourceEvidence')::uuid;p_version:=(ver.payload->>'sourceEvidenceVersion')::uuid;
 END LOOP;
END $$;
CREATE FUNCTION vnext_control.require_impact_access(p_actor text,p_scope text,p_object uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control,governance_catalog AS $$
DECLARE ref jsonb; payload jsonb; impact jsonb;
BEGIN
 impact:=governance_catalog.source_impact(p_object);
 FOR ref IN SELECT value FROM jsonb_array_elements(impact->'history') LOOP
  SELECT v.payload INTO payload FROM governance_catalog.version v WHERE id=(ref->>'versionId')::uuid;
  PERFORM vnext_control.require_object(p_actor,p_scope,(ref->>'id')::uuid,'READ','METADATA',payload);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION vnext_control.require_source_access(text,text,uuid,uuid),vnext_control.require_impact_access(text,text,uuid) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.command(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; sc text:=p_input->>'scope'; action text:=p_input->>'action'; permission text; existing vnext_control.outcome; obj governance_catalog.object;
 target uuid; payload jsonb; proposed jsonb; dimensions jsonb; result jsonb; reference_id uuid; candidate_version uuid;
BEGIN
 permission:=CASE WHEN action IN ('PUBLISH','REJECT','RETIRE') THEN 'REVIEW' ELSE 'WRITE' END;
 identity:=vnext_control.authorize(p_actor,sc,permission);
 PERFORM pg_advisory_xact_lock(901002);
 identity:=vnext_control.authorize(p_actor,sc,permission);
 IF action IN ('PUBLISH','RETIRE') THEN PERFORM vnext_control.authorize(p_actor,sc,'PUBLISH'); END IF;
 SELECT o.* INTO existing FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=(p_input->>'requestId')::uuid;
 IF FOUND THEN
  target:=(existing.result->>'id')::uuid;
  SELECT v.payload INTO payload FROM governance_catalog.version v WHERE v.id=(existing.result->>'versionId')::uuid;
  PERFORM vnext_control.require_object(p_actor,sc,target,permission,'METADATA',payload);
  IF action IN ('PUBLISH','RETIRE') THEN PERFORM vnext_control.require_object(p_actor,sc,target,'PUBLISH','METADATA',payload); END IF;
  RETURN governance_catalog.command_raw(p_actor,p_input);
 END IF;
 IF action='CREATE' THEN
  dimensions:=vnext_control.object_dimensions(p_input->>'kind',p_input->'values');
  IF p_input->>'kind'='RESPONSIBILITY' AND (dimensions->>'campus'='INVALID' OR dimensions->>'fieldGroup'='INVALID') THEN RAISE EXCEPTION 'RESPONSIBILITY_SCOPE_REQUIRED'; END IF;
  PERFORM 1 FROM vnext_control.creation_policy WHERE creator_actor=p_actor FOR SHARE;
  IF sc<>'SYNTHETIC' OR NOT EXISTS(SELECT 1 FROM vnext_control.creation_policy p WHERE p.creator_actor=p_actor AND p.object_kind=p_input->>'kind' AND p.campus=dimensions->>'campus' AND p.field_group=dimensions->>'fieldGroup' AND p.purpose='METADATA') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF p_input->>'kind'='DATASET' THEN
   SELECT id INTO reference_id FROM governance_catalog.object WHERE kind='DATASET' AND scope='BASELINE' AND code=p_input->>'code';
   IF reference_id IS NOT NULL THEN PERFORM vnext_control.require_object(p_actor,'BASELINE',reference_id,'READ','METADATA'); END IF;
  ELSIF p_input->>'kind'='RESPONSIBILITY' THEN
   SELECT id INTO reference_id FROM governance_catalog.object WHERE kind='DATASET' AND scope='BASELINE' AND code=p_input->'values'->>'dataset';
   IF reference_id IS NOT NULL THEN PERFORM vnext_control.require_object(p_actor,'BASELINE',reference_id,'READ','METADATA'); END IF;
  END IF;
  IF p_input->>'kind'='SOURCE' AND coalesce(p_input->'values'->>'sourceEvidence','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN PERFORM vnext_control.require_source_access(p_actor,sc,(p_input->'values'->>'sourceEvidence')::uuid); END IF;
  result:=governance_catalog.command_raw(p_actor,p_input);
  PERFORM vnext_control.grant_created_object(p_actor,(result->>'id')::uuid);
  RETURN result;
 END IF;
 target:=(p_input->>'target')::uuid;
 SELECT * INTO obj FROM governance_catalog.object WHERE id=target AND scope=sc;
 SELECT v.payload INTO payload FROM governance_catalog.event e JOIN governance_catalog.version v ON v.id=e.version_id WHERE e.object_id=target ORDER BY e.head DESC LIMIT 1;
 PERFORM vnext_control.require_object(p_actor,sc,target,permission,'METADATA');
 IF action IN ('PUBLISH','RETIRE') THEN PERFORM vnext_control.require_object(p_actor,sc,target,'PUBLISH','METADATA'); END IF;
 IF action IN ('PUBLISH','RETIRE') THEN
  IF action='PUBLISH' THEN SELECT version_id INTO candidate_version FROM governance_catalog.event WHERE object_id=target ORDER BY head DESC LIMIT 1; END IF;
  FOR proposed IN SELECT DISTINCT v.payload FROM (
   SELECT * FROM governance_catalog.definition_spans(target,timezone('Asia/Shanghai',clock_timestamp()))
   UNION ALL SELECT * FROM governance_catalog.definition_spans(target,timezone('Asia/Shanghai',clock_timestamp()),candidate_version)
  ) s JOIN governance_catalog.version v ON v.id=s.version_id WHERE NOT isempty(s.effective_span) LOOP
   PERFORM vnext_control.require_object(p_actor,sc,target,'REVIEW','METADATA',proposed);
   PERFORM vnext_control.require_object(p_actor,sc,target,'PUBLISH','METADATA',proposed);
  END LOOP;
 END IF;
 proposed:=CASE WHEN jsonb_typeof(p_input->'values')='object' THEN payload||(p_input->'values') ELSE payload END;
 IF action='REVISE' THEN PERFORM vnext_control.require_object(p_actor,sc,target,'WRITE','METADATA',proposed); END IF;
 IF obj.kind='SOURCE' AND action IN ('REVISE','PUBLISH') AND coalesce(proposed->>'sourceEvidence','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN PERFORM vnext_control.require_source_access(p_actor,sc,(proposed->>'sourceEvidence')::uuid); END IF;
 IF obj.kind='SOURCE' AND action IN ('PUBLISH','RETIRE') THEN PERFORM vnext_control.require_impact_access(p_actor,sc,target); END IF;
 IF obj.kind='RESPONSIBILITY' AND action='REVISE' THEN
  SELECT id INTO reference_id FROM governance_catalog.object WHERE kind='DATASET' AND scope='BASELINE' AND code=proposed->>'dataset';
  IF reference_id IS NOT NULL THEN PERFORM vnext_control.require_object(p_actor,'BASELINE',reference_id,'READ','METADATA'); END IF;
 END IF;
 RETURN governance_catalog.command_raw(p_actor,p_input);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance_catalog.command(text,jsonb) TO hdi_prototype;

CREATE FUNCTION governance_catalog.filter_catalog(p_actor text,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE items jsonb; domains jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(i.value ORDER BY i.ordinality),'[]'::jsonb) INTO items FROM jsonb_array_elements(p_result->'items') WITH ORDINALITY i WHERE vnext_control.object_allowed(p_actor,(i.value->>'id')::uuid,'READ','METADATA',i.value->'payload');
 SELECT coalesce(jsonb_agg(d.value||jsonb_build_object('datasets',coalesce((SELECT jsonb_agg(c.value ORDER BY c.ordinality) FROM jsonb_array_elements(d.value->'datasets') WITH ORDINALITY c WHERE EXISTS(SELECT 1 FROM governance_catalog.object o WHERE o.kind='DATASET' AND o.scope='BASELINE' AND o.code=c.value#>>'{}' AND vnext_control.object_allowed(p_actor,o.id,'READ','METADATA'))),'[]'::jsonb)) ORDER BY d.ordinality),'[]'::jsonb) INTO domains FROM jsonb_array_elements(p_result->'domains') WITH ORDINALITY d;
 RETURN p_result||jsonb_build_object('items',items,'domains',domains);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.filter_catalog(text,jsonb) FROM PUBLIC,hdi_prototype;
CREATE FUNCTION governance_catalog.read_catalog(p_actor text,p_scope text,p_as_of text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM vnext_control.authorize(p_actor,p_scope,'READ');
 RETURN governance_catalog.filter_catalog(p_actor,governance_catalog.read_catalog_raw(p_actor,p_scope,p_as_of));
END $$;
CREATE FUNCTION governance_catalog.history(p_actor text,p_scope text,p_target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$ DECLARE result jsonb; entry jsonb; BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM vnext_control.require_object(p_actor,p_scope,p_target,'READ','METADATA');
 result:=governance_catalog.history_raw(p_actor,p_scope,p_target);
 FOR entry IN SELECT value FROM jsonb_array_elements(result) LOOP PERFORM vnext_control.require_object(p_actor,p_scope,p_target,'READ','METADATA',entry->'payload'); END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION governance_catalog.resolve_source(p_actor text,p_scope text,p_target uuid,p_business_at text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM vnext_control.require_source_access(p_actor,p_scope,p_target);
 RETURN governance_catalog.resolve_source_raw(p_actor,p_scope,p_target,p_business_at);
END $$;
CREATE FUNCTION governance_catalog.change_impact(p_actor text,p_scope text,p_target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM vnext_control.require_object(p_actor,p_scope,p_target,'READ','METADATA');PERFORM vnext_control.require_impact_access(p_actor,p_scope,p_target);
 RETURN governance_catalog.change_impact_raw(p_actor,p_scope,p_target);
END $$;
CREATE FUNCTION governance_catalog.impact_cases(p_actor text,p_scope text,p_target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$ DECLARE result jsonb; entry jsonb; payload jsonb; BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM vnext_control.require_object(p_actor,p_scope,p_target,'READ','METADATA');
 result:=governance_catalog.impact_cases_raw(p_actor,p_scope,p_target);
 FOR entry IN SELECT value FROM jsonb_array_elements(result) LOOP
  SELECT v.payload INTO payload FROM governance_catalog.version v WHERE id=(entry->>'downstream_version')::uuid;
  PERFORM vnext_control.require_object(p_actor,p_scope,(entry->>'downstream_object')::uuid,'READ','METADATA',payload);
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.read_catalog(text,text,text),governance_catalog.history(text,text,uuid),governance_catalog.resolve_source(text,text,uuid,text),governance_catalog.change_impact(text,text,uuid),governance_catalog.impact_cases(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance_catalog.read_catalog(text,text,text),governance_catalog.history(text,text,uuid),governance_catalog.resolve_source(text,text,uuid,text),governance_catalog.change_impact(text,text,uuid),governance_catalog.impact_cases(text,text,uuid) TO hdi_prototype;
-- Generated forward replacements below.
CREATE OR REPLACE FUNCTION governance_catalog.command_raw(actor text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
<<catalog_write>>
DECLARE identity text; action text:=input->>'action'; sc text:=input->>'scope'; object_kind text:=input->>'kind'; object_code text:=input->>'code';
 req uuid; target uuid; existing vnext_control.outcome; obj governance_catalog.object; ver governance_catalog.version; ev governance_catalog.event;
 payload jsonb; patch jsonb:=coalesce(input->'values','{}'); content_hash text; result jsonb; next_status text; new_version uuid;
 begin_b timestamp; end_b timestamp; requested_digest text; other record; prospective record; source_object uuid;
BEGIN
 identity:=vnext_control.authorize(actor,sc,CASE WHEN action IN ('PUBLISH','REJECT','RETIRE') THEN 'REVIEW' ELSE 'WRITE' END);
 IF jsonb_typeof(input)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('action','scope','kind','code','requestId','target','expectedHead','values','reason','reviewDigest','validFrom','validTo','impactDigest')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 IF action NOT IN ('CREATE','REVISE','SUBMIT','PUBLISH','REJECT','RETIRE') OR coalesce(input->>'reason','') !~ '^[A-Z0-9_]{1,64}$' OR coalesce(input->>'requestId','') !~ '^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('action','scope','requestId','reason') AND NOT (
  (action='CREATE' AND k IN ('kind','code','values','validFrom','validTo')) OR
  (action='REVISE' AND k IN ('target','expectedHead','values','validFrom','validTo')) OR
  (action IN ('SUBMIT','REJECT') AND k IN ('target','expectedHead')) OR
  (action='PUBLISH' AND k IN ('target','expectedHead','reviewDigest','impactDigest')) OR
  (action='RETIRE' AND k IN ('target','expectedHead','reviewDigest','impactDigest'))
 )) THEN RAISE EXCEPTION 'ACTION_FIELDS_FORBIDDEN'; END IF;
 req:=(input->>'requestId')::uuid;
 requested_digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(901002);
 -- Serialize authorization changes with commands; current grants cannot disappear mid-write.
 PERFORM 1 FROM vnext_control.actor a WHERE a.code=actor FOR SHARE;
 PERFORM 1 FROM vnext_control.actor_grant WHERE actor_code=actor AND scope=sc FOR SHARE;
 identity:=vnext_control.authorize(actor,sc,CASE WHEN action IN ('PUBLISH','REJECT','RETIRE') THEN 'REVIEW' ELSE 'WRITE' END);
 SELECT o.* INTO existing FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=req;
 IF FOUND THEN IF existing.input_digest<>requested_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF; RETURN existing.result; END IF;
 IF action='CREATE' THEN
  IF object_kind NOT IN ('DATASET','SOURCE','RESPONSIBILITY') OR sc<>'SYNTHETIC' OR coalesce(object_code,'') !~ '^[A-Z0-9_]{2,64}$' OR input ? 'target' OR input ? 'expectedHead' THEN RAISE EXCEPTION 'INVALID_CREATE'; END IF;
  IF object_kind='DATASET' THEN
   SELECT v.payload INTO payload FROM governance_catalog.object o JOIN governance_catalog.version v ON v.object_id=o.id AND v.number=1 WHERE o.kind='DATASET' AND o.scope='BASELINE' AND o.code=object_code;
   IF payload IS NULL THEN RAISE EXCEPTION 'UNKNOWN_DATASET'; END IF;
  ELSE payload:='{}'::jsonb; END IF;
  IF EXISTS(SELECT 1 FROM governance_catalog.object WHERE kind=object_kind AND scope=sc AND code=object_code) THEN RAISE EXCEPTION 'CATALOG_CODE_CONFLICT'; END IF;
  INSERT INTO governance_catalog.object(kind,scope,code) VALUES(object_kind,sc,object_code) RETURNING id INTO target;
 ELSE
  target:=(input->>'target')::uuid;
  SELECT * INTO obj FROM governance_catalog.object WHERE id=target AND scope=sc;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  object_kind:=obj.kind; object_code:=obj.code;
  SELECT * INTO ev FROM governance_catalog.event WHERE object_id=target ORDER BY head DESC LIMIT 1;
  IF coalesce(input->>'expectedHead','')<>ev.head::text THEN RAISE EXCEPTION 'STALE_HEAD'; END IF;
  SELECT * INTO ver FROM governance_catalog.version WHERE id=ev.version_id;
  payload:=ver.payload;
 END IF;
 IF action IN ('CREATE','REVISE') THEN
  IF action='REVISE' AND ev.status='RETIRED' THEN RAISE EXCEPTION 'RETIRED'; END IF;
  IF jsonb_typeof(patch)<>'object' THEN RAISE EXCEPTION 'CLOSED_FIELDS_REQUIRED'; END IF;
  IF object_kind='DATASET' THEN
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(patch) k WHERE k NOT IN ('name','explanation')) THEN RAISE EXCEPTION 'CLOSED_FIELDS_REQUIRED'; END IF;
   payload:=jsonb_set(payload,'{adopted}',coalesce(payload->'adopted','{}')||patch);
  ELSIF object_kind='SOURCE' THEN
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(patch) k WHERE k NOT IN ('name','environment','sourceKind','deploymentScope','vendor','systemVersion','businessOwnerRole','technicalRole','sourceEvidence','interfaceContractRef')) THEN RAISE EXCEPTION 'CLOSED_FIELDS_REQUIRED'; END IF;
   payload:=payload||patch;
   IF coalesce(payload->>'environment','')<>'SYNTHETIC' OR coalesce(payload->>'sourceKind','') NOT IN ('MANUAL','SOFTWARE') OR coalesce(payload->>'deploymentScope','') NOT IN ('UNRESOLVED_DECLARATION','SYNTHETIC_ALL') OR
     coalesce(payload->>'name','')='' OR coalesce(payload->>'businessOwnerRole','')='' OR coalesce(payload->>'technicalRole','')='' THEN RAISE EXCEPTION 'SOURCE_FIELDS_REQUIRED'; END IF;
   IF payload->>'sourceKind'='SOFTWARE' AND (coalesce(payload->>'vendor','')='' OR coalesce(payload->>'systemVersion','')='') THEN RAISE EXCEPTION 'VENDOR_VERSION_REQUIRED'; END IF;
   IF action='REVISE' AND ver.payload->>'sourceEvidence'='SYNTHETIC_BOOTSTRAP' AND payload->>'sourceEvidence' IS DISTINCT FROM 'SYNTHETIC_BOOTSTRAP' THEN RAISE EXCEPTION 'BOOTSTRAP_ROOT_IMMUTABLE'; END IF;
   IF payload->>'sourceEvidence' IS DISTINCT FROM 'SYNTHETIC_BOOTSTRAP' AND coalesce(payload->>'sourceEvidence','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'SOURCE_REFERENCE_INVALID'; END IF;
   IF payload->>'sourceEvidence'='SYNTHETIC_BOOTSTRAP' THEN
    IF action='REVISE' AND ver.payload->>'sourceEvidence' IS DISTINCT FROM 'SYNTHETIC_BOOTSTRAP' THEN RAISE EXCEPTION 'BOOTSTRAP_ALREADY_USED'; END IF;
    IF action='CREATE' AND EXISTS(SELECT 1 FROM governance_catalog.object o WHERE o.kind='SOURCE' AND o.id<>target) THEN RAISE EXCEPTION 'BOOTSTRAP_ALREADY_USED'; END IF;
   ELSE
    source_object:=(payload->>'sourceEvidence')::uuid;
    PERFORM governance_catalog.assert_source_chain(target,source_object,sc);
    IF NOT EXISTS(SELECT 1 FROM governance_catalog.object o JOIN LATERAL(SELECT status FROM governance_catalog.event WHERE object_id=o.id AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1) e ON true WHERE o.id=source_object AND o.kind='SOURCE' AND o.scope=sc AND e.status='PUBLISHED') THEN RAISE EXCEPTION 'SOURCE_EVIDENCE_NOT_READY'; END IF;
    payload:=payload||jsonb_build_object('sourceEvidenceVersion',(SELECT version_id FROM governance_catalog.event WHERE object_id=source_object AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1));
   END IF;
   payload:=payload||jsonb_build_object('readiness','METADATA_ONLY','interfaceReadiness','NOT_READY','approval_status','SYNTHETIC_ONLY');
  ELSE
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(patch) k WHERE k NOT IN ('dataset','authorityScope','fieldGroup','role','assigneeRole')) THEN RAISE EXCEPTION 'CLOSED_FIELDS_REQUIRED'; END IF;
   payload:=payload||patch;
   IF NOT EXISTS(SELECT 1 FROM governance_catalog.object o WHERE o.scope='BASELINE' AND o.kind='DATASET' AND o.code=payload->>'dataset') OR
    coalesce(payload->>'authorityScope','') NOT IN ('ALL','NORTH','SOUTH') OR coalesce(payload->>'fieldGroup','') NOT IN ('ALL','IDENTITY','CONTACT') OR coalesce(payload->>'role','') NOT IN ('OWNER','STEWARD','COLLABORATOR') OR coalesce(payload->>'assigneeRole','') NOT IN ('SYNTHETIC_OWNER_A','SYNTHETIC_OWNER_B','SYNTHETIC_STEWARD') THEN RAISE EXCEPTION 'RESPONSIBILITY_SCOPE_REQUIRED'; END IF;
  END IF;
  IF length(payload::text)>250000 OR EXISTS(SELECT 1 FROM jsonb_each_text(patch) p WHERE length(p.value)>2000) THEN RAISE EXCEPTION 'BOUNDED_INPUT_REQUIRED'; END IF;
  begin_b:=governance_catalog.local_time(input->>'validFrom');
  end_b:=CASE WHEN input->>'validTo' IS NULL THEN NULL ELSE governance_catalog.local_time(input->>'validTo') END;
  IF end_b IS NOT NULL AND end_b<=begin_b THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD'; END IF;
  IF object_kind='SOURCE' AND payload->>'sourceEvidence'<>'SYNTHETIC_BOOTSTRAP' AND NOT EXISTS(SELECT 1 FROM governance_catalog.version p WHERE p.id=(catalog_write.payload->>'sourceEvidenceVersion')::uuid AND tsrange(p.valid_from,p.valid_to,'[)') @> tsrange(begin_b,end_b,'[)')) THEN RAISE EXCEPTION 'SOURCE_PERIOD_NOT_COVERED'; END IF;
  INSERT INTO governance_catalog.version(object_id,number,payload,maker_identity,valid_from,valid_to) VALUES(target,coalesce(ver.number,0)+1,payload,identity,begin_b,end_b) RETURNING id INTO new_version;
  next_status:='DRAFT';
 ELSE
  IF patch<>'{}'::jsonb OR input ? 'validFrom' OR input ? 'validTo' THEN RAISE EXCEPTION 'ACTION_FIELDS_FORBIDDEN'; END IF;
  new_version:=ver.id;
  IF action='SUBMIT' AND ev.status='DRAFT' THEN next_status:='REVIEW';
  ELSIF action='REJECT' AND ev.status='REVIEW' THEN
   PERFORM vnext_control.authorize(actor,sc,'REVIEW'); IF identity=ver.maker_identity THEN RAISE EXCEPTION 'SELF_REVIEW_FORBIDDEN'; END IF; next_status:='DRAFT';
  ELSIF action='PUBLISH' AND ev.status='REVIEW' THEN
   IF identity=ver.maker_identity THEN RAISE EXCEPTION 'SELF_REVIEW_FORBIDDEN'; END IF;
   IF coalesce(input->>'reviewDigest','')<>encode(sha256(convert_to(jsonb_build_object('payload',ver.payload,'validFrom',ver.valid_from,'validTo',ver.valid_to)::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'REVIEW_DIGEST_MISMATCH'; END IF;
   IF object_kind='SOURCE' AND (input ? 'impactDigest' OR jsonb_array_length(governance_catalog.source_impact(target)->'current')>0) THEN
    IF coalesce(input->>'impactDigest','')<>encode(sha256(convert_to(governance_catalog.source_impact(target)::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'IMPACT_REVIEW_MISMATCH'; END IF;
   ELSIF object_kind<>'SOURCE' AND input ? 'impactDigest' THEN RAISE EXCEPTION 'ACTION_FIELDS_FORBIDDEN'; END IF;
   IF object_kind='SOURCE' AND payload->>'sourceEvidence'<>'SYNTHETIC_BOOTSTRAP' AND NOT EXISTS(SELECT 1 FROM (SELECT * FROM governance_catalog.event WHERE object_id=(catalog_write.payload->>'sourceEvidence')::uuid AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1) parent WHERE parent.status='PUBLISHED' AND parent.version_id=(catalog_write.payload->>'sourceEvidenceVersion')::uuid) THEN RAISE EXCEPTION 'SOURCE_EVIDENCE_NOT_READY'; END IF;
   IF object_kind='SOURCE' AND payload->>'sourceEvidence'<>'SYNTHETIC_BOOTSTRAP' THEN PERFORM governance_catalog.assert_source_chain(target,(payload->>'sourceEvidence')::uuid,sc); END IF;
   IF object_kind='RESPONSIBILITY' THEN
    FOR prospective IN SELECT v.payload,s.effective_span FROM governance_catalog.definition_spans(target,timezone('Asia/Shanghai',clock_timestamp()),ver.id) s JOIN governance_catalog.version v ON v.id=s.version_id WHERE v.payload->>'role'='OWNER' AND NOT isempty(s.effective_span) LOOP
     FOR other IN SELECT v.payload,s.effective_span FROM governance_catalog.object o CROSS JOIN LATERAL governance_catalog.definition_spans(o.id,timezone('Asia/Shanghai',clock_timestamp())) s JOIN governance_catalog.version v ON v.id=s.version_id WHERE o.kind='RESPONSIBILITY' AND o.scope=sc AND o.id<>target AND v.payload->>'role'='OWNER' AND v.payload->>'dataset'=prospective.payload->>'dataset' LOOP
      IF (prospective.payload->>'authorityScope'='ALL' OR other.payload->>'authorityScope'='ALL' OR prospective.payload->>'authorityScope'=other.payload->>'authorityScope') AND
       (prospective.payload->>'fieldGroup'='ALL' OR other.payload->>'fieldGroup'='ALL' OR prospective.payload->>'fieldGroup'=other.payload->>'fieldGroup') AND
       prospective.effective_span && other.effective_span THEN RAISE EXCEPTION 'OWNER_PERIOD_CONFLICT'; END IF;
     END LOOP;
    END LOOP;
   END IF;
   next_status:='PUBLISHED';
  ELSIF action='RETIRE' AND EXISTS(SELECT 1 FROM (SELECT status FROM governance_catalog.event WHERE object_id=target AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1) accepted WHERE accepted.status='PUBLISHED') THEN
   SELECT version_id INTO new_version FROM governance_catalog.event WHERE object_id=target AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1;
   SELECT * INTO ver FROM governance_catalog.version WHERE id=new_version;
   IF identity=ver.maker_identity THEN RAISE EXCEPTION 'SELF_REVIEW_FORBIDDEN'; END IF;
   IF coalesce(input->>'reviewDigest','')<>encode(sha256(convert_to(jsonb_build_object('payload',ver.payload,'validFrom',ver.valid_from,'validTo',ver.valid_to)::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'REVIEW_DIGEST_MISMATCH'; END IF;
   IF object_kind='SOURCE' THEN
    IF coalesce(input->>'impactDigest','')<>encode(sha256(convert_to(governance_catalog.source_impact(target)::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'IMPACT_REVIEW_MISMATCH'; END IF;
   ELSIF input ? 'impactDigest' THEN RAISE EXCEPTION 'ACTION_FIELDS_FORBIDDEN'; END IF;
   next_status:='RETIRED';
  ELSE RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
 END IF;
 INSERT INTO governance_catalog.event(object_id,version_id,status,actor_code,reason) VALUES(target,new_version,next_status,actor,input->>'reason') RETURNING * INTO ev;
 SELECT * INTO ver FROM governance_catalog.version WHERE id=new_version;
 content_hash:=encode(sha256(convert_to(jsonb_build_object('payload',ver.payload,'validFrom',ver.valid_from,'validTo',ver.valid_to)::text,'UTF8')),'hex');
 result:=jsonb_build_object('id',target,'head',ev.head::text,'version',ver.number,'versionId',new_version,'status',next_status,'reviewDigest',content_hash,'recordedAt',to_char(ev.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(actor,target,action,input->>'reason',content_hash);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(actor,req,requested_digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,actor);
 RETURN result;
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
 JOIN governance_catalog.version v ON v.id=s.version_id JOIN governance_catalog.event e ON e.head=s.published_head WHERE o.scope=requested_scope) rows;
 RETURN governance_catalog.filter_catalog(actor,jsonb_build_object('items',result,'domains',(SELECT content->'domains' FROM governance_catalog.source_snapshot WHERE source_key='PACKAGE_V2')));
END $$;
CREATE OR REPLACE FUNCTION vnext_control.verify_audit(actor text, checkpoint_sequence bigint DEFAULT NULL, checkpoint_hash text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control AS $$
DECLARE row vnext_control.audit_chain; prior text:=repeat('0',64); previous_sequence bigint:=0; baseline jsonb; actual jsonb; events bigint:=0;
BEGIN
 PERFORM vnext_control.authorize(actor,'SYNTHETIC','AUDIT');
 IF NOT EXISTS(SELECT 1 FROM vnext_control.audit_stream_grant g WHERE g.actor_code=verify_audit.actor AND g.stream_id='GOVERNANCE_CATALOG' AND g.purpose='AUDIT_VERIFY') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 PERFORM pg_advisory_xact_lock(901002);
 PERFORM 1 FROM vnext_control.actor a WHERE a.code=verify_audit.actor FOR SHARE;
 PERFORM 1 FROM vnext_control.actor_grant WHERE actor_code=actor AND scope='SYNTHETIC' AND permission='AUDIT' FOR SHARE;
 PERFORM vnext_control.authorize(actor,'SYNTHETIC','AUDIT');
 IF NOT EXISTS(SELECT 1 FROM vnext_control.audit_stream_grant g WHERE g.actor_code=verify_audit.actor AND g.stream_id='GOVERNANCE_CATALOG' AND g.purpose='AUDIT_VERIFY') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF (checkpoint_sequence IS NULL)<>(checkpoint_hash IS NULL) THEN RAISE EXCEPTION 'AUDIT_CHECKPOINT_INVALID'; END IF;
 IF checkpoint_sequence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vnext_control.audit_chain WHERE audit_stream_id='GOVERNANCE_CATALOG' AND audit_sequence=checkpoint_sequence AND current_hash=checkpoint_hash) THEN RAISE EXCEPTION 'AUDIT_CHECKPOINT_MISMATCH'; END IF;
 FOR row IN SELECT * FROM vnext_control.audit_chain WHERE audit_stream_id='GOVERNANCE_CATALOG' ORDER BY audit_sequence LOOP
  IF row.audit_sequence<=previous_sequence OR row.previous_hash<>prior OR row.current_hash<>vnext_control.audit_hash(row.audit_stream_id,row.audit_sequence,row.previous_hash,row.canonical_payload) THEN RAISE EXCEPTION 'AUDIT_CHAIN_INVALID'; END IF;
  IF previous_sequence=0 THEN
   IF row.audit_sequence<>1 OR row.kind<>'LEGACY_BASELINE' THEN RAISE EXCEPTION 'AUDIT_BASELINE_MISSING'; END IF;
   baseline:=row.canonical_payload;
  ELSE
   SELECT jsonb_build_object('kind','EVENT','audit',to_jsonb(a)) INTO actual FROM vnext_control.audit a WHERE a.id=row.audit_id;
   IF row.kind<>'EVENT' OR actual IS DISTINCT FROM row.canonical_payload THEN RAISE EXCEPTION 'AUDIT_ROW_MISMATCH'; END IF;
   events:=events+1;
  END IF;
  prior:=row.current_hash; previous_sequence:=row.audit_sequence;
 END LOOP;
 IF previous_sequence=0 THEN RAISE EXCEPTION 'AUDIT_BASELINE_MISSING'; END IF;
 SELECT jsonb_build_object('kind','LEGACY_BASELINE','count',count(*)::text,'setDigest',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb)::text,'UTF8')),'hex')) INTO actual
 FROM vnext_control.audit a WHERE NOT EXISTS(SELECT 1 FROM vnext_control.audit_chain c WHERE c.audit_id=a.id);
 IF actual IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'AUDIT_LEGACY_SET_MISMATCH'; END IF;
 RETURN jsonb_build_object('status','PASS','auditStreamId','GOVERNANCE_CATALOG','auditSequence',previous_sequence::text,'currentHash',prior,'eventCount',events::text,'legacyCount',baseline->>'count','legacyProtection','UPGRADE_BASELINE_ONLY');
END $$;
