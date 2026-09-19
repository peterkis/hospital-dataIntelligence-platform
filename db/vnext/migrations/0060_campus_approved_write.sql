SELECT pg_advisory_xact_lock(901002);
CREATE TABLE vnext_control.campus_write_authority(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),key_hex text NOT NULL CHECK(key_hex ~ '^[a-f0-9]{64}$'));
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON vnext_control.campus_write_authority FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
ALTER TABLE vnext_control.campus_write_authority ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vnext_control.campus_write_authority FROM PUBLIC,hdi_prototype;
-- Only receipt-bound administrative provisioning may initialize the derived key.
CREATE FUNCTION organization_master.campus_write_approved(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ticket jsonb:=p_ticket::jsonb;p_actor text:=ticket->>'actor';p_input uuid:=(ticket->>'inputId')::uuid;p_command jsonb:=ticket->'command';
 c governance_catalog.apply_candidate;a governance_catalog.apply_approval;secret bytea;ipad bytea:=decode(repeat('36',64),'hex');opad bytea:=decode(repeat('5c',64),'hex');i integer;
 r organization_master.input; s uuid;n bigint;v uuid; action text:=p_command->>'action'; BEGIN
 -- HMAC-SHA256 for a fixed 32-byte authority key (RFC 2104), using core SHA256.
 -- Neither this key nor a signing oracle is exposed to the service database role.
 SELECT decode(key_hex,'hex') INTO secret FROM vnext_control.campus_write_authority WHERE singleton;
 IF secret IS NULL OR ticket->>'transaction' IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR i IN 0..31 LOOP ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(secret,i));opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(secret,i));END LOOP;
 IF p_signature IS DISTINCT FROM encode(sha256(opad||sha256(ipad||convert_to(p_ticket,'UTF8'))),'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM pg_advisory_xact_lock(901002);SELECT * INTO r FROM organization_master.input WHERE id=p_input;
 IF r.domain IS DISTINCT FROM 'ORG02' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 SELECT * INTO c FROM governance_catalog.apply_candidate WHERE id=(ticket->>'candidateId')::uuid;
 SELECT * INTO a FROM governance_catalog.apply_approval WHERE candidate_id=c.id;
 IF c.digest IS DISTINCT FROM ticket->>'digest' OR c.input->>'jobId' IS DISTINCT FROM r.id::text OR c.input->>'revisionId' IS DISTINCT FROM r.revision::text OR a.candidate_id IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 IF r.job_revision IS DISTINCT FROM (SELECT current_revision_id FROM governance_catalog.import_job WHERE id=r.job_id) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 PERFORM governance_catalog.apply_record(a.actor_code,'CHECK_APPROVAL',jsonb_build_object('candidateId',c.id));
 PERFORM organization_master.authorize(a.actor_code,r.target,r.campus,'REVIEW');
 PERFORM organization_master.authorize(p_actor,r.target,r.campus,'WRITE');
 IF EXISTS(SELECT 1 FROM organization_master.withdrawal WHERE input_id=r.id) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 IF EXISTS(SELECT 1 FROM organization_master.campus_event WHERE input_id=r.id) THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
 IF p_command->'source'->>'recordStatus' IS DISTINCT FROM 'PUBLISHED' OR nullif(btrim(p_command->'source'->>'approvalRef'),'') IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 s:=r.target;
 IF action='CREATE' THEN
  IF s IS NOT NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  INSERT INTO organization_master.campus(scope) VALUES(r.campus) RETURNING id INTO s;n:=1;
  INSERT INTO organization_master.access SELECT actor,s,campus,permission FROM organization_master.access WHERE subject_id='00000000-0000-0000-0000-000000000000' AND campus=r.campus;
 ELSE
  SELECT coalesce(max(number),0)+1 INTO n FROM organization_master.campus_event WHERE campus_id=s;
  IF (n-1)::text IS DISTINCT FROM p_command->'target'->>'expectedVersion' OR s::text IS DISTINCT FROM p_command->'target'->>'id' OR p_command->'target'->>'owner' IS DISTINCT FROM 'organization-master/campus' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 END IF;
 IF action='SUSPEND' AND p_command->>'validTo' IS NOT NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF action IN ('ACTIVATE','SCHEDULE_OPENING') AND EXISTS(SELECT 1 FROM organization_master.campus_event e JOIN organization_master.campus_operation o ON o.event_id=e.id WHERE e.campus_id=s AND o.state='SUSPENDED' AND tsrange(e.valid_from,e.valid_to,'[)') && tsrange((p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,'[)')) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 IF action IN ('CREATE','REVISE') THEN
 IF organization_master.campus_conflict(s,p_command->'facts'->>'campusCode') THEN RAISE EXCEPTION 'IDENTIFIER_CONFLICT';END IF;
 INSERT INTO organization_master.campus_code VALUES(p_command->'facts'->>'campusCode',s) ON CONFLICT DO NOTHING;
 END IF;
 INSERT INTO organization_master.campus_event(campus_id,number,action,valid_from,valid_to,input_id) VALUES(s,n,action,(p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,r.id) RETURNING id INTO v;
 IF action IN ('CREATE','REVISE') THEN INSERT INTO organization_master.campus_version VALUES(v,p_command->'facts');END IF;
 IF action IN ('CREATE','ACTIVATE','SUSPEND') THEN INSERT INTO organization_master.campus_operation VALUES(v,CASE action WHEN 'CREATE' THEN 'PLANNING' WHEN 'SUSPEND' THEN 'SUSPENDED' ELSE p_command->>'state' END);END IF;
 IF action IN ('SCHEDULE_OPENING','CANCEL_OPENING') THEN INSERT INTO organization_master.campus_plan VALUES(v,(p_command->>'plannedOpeningAt')::timestamp);END IF;
 RETURN jsonb_build_object('owner','organization-master/campus','id',s,'version',n::text);
END $$;

REVOKE ALL ON FUNCTION organization_master.campus_write_approved(text,text) FROM PUBLIC,hdi_prototype;
DO $$ DECLARE r record;BEGIN
 FOR r IN SELECT DISTINCT roles.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles roles ON roles.oid=a.grantee WHERE p.oid='organization_master.campus_write(text,uuid,jsonb)'::regprocedure AND a.privilege_type='EXECUTE' LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION organization_master.campus_write_approved(text,text) TO %I',r.rolname);
 END LOOP;
END $$;
-- Keep the old signature fail-closed even if a broad deployment grant is repeated.
CREATE OR REPLACE FUNCTION organization_master.campus_write(p_actor text,p_input uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'ACCESS_DENIED';END $$;
