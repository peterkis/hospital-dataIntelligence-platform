SELECT pg_advisory_xact_lock(901002);
CREATE TABLE care_organization.withdrawal(input_id uuid PRIMARY KEY REFERENCES care_organization.input(id),actor text NOT NULL REFERENCES vnext_control.actor(code),request_id uuid NOT NULL,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()));
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON care_organization.withdrawal FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
ALTER TABLE care_organization.withdrawal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON care_organization.withdrawal FROM PUBLIC,hdi_prototype;
CREATE FUNCTION care_organization.withdraw(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=p_ticket::jsonb;k bytea;i integer;ip bytea:=decode(repeat('36',64),'hex');op bytea:=decode(repeat('5c',64),'hex');r care_organization.input;prior care_organization.withdrawal;BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM care_organization.closed(t,ARRAY['actor','transaction','inputId','requestId']);SELECT decode(key_hex,'hex') INTO k FROM vnext_control.unit_write_authority;
 IF k IS NULL OR t->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;FOR i IN 0..31 LOOP ip:=set_byte(ip,i,get_byte(ip,i)#get_byte(k,i));op:=set_byte(op,i,get_byte(op,i)#get_byte(k,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(op||sha256(ip||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 r:=jsonb_populate_record(NULL::care_organization.input,care_organization.input_read(t->>'actor',(t->>'inputId')::uuid,'WRITE'));
 IF r.identity_code IS DISTINCT FROM vnext_control.authorize(t->>'actor','SYNTHETIC','WRITE') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF EXISTS(SELECT 1 FROM care_organization.change WHERE input_id=r.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;
 SELECT * INTO prior FROM care_organization.withdrawal WHERE input_id=r.id;IF FOUND THEN IF prior.request_id::text IS DISTINCT FROM t->>'requestId' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;ELSE
 INSERT INTO care_organization.withdrawal(input_id,actor,request_id) VALUES(r.id,t->>'actor',(t->>'requestId')::uuid);INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(t->>'actor',r.id,'UNIT_WITHDRAW','EXPLICIT_WITHDRAWAL',r.digest);END IF;
 RETURN jsonb_build_object('inputId',r.id,'status','WITHDRAWN');
END $$;
DO $withdrawal$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.input_read(text,uuid,text)'::regprocedure);needle:='RETURN to_jsonb(r)||';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_READ_BASELINE_MISMATCH';END IF;EXECUTE replace(body,needle,'RETURN to_jsonb(r)||jsonb_build_object(''withdrawn'',EXISTS(SELECT 1 FROM care_organization.withdrawal WHERE input_id=r.id))||');
 body:=pg_get_functiondef('care_organization.mutate(text,text)'::regprocedure);needle:=' IF op=''VERIFY'' THEN';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_WRITE_BASELINE_MISMATCH';END IF;EXECUTE replace(body,needle,' IF EXISTS(SELECT 1 FROM care_organization.withdrawal WHERE input_id=r.id) THEN RAISE EXCEPTION ''INPUT_WITHDRAWN'';END IF;'||needle);
END $withdrawal$;
CREATE FUNCTION care_organization.department_references(p_actor text,p_departments jsonb,p_scope text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ident record;h jsonb;first_v jsonb;latest jsonb;closing timestamp;ending timestamp;result jsonb:='[]';BEGIN
 IF p_scope NOT IN ('NORTH','SOUTH') OR jsonb_typeof(p_departments)<>'array' OR jsonb_array_length(p_departments) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 FOR ident IN SELECT * FROM care_organization.unit WHERE department_id IN(SELECT value::uuid FROM jsonb_array_elements_text(p_departments)) ORDER BY id LOOP
  h:=care_organization.snapshot(p_actor,ident.id);first_v:=h->'versions'->0;latest:=h->'versions'->(jsonb_array_length(h->'versions')-1);
  SELECT min(valid_from) INTO closing FROM care_organization.version WHERE unit_id=ident.id AND action='CLOSE';ending:=least((first_v->>'validTo')::timestamp,closing);
  result:=result||jsonb_build_array(jsonb_build_object('owner','BUSINESS_UNIT','id',ident.id,'versionId',first_v->>'id','version',first_v->>'number','referenceRole','OWNER','sourceSystemIds',jsonb_build_array(first_v->'facts'->'source'->>'sourceSystemId'),'departmentId',ident.department_id,'departmentVersionId',NULL,'acceptedVersions',coalesce(h->'bindings'->0->'versions'->0->'dependencies'->'department'->'accepted'->'departmentParts','[]'),'originalPeriod',jsonb_build_object('from',first_v->>'validFrom','to',first_v->>'validTo'),'originalDigest',encode(sha256(convert_to(first_v::text,'UTF8')),'hex'),'frozenLabel',first_v->'facts'->>'unitName','currentVersionId',latest->>'id','currentPeriod',jsonb_build_object('from',first_v->>'validFrom','to',to_char(ending,'YYYY-MM-DD"T"HH24:MI:SS.US')),'currentAction','ACTIVE','currentTargetId',ident.department_id,'currentReferencesDepartment',true,'current',true));
  IF jsonb_array_length(result)>2000 THEN RAISE EXCEPTION 'PLAN_INPUT_LIMIT';END IF;
 END LOOP;RETURN result;
END $$;
CREATE FUNCTION care_organization.reference_access(p_actor text,p_ref jsonb,p_permission text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h jsonb;b jsonb;BEGIN
 h:=care_organization.snapshot(p_actor,(p_ref->>'id')::uuid);
 IF h->>'departmentId' IS DISTINCT FROM p_ref->>'departmentId' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(h->'versions') v WHERE v->>'id'=p_ref->>'versionId') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(h->'versions') v WHERE v->>'id'=p_ref->>'currentVersionId') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(h->'bindings') LOOP PERFORM care_organization.authorize(p_actor,(b->>'campusId')::uuid,p_permission);END LOOP;
END $$;
CREATE FUNCTION care_organization.campus_dependencies(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_asof timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE bound record;h jsonb;v care_organization.binding_version;first_v jsonb;close_at timestamp;ending timestamp;outstanding boolean;result jsonb:='[]';BEGIN
 PERFORM care_organization.authorize(p_actor,p_id,'READ');
 FOR bound IN SELECT * FROM care_organization.unit_binding WHERE campus_id=p_id ORDER BY id LOOP
  h:=care_organization.snapshot(p_actor,bound.unit_id);first_v:=h->'versions'->0;
  SELECT * INTO v FROM care_organization.binding_version WHERE binding_id=bound.id AND recorded_at<=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp())) ORDER BY number DESC LIMIT 1;IF NOT FOUND THEN CONTINUE;END IF;
  SELECT min(valid_from) INTO close_at FROM care_organization.version WHERE unit_id=bound.unit_id AND action='CLOSE' AND recorded_at<=coalesce(p_asof,timezone('Asia/Shanghai',clock_timestamp()));ending:=least(v.valid_to,close_at,(first_v->>'validTo')::timestamp);
  outstanding:=ending IS NULL OR ending>greatest(v.valid_from,p_from);outstanding:=outstanding AND tsrange(v.valid_from,ending,'[)')&&tsrange(p_from,p_to,'[)');
  result:=result||jsonb_build_array(jsonb_build_object('owner','BUSINESS_UNIT','id',bound.id,'version',v.number::text,'active',outstanding,'outstanding',outstanding));
 END LOOP;RETURN result;
END $$;
CREATE FUNCTION care_organization.impact_result(p_actor text,p_ref jsonb,p_scope text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h jsonb;v care_organization.version;change care_organization.change;outcome jsonb;first_v jsonb;ending timestamp;BEGIN
 IF p_scope NOT IN ('NORTH','SOUTH') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;h:=care_organization.snapshot(p_actor,(p_ref->>'id')::uuid);
 SELECT * INTO v FROM care_organization.version WHERE unit_id=(p_ref->>'id')::uuid AND id=(p_ref->>'versionId')::uuid;IF NOT FOUND OR v.number::text IS DISTINCT FROM h->'versions'->(jsonb_array_length(h->'versions')-1)->>'number' THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 SELECT * INTO change FROM care_organization.change WHERE id=v.change_id AND candidate_id=(p_ref->>'candidateId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 outcome:=governance_catalog.department_impact_committed_result(p_actor,change.candidate_id,(p_ref->>'requestId')::uuid);
 IF outcome->>'status'<>'COMMITTED' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(outcome->'facts') f WHERE f->>'owner'='care-organization/unit' AND f->>'id'=v.unit_id::text AND f->>'version'=v.number::text) THEN RAISE EXCEPTION 'IMPACT_RESULT_MISMATCH';END IF;
 first_v:=h->'versions'->0;SELECT min(valid_from) INTO ending FROM care_organization.version WHERE unit_id=v.unit_id AND action='CLOSE';ending:=least(ending,(first_v->>'validTo')::timestamp);
 RETURN jsonb_build_object('owner','BUSINESS_UNIT','id',v.unit_id,'versionId',v.id,'departmentIds',jsonb_build_array(h->>'departmentId'),'period',jsonb_build_object('from',first_v->>'validFrom','to',to_char(ending,'YYYY-MM-DD"T"HH24:MI:SS.US')),'action',CASE WHEN v.action='CLOSE' THEN 'END' ELSE v.action END,'safeShrink',v.action='CLOSE');
END $$;
DO $impact$ DECLARE body text;BEGIN
 body:=pg_get_functiondef('department_master.impact_reference_access(text,jsonb,text)'::regprocedure);body:=replace(body,E'\r\n',E'\n');EXECUTE replace(body,E'BEGIN\n',E'BEGIN\n IF p_ref->>''owner''=''BUSINESS_UNIT'' THEN PERFORM care_organization.reference_access(p_actor,p_ref,''READ'');RETURN;END IF;\n');
 body:=pg_get_functiondef('department_master.impact_case_authorize(text,jsonb,text,text)'::regprocedure);body:=replace(body,E'\r\n',E'\n');EXECUTE replace(body,E'BEGIN\n',E'BEGIN\n IF ref->>''owner''=''BUSINESS_UNIT'' THEN PERFORM care_organization.reference_access(p_actor,ref,p_permission);RETURN department_master.lifecycle_authorize(p_actor,p_campus,p_permission);END IF;\n');
 body:=pg_get_functiondef('department_master.impact_result(text,jsonb,text)'::regprocedure);body:=replace(body,E'\r\n',E'\n');EXECUTE replace(body,E'BEGIN\n',E'BEGIN\n IF p_ref->>''owner''=''BUSINESS_UNIT'' THEN RETURN care_organization.impact_result(p_actor,p_ref,p_campus);END IF;\n');
 body:=pg_get_functiondef('governance_catalog.department_impact_responsibility(text,uuid,uuid,text)'::regprocedure);IF position('WHEN ''CAMPUS_RELATION'' THEN ''ORG04''' IN body)=0 THEN RAISE EXCEPTION 'UNIT_IMPACT_BASELINE_MISMATCH';END IF;EXECUTE replace(body,'WHEN ''CAMPUS_RELATION'' THEN ''ORG04''','WHEN ''CAMPUS_RELATION'' THEN ''ORG04'' WHEN ''BUSINESS_UNIT'' THEN ''ORG07''');
END $impact$;
REVOKE ALL ON FUNCTION care_organization.withdraw(text,text),care_organization.department_references(text,jsonb,text),care_organization.reference_access(text,jsonb,text),care_organization.campus_dependencies(text,uuid,timestamp,timestamp,timestamp),care_organization.impact_result(text,jsonb,text) FROM PUBLIC,hdi_prototype;
