SELECT pg_advisory_xact_lock(901002);

CREATE TABLE department_master.hierarchy_grant (
 actor_code text NOT NULL REFERENCES vnext_control.actor(code),
 object_id uuid NOT NULL REFERENCES department_master.hierarchy_view(id),
 permission text NOT NULL CHECK (permission IN ('READ','WRITE','REVIEW')),
 PRIMARY KEY(actor_code,object_id,permission)
);
REVOKE ALL ON department_master.hierarchy_grant FROM PUBLIC,hdi_prototype;
CREATE TRIGGER hierarchy_grant_lock BEFORE INSERT OR UPDATE OR DELETE ON department_master.hierarchy_grant
 FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER hierarchy_grant_audit AFTER INSERT OR UPDATE OR DELETE ON department_master.hierarchy_grant
 FOR EACH ROW EXECUTE FUNCTION vnext_control.audit_object_grant();

-- Preserve creator ownership only. Historical hospital-level reviewers do not
-- acquire blanket view grants; controlled authorization must name each view.
INSERT INTO department_master.hierarchy_grant(actor_code,object_id,permission)
 SELECT v.maker,v.view_id,p FROM department_master.hierarchy_view_version v
 CROSS JOIN unnest(ARRAY['READ','WRITE']) p WHERE v.version_no=1;

CREATE FUNCTION department_master.hierarchy_authorize(p_actor text,p_view uuid,p_permission text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity text;
BEGIN
 identity:=department_master.authorize(p_actor,'HOSPITAL',p_permission);
 IF NOT EXISTS (SELECT 1 FROM department_master.hierarchy_grant WHERE actor_code=p_actor AND object_id=p_view AND permission=p_permission) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 RETURN identity;
END $$;
REVOKE ALL ON FUNCTION department_master.hierarchy_authorize(text,uuid,text) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION department_master.hierarchy_authorize(text,uuid,text) TO hdi_prototype;

DO $patch$ DECLARE body text; needle text; BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_create_view(text,jsonb)'::regprocedure);
 needle:='  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest)';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_AUTH_CREATE_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,$grant$
  INSERT INTO department_master.hierarchy_grant(actor_code,object_id,permission) SELECT p_actor,view_id,p FROM unnest(ARRAY['READ','WRITE']) p;
$grant$||needle);

 body:=pg_get_functiondef('department_master.hierarchy_store_candidate(text,jsonb)'::regprocedure);
 needle:='  IF p_payload->>''parentCardinality''';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_AUTH_STORE_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,'  PERFORM department_master.hierarchy_authorize(p_actor,view_id,''WRITE'');'||chr(10)||needle);

 body:=pg_get_functiondef('department_master.hierarchy_approve(text,uuid,text)'::regprocedure);
 needle:='department_master.authorize(p_actor,''HOSPITAL'',''REVIEW'')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_AUTH_APPROVE_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,'department_master.hierarchy_authorize(p_actor,(SELECT view_id FROM department_master.hierarchy_candidate WHERE id=p_candidate_id),''REVIEW'')');

 body:=pg_get_functiondef('department_master.hierarchy_publish(text,uuid,text,jsonb)'::regprocedure);
 needle:='  IF c.payload IS DISTINCT FROM p_payload';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_AUTH_PUBLISH_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,'  PERFORM department_master.hierarchy_authorize(p_actor,c.view_id,''WRITE'');'||chr(10)||needle);
 needle:='department_master.authorize(c.approved_by,''HOSPITAL'',''REVIEW'')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_AUTH_REVIEW_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,'department_master.hierarchy_authorize(c.approved_by,c.view_id,''REVIEW'')');

 body:=pg_get_functiondef('department_master.hierarchy_lifecycle(text,text,jsonb)'::regprocedure);
 needle:='  SELECT * INTO c FROM department_master.hierarchy_candidate WHERE request_id=';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_AUTH_CLOSURE_PREPARE_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,'  PERFORM department_master.hierarchy_authorize(p_actor,(body->>''viewId'')::uuid,''WRITE'');'||chr(10)||needle);
 needle:='  IF c.request_id::text IS DISTINCT';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_AUTH_CLOSURE_APPLY_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,'  PERFORM department_master.hierarchy_authorize(p_actor,c.view_id,''WRITE'');'||chr(10)||needle);
 needle:='department_master.authorize(c.approved_by,''HOSPITAL'',''REVIEW'')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_AUTH_CLOSURE_REVIEW_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,'department_master.hierarchy_authorize(c.approved_by,c.view_id,''REVIEW'')');
END $patch$;
