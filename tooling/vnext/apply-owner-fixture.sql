-- Installed only by the receipt-owned P0-08 runner, never part of production lineage.
CREATE SCHEMA p0_08_owner;
CREATE TABLE p0_08_owner.source (
 id uuid PRIMARY KEY DEFAULT uuidv7(), revision uuid NOT NULL DEFAULT uuidv7(),
 campus text NOT NULL DEFAULT 'NORTH', purpose text NOT NULL DEFAULT 'IDENTITY_VERIFY',
 rule_version text NOT NULL DEFAULT 'FINITE_OWNER_V1', quality_head integer NOT NULL DEFAULT 0,
 ready boolean NOT NULL DEFAULT true, rows jsonb NOT NULL
);
CREATE TABLE p0_08_owner.grant_access (
 actor text NOT NULL, job uuid NOT NULL REFERENCES p0_08_owner.source(id), permission text NOT NULL,
 PRIMARY KEY(actor,job,permission)
);
CREATE TABLE p0_08_owner.left_fact (id uuid PRIMARY KEY DEFAULT uuidv7(),version integer NOT NULL DEFAULT 1,value jsonb NOT NULL);
CREATE TABLE p0_08_owner.right_fact (id uuid PRIMARY KEY DEFAULT uuidv7(),version integer NOT NULL DEFAULT 1,value jsonb NOT NULL);
CREATE TABLE p0_08_owner.failure (row_number integer PRIMARY KEY, mode text NOT NULL);
CREATE TABLE p0_08_owner.read_audit (id uuid PRIMARY KEY DEFAULT uuidv7());
CREATE TRIGGER source_lock BEFORE INSERT OR UPDATE OR DELETE ON p0_08_owner.source FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER grant_lock BEFORE INSERT OR UPDATE OR DELETE ON p0_08_owner.grant_access FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER left_lock BEFORE INSERT OR UPDATE OR DELETE ON p0_08_owner.left_fact FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE TRIGGER right_lock BEFORE INSERT OR UPDATE OR DELETE ON p0_08_owner.right_fact FOR EACH STATEMENT EXECUTE FUNCTION vnext_control.lock_authorization_change();
CREATE FUNCTION p0_08_owner.authorize(actor text,input jsonb,permission text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM vnext_control.authorize(actor,'SYNTHETIC',permission);
 IF NOT EXISTS(SELECT 1 FROM p0_08_owner.source s JOIN p0_08_owner.grant_access g ON g.job=s.id WHERE s.id=(input->>'jobId')::uuid AND s.campus=input->>'campus' AND s.purpose=input->>'purpose' AND g.actor=authorize.actor AND g.permission=authorize.permission) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
END $$;
CREATE FUNCTION p0_08_owner.observe(actor text,input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s p0_08_owner.source; targets jsonb;
BEGIN
 PERFORM p0_08_owner.authorize(actor,input,'READ');
 SELECT * INTO s FROM p0_08_owner.source WHERE id=(input->>'jobId')::uuid;
 IF s.revision::text IS DISTINCT FROM input->>'revisionId' THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
 IF NOT s.ready THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('owner',owner,'id',id,'version',version::text) ORDER BY owner,id),'[]') INTO targets FROM (
 SELECT 'FINITE_LEFT' owner,id,version FROM p0_08_owner.left_fact WHERE id IN (SELECT (r->'target'->>'id')::uuid FROM jsonb_array_elements(s.rows) r WHERE r->>'owner'='FINITE_LEFT')
 UNION ALL SELECT 'FINITE_RIGHT',id,version FROM p0_08_owner.right_fact WHERE id IN (SELECT (r->'target'->>'id')::uuid FROM jsonb_array_elements(s.rows) r WHERE r->>'owner'='FINITE_RIGHT')) f;
 RETURN jsonb_build_object('input',input,'atomicRule','FINITE_PAIR_ALL_ROWS_V1','commands',s.rows,'diff',s.rows,
 'basis',jsonb_build_object('sourceId',s.id,'revision',s.revision,'contract','FINITE_PAIR_CONTRACT_V1','parser','FINITE_TYPED_SOURCE_V1','interpretation','EXACT_TEXT_V1','transformation','FINITE_PAIR_MAPPING_V1','ruleVersion',s.rule_version,'qualityHead',s.quality_head,'currentTargets',targets));
END $$;
-- Two separate finite Owner write surfaces. No dynamic SQL or arbitrary table argument.
CREATE FUNCTION p0_08_owner.write_left(command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE f p0_08_owner.left_fact;
BEGIN
 IF command->>'owner'<>'FINITE_LEFT' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
 IF command->>'intent'='CREATE' THEN INSERT INTO p0_08_owner.left_fact(value) VALUES(command->'value') RETURNING * INTO f;
 ELSIF command->>'intent'='REVISE' THEN UPDATE p0_08_owner.left_fact SET version=version+1,value=command->'value' WHERE id=(command->'target'->>'id')::uuid AND version::text=command->'target'->>'version' RETURNING * INTO f;
 ELSE RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
 IF f.id IS NULL THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
 RETURN jsonb_build_object('owner','FINITE_LEFT','id',f.id,'version',f.version::text);
END $$;
CREATE FUNCTION p0_08_owner.write_right(command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE f p0_08_owner.right_fact;
BEGIN
 IF command->>'owner'<>'FINITE_RIGHT' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
 IF command->>'intent'='CREATE' THEN INSERT INTO p0_08_owner.right_fact(value) VALUES(command->'value') RETURNING * INTO f;
 ELSIF command->>'intent'='REVISE' THEN UPDATE p0_08_owner.right_fact SET version=version+1,value=command->'value' WHERE id=(command->'target'->>'id')::uuid AND version::text=command->'target'->>'version' RETURNING * INTO f;
 ELSE RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
 IF f.id IS NULL THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
 RETURN jsonb_build_object('owner','FINITE_RIGHT','id',f.id,'version',f.version::text);
END $$;
CREATE FUNCTION p0_08_owner.exact_read(actor text,input jsonb,fact jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM p0_08_owner.authorize(actor,input,'READ');
 SELECT jsonb_build_object('owner',owner,'id',id,'version',version::text) INTO result FROM (
 SELECT 'FINITE_LEFT' owner,id,version FROM p0_08_owner.left_fact WHERE fact->>'owner'='FINITE_LEFT' AND id=(fact->>'id')::uuid AND version::text=fact->>'version'
 UNION ALL SELECT 'FINITE_RIGHT',id,version FROM p0_08_owner.right_fact WHERE fact->>'owner'='FINITE_RIGHT' AND id=(fact->>'id')::uuid AND version::text=fact->>'version') f;
 RETURN result;
END $$;
CREATE FUNCTION p0_08_owner.intermediate_read(row_number integer) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE mode text;
BEGIN
 INSERT INTO p0_08_owner.read_audit DEFAULT VALUES;
 SELECT f.mode INTO mode FROM p0_08_owner.failure f WHERE f.row_number=intermediate_read.row_number;
 RETURN mode;
END $$;
CREATE FUNCTION p0_08_owner.advance_target(target uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE p0_08_owner.left_fact SET version=version+1 WHERE id=target;
$$;
REVOKE ALL ON SCHEMA p0_08_owner FROM PUBLIC,hdi_prototype;
REVOKE ALL ON ALL TABLES IN SCHEMA p0_08_owner FROM PUBLIC,hdi_prototype;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA p0_08_owner FROM PUBLIC,hdi_prototype;
