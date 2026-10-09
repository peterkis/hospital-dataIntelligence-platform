SELECT pg_advisory_xact_lock(901002);
CREATE TABLE care_organization.ward_nursing_scope_proposal(input_id uuid PRIMARY KEY REFERENCES care_organization.ward_nursing_input(id),scope_set_id uuid NOT NULL REFERENCES care_organization.ward_nursing_scope_set(id),expected_head bigint NOT NULL CHECK(expected_head>0),partitions jsonb NOT NULL CHECK(jsonb_array_length(partitions) BETWEEN 2 AND 100),recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()));
CREATE TABLE care_organization.ward_nursing_scope_version(scope_set_id uuid NOT NULL REFERENCES care_organization.ward_nursing_scope_set(id),number bigint NOT NULL CHECK(number>1),input_id uuid NOT NULL UNIQUE REFERENCES care_organization.ward_nursing_input(id),partitions jsonb NOT NULL,definition jsonb NOT NULL,valid_from timestamp NOT NULL,valid_to timestamp,recorded_at timestamp NOT NULL,verification_basis jsonb NOT NULL,change_id uuid NOT NULL REFERENCES care_organization.ward_nursing_change(id) DEFERRABLE INITIALLY DEFERRED,PRIMARY KEY(scope_set_id,number),CHECK(valid_to IS NULL OR valid_to>valid_from));
DO $$ DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['ward_nursing_scope_proposal','ward_nursing_scope_version'] LOOP EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON care_organization.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',tab);EXECUTE format('ALTER TABLE care_organization.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('REVOKE ALL ON care_organization.%I FROM PUBLIC,hdi_prototype',tab);END LOOP;END $$;
CREATE FUNCTION care_organization.ward_nursing_scope_reserve(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;k bytea;ip bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;r care_organization.ward_nursing_input;d care_organization.ward_nursing_scope_set;p care_organization.ward_nursing_scope_proposal;head bigint;parts jsonb:='[]';alias text;BEGIN
 SELECT decode(key_hex,'hex') INTO k FROM vnext_control.ward_nursing_write_authority;
 IF k IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ip:=set_byte(ip,i,get_byte(ip,i)#get_byte(k,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(k,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ip||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM pg_advisory_xact_lock(901002);PERFORM care_organization.ward_nursing_closed(t,ARRAY['actor','transaction','inputId','inputDigest','target','aliases']);PERFORM care_organization.ward_nursing_closed(t->'target',ARRAY['id','expectedHead']);
 r:=jsonb_populate_record(NULL::care_organization.ward_nursing_input,care_organization.ward_nursing_input_read(t->>'actor',(t->>'inputId')::uuid,'WRITE'));
 IF r.digest IS DISTINCT FROM t->>'inputDigest' OR r.identity_code IS DISTINCT FROM vnext_control.authorize(t->>'actor','SYNTHETIC','WRITE') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 SELECT * INTO d FROM care_organization.ward_nursing_scope_set WHERE id=(t->'target'->>'id')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_COVERAGE_SCOPE';END IF;
 PERFORM care_organization.ward_nursing_authorize(t->>'actor',d.campus_id,'WRITE');PERFORM care_organization.ward_nursing_scope_set_read(t->>'actor',d.id,timezone('Asia/Shanghai',clock_timestamp()));
 SELECT coalesce(max(number),1) INTO head FROM care_organization.ward_nursing_scope_version WHERE scope_set_id=d.id;
 IF head::text IS DISTINCT FROM t->'target'->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
 IF jsonb_typeof(t->'aliases') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'aliases') NOT BETWEEN 2 AND 100 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(t->'aliases'))<>jsonb_array_length(t->'aliases') THEN RAISE EXCEPTION 'SCOPE_REVIEW_REQUIRED';END IF;
 SELECT * INTO p FROM care_organization.ward_nursing_scope_proposal WHERE input_id=r.id;
 IF FOUND THEN IF p.scope_set_id<>d.id OR p.expected_head<>head OR (SELECT jsonb_agg(value->>'sourceAlias' ORDER BY value->>'sourceAlias') FROM jsonb_array_elements(p.partitions)) IS DISTINCT FROM (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text(t->'aliases')) THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
 ELSE
  FOR alias IN SELECT value FROM jsonb_array_elements_text(t->'aliases') LOOP IF length(btrim(alias)) NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;parts:=parts||jsonb_build_array(jsonb_build_object('id',uuidv7(),'sourceAlias',alias));END LOOP;
  INSERT INTO care_organization.ward_nursing_scope_proposal(input_id,scope_set_id,expected_head,partitions) VALUES(r.id,d.id,head,parts) RETURNING * INTO p;
 END IF;
 RETURN jsonb_build_object('scopeSetId',p.scope_set_id,'version',(p.expected_head+1)::text,'status','RESERVED_INPUT','partitions',p.partitions);
END $$;
CREATE FUNCTION care_organization.ward_nursing_scope_proposal_read(p_actor text,p_input uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r care_organization.ward_nursing_input;p care_organization.ward_nursing_scope_proposal;BEGIN
 r:=jsonb_populate_record(NULL::care_organization.ward_nursing_input,care_organization.ward_nursing_input_read(p_actor,p_input,'READ_RESTRICTED'));SELECT * INTO p FROM care_organization.ward_nursing_scope_proposal WHERE input_id=r.id;IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_COVERAGE_SCOPE';END IF;
 RETURN jsonb_build_object('scopeSetId',p.scope_set_id,'version',(p.expected_head+1)::text,'status','RESERVED_INPUT','partitions',p.partitions);
END $$;
REVOKE ALL ON FUNCTION care_organization.ward_nursing_scope_reserve(text,text),care_organization.ward_nursing_scope_proposal_read(text,uuid) FROM PUBLIC,hdi_prototype;
