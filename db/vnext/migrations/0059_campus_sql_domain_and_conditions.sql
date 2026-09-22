SELECT pg_advisory_xact_lock(901002);
DO $writer$
DECLARE body text;needle text:='SELECT * INTO r FROM organization_master.input WHERE id=p_input;';
BEGIN
 body:=pg_get_functiondef('organization_master.write(text,uuid,jsonb,jsonb)'::regprocedure);
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ORGANIZATION_WRITE_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,needle||E'\n IF r.domain IS DISTINCT FROM ''ORG01'' THEN RAISE EXCEPTION ''ACCESS_DENIED'';END IF;');
END $writer$;
CREATE FUNCTION organization_master.plan_input_for(p_actor text,p_id uuid,p_request uuid,p_domain text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r organization_master.input; BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 SELECT * INTO r FROM organization_master.input WHERE id=p_id;
 IF coalesce(p_domain,'') NOT IN ('ORG01','ORG02') OR r.domain IS DISTINCT FROM p_domain THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF organization_master.authorize(p_actor,r.target,r.campus,'WRITE') IS DISTINCT FROM r.identity_code THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 INSERT INTO organization_master.input_request VALUES(r.id,p_request) ON CONFLICT DO NOTHING;
 IF (SELECT request_id FROM organization_master.input_request WHERE input_id=r.id) IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
 IF EXISTS(SELECT 1 FROM governance_catalog.apply_candidate c WHERE c.input->>'jobId'=r.id::text AND c.input->>'requestId'<>p_request::text) THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
 RETURN organization_master.input_read(p_actor,p_id,'READ');
END $$;
REVOKE ALL ON FUNCTION organization_master.plan_input_for(text,uuid,uuid,text) FROM PUBLIC,hdi_prototype;
CREATE OR REPLACE FUNCTION organization_master.plan_input(p_actor text,p_id uuid,p_request uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT organization_master.plan_input_for(p_actor,p_id,p_request,'ORG01') $$;
DO $$ DECLARE r record;BEGIN
 FOR r IN SELECT DISTINCT roles.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles roles ON roles.oid=a.grantee WHERE p.oid='organization_master.plan_input(text,uuid,uuid)'::regprocedure AND a.privilege_type='EXECUTE' LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION organization_master.plan_input_for(text,uuid,uuid,text) TO %I',r.rolname);
 END LOOP;
END $$;
CREATE FUNCTION organization_master.withdraw_for(p_actor text,p_id uuid,p_request uuid,p_domain text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r organization_master.input; identity text; digest text; prior vnext_control.outcome; result jsonb; BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 SELECT * INTO r FROM organization_master.input WHERE id=p_id;
 IF coalesce(p_domain,'') NOT IN ('ORG01','ORG02') OR r.domain IS DISTINCT FROM p_domain THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 identity:=organization_master.authorize(p_actor,r.target,r.campus,'WRITE');
 digest:=encode(sha256(convert_to(jsonb_build_array('ORGANIZATION_WITHDRAW',p_id)::text,'UTF8')),'hex');
 SELECT o.* INTO prior FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=p_request;
 IF FOUND THEN IF prior.input_digest<>digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF; RETURN prior.result; END IF;
 IF EXISTS(SELECT 1 FROM governance_catalog.apply_candidate c JOIN governance_catalog.apply_commit x ON x.candidate_id=c.id WHERE c.input->>'jobId'=r.id::text) THEN RAISE EXCEPTION 'ALREADY_COMMITTED'; END IF;
 INSERT INTO organization_master.withdrawal VALUES(r.id,p_actor,p_request,timezone('Asia/Shanghai',clock_timestamp())) ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'ORGANIZATION_WITHDRAW','NON_EXPANSIVE',r.digest);
 result:=jsonb_build_object('inputId',r.id,'status','WITHDRAWN');
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(p_actor,p_request,digest,result);
 INSERT INTO vnext_control.request_identity VALUES(identity,p_request,p_actor);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION organization_master.withdraw_for(text,uuid,uuid,text) FROM PUBLIC,hdi_prototype;
CREATE OR REPLACE FUNCTION organization_master.withdraw(p_actor text,p_id uuid,p_request uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT organization_master.withdraw_for(p_actor,p_id,p_request,'ORG01') $$;
DO $$ DECLARE r record;BEGIN
 FOR r IN SELECT DISTINCT roles.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles roles ON roles.oid=a.grantee WHERE p.oid='organization_master.withdraw(text,uuid,uuid)'::regprocedure AND a.privilege_type='EXECUTE' LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION organization_master.withdraw_for(text,uuid,uuid,text) TO %I',r.rolname);
 END LOOP;
END $$;

-- Both fixed Owner conditions, and their fields, are mandatory in this finite template.
DO $conditions$
DECLARE body text;needle text;guard text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.validation_rules_valid(jsonb,uuid)'::regprocedure);
 needle:=' FOR rule IN SELECT value FROM jsonb_array_elements(definition->''rules'') LOOP';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAMPUS_RULE_BASELINE_MISMATCH';END IF;
 guard:=$guard$
 IF code='ORG02' AND definition->>'templateVersion'='ORG02_MANUAL_CORE_V1' AND (
  NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition->'rules') r WHERE r->>'id'='SRC-COND-005' AND r->>'field'='campus_address' AND r->>'status'='MACHINE') OR
  NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition->'rules') r WHERE r->>'id'='SRC-COND-006' AND r->>'field'='admin_division_code' AND r->>'status'='MACHINE') OR
  NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition->'fields') f WHERE f->>'code'='campus_address' AND f->>'condition'='EVALUATED') OR
  NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition->'fields') f WHERE f->>'code'='admin_division_code' AND f->>'condition'='EVALUATED')
 ) THEN RETURN false;END IF;
$guard$;
 EXECUTE replace(body,needle,guard||needle);
 -- Already published incomplete declarations remain history, not admission evidence.
 body:=pg_get_functiondef('governance_catalog.campus_division(text,jsonb,timestamp without time zone,timestamp without time zone)'::regprocedure);
 needle:=' SELECT value INTO c FROM jsonb_array_elements(v.definition->''codeSets'')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAMPUS_DIVISION_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,' IF NOT governance_catalog.validation_rules_valid(v.definition,v.dataset_version_id) THEN RAISE EXCEPTION ''BLOCKED_DEPENDENCY'';END IF;'||E'\n'||needle);
END $conditions$;
