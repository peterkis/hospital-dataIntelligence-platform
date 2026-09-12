CREATE SCHEMA vnext_control;
CREATE TABLE vnext_control.migration (
 lineage text NOT NULL CHECK(lineage='HDIP-MC-VNEXT'), id text PRIMARY KEY,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), runner_version text NOT NULL,
 applied_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp())
);
CREATE TABLE vnext_control.actor (
 code text PRIMARY KEY, identity_code text NOT NULL, active boolean NOT NULL
);
CREATE TABLE vnext_control.actor_grant (
 actor_code text NOT NULL REFERENCES vnext_control.actor(code),
 scope text NOT NULL CHECK(scope IN ('BASELINE','SYNTHETIC')),
 permission text NOT NULL CHECK(permission IN ('READ','WRITE','REVIEW')),
 PRIMARY KEY(actor_code,scope,permission)
);
CREATE TABLE vnext_control.outcome (
 actor_code text NOT NULL REFERENCES vnext_control.actor(code), request_id uuid NOT NULL,
 input_digest text NOT NULL, result jsonb NOT NULL,
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 PRIMARY KEY(actor_code,request_id)
);
CREATE TABLE vnext_control.audit (
 id uuid PRIMARY KEY DEFAULT uuidv7(), actor_code text NOT NULL,
 object_id uuid NOT NULL, action text NOT NULL, reason text NOT NULL CHECK(reason ~ '^[A-Z0-9_]{1,64}$'),
 content_digest text NOT NULL, recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp())
);
CREATE FUNCTION vnext_control.immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_HISTORY'; END $$;
CREATE TRIGGER migration_immutable BEFORE UPDATE OR DELETE ON vnext_control.migration FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE TRIGGER outcome_immutable BEFORE UPDATE OR DELETE ON vnext_control.outcome FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE FUNCTION vnext_control.authorize(actor text, requested_scope text, requested_permission text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control AS $$
DECLARE identity text;
BEGIN
 SELECT identity_code INTO identity FROM vnext_control.actor a WHERE a.code=actor AND active;
 IF identity IS NULL OR NOT EXISTS(SELECT 1 FROM vnext_control.actor_grant g WHERE g.actor_code=actor AND g.scope=requested_scope AND g.permission=requested_permission) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 RETURN identity;
END $$;
REVOKE ALL ON FUNCTION vnext_control.authorize(text,text,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA vnext_control TO hdi_prototype;
GRANT SELECT ON vnext_control.migration TO hdi_prototype;
