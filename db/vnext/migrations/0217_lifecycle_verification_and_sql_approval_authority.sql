SELECT pg_advisory_xact_lock(901002);
ALTER TABLE care_organization.lifecycle_verification ADD COLUMN envelope jsonb;
CREATE FUNCTION care_organization.lifecycle_approval_guard(p_actor text,p_input uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r care_organization.lifecycle_input;v care_organization.lifecycle_verification;m jsonb;member jsonb;identity text;BEGIN
 SELECT * INTO r FROM care_organization.lifecycle_input WHERE id=p_input;IF NOT FOUND THEN RETURN;END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC','REVIEW');
 IF identity=r.identity_code OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.members) x WHERE x->>'makerIdentity'=identity) THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
 SELECT * INTO v FROM care_organization.lifecycle_verification WHERE input_id=r.id;
 IF v.id IS NULL OR v.observation_digest IS DISTINCT FROM r.observation_digest OR vnext_control.authorize(v.actor,'SYNTHETIC','REVIEW') IS DISTINCT FROM v.identity_code OR v.identity_code=r.identity_code OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.members) x WHERE x->>'makerIdentity'=v.identity_code) THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 FOR m IN SELECT value FROM jsonb_array_elements(r.members) LOOP
  CASE m->>'owner'
   WHEN 'UNIT' THEN member:=care_organization.input_read(p_actor,(m->>'inputId')::uuid,'REVIEW');
   WHEN 'NURSING' THEN member:=care_organization.nursing_input_read(p_actor,(m->>'inputId')::uuid,'REVIEW');
   WHEN 'WARD' THEN member:=care_organization.ward_input_read(p_actor,(m->>'inputId')::uuid,'REVIEW');
   WHEN 'UNIT_WARD' THEN member:=care_organization.unit_ward_input_read(p_actor,(m->>'inputId')::uuid,'REVIEW');
   WHEN 'WARD_NURSING' THEN member:=care_organization.ward_nursing_input_read(p_actor,(m->>'inputId')::uuid,'REVIEW');
   WHEN 'CAPABILITY' THEN member:=care_organization.capability_input_read(p_actor,(m->>'inputId')::uuid,'REVIEW');
   WHEN 'PERMISSION' THEN member:=care_organization.subject_input_read(p_actor,(m->>'inputId')::uuid,'REVIEW');
   WHEN 'LOCATION' THEN member:=location_master.input_read(p_actor,(m->>'inputId')::uuid,'REVIEW');
   WHEN 'LOCATION_USE' THEN member:=location_master.use_input_read(p_actor,(m->>'inputId')::uuid,'REVIEW');
   ELSE RAISE EXCEPTION 'ACCESS_DENIED';
  END CASE;
  IF member->>'revision' IS DISTINCT FROM m->>'revisionId' OR member->>'digest' IS DISTINCT FROM m->>'digest' OR member->>'identity_code' IS DISTINCT FROM m->>'makerIdentity' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION care_organization.lifecycle_approval_guard(text,uuid) FROM PUBLIC,hdi_prototype;
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.lifecycle_record(text,text)'::regprocedure);
 body:=replace(body,'WHEN op=''VERIFY'' THEN ''REVIEW''','WHEN op=''CHECK_VERIFICATION'' THEN ''READ'' WHEN op=''VERIFY'' THEN ''REVIEW''');
 body:=replace(body,'''digest'',v.digest,''observationDigest'',v.observation_digest)', '''digest'',v.digest,''observationDigest'',v.observation_digest,''actor'',v.actor,''identity'',v.identity_code,''envelope'',v.envelope)');
 body:=replace(body,'''policy'',''digest'',''observationDigest'']','''policy'',''digest'',''observationDigest'',''envelope'']');
 body:=replace(body,'request_id,digest,observation_digest) VALUES(r.id,actor,identity,(t->>''requestId'')::uuid,t->>''digest'',t->>''observationDigest'')', 'request_id,digest,observation_digest,envelope) VALUES(r.id,actor,identity,(t->>''requestId'')::uuid,t->>''digest'',t->>''observationDigest'',t->''envelope'')');
 needle:='IF op=''VERIFY'' THEN';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_VERIFICATION_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF op=''CHECK_VERIFICATION'' THEN PERFORM care_organization.closed(t,ARRAY[''actor'',''transaction'',''operation'',''inputId'']);PERFORM care_organization.lifecycle_approval_guard(v.actor,r.id);RETURN ''{}'';END IF;'||needle);
 body:=replace(body,'''candidateId'',''digest'',''facts'']','''candidateId'',''digest'',''facts'',''recordAt'']');EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.apply_record(text,text,jsonb)'::regprocedure);
 needle:='IF identity=c.maker_identity THEN RAISE EXCEPTION ''MAKER_CHECKER_REQUIRED''; END IF;';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_APPROVAL_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,needle||'PERFORM care_organization.lifecycle_approval_guard(p_actor,(c.input->>''jobId'')::uuid);');EXECUTE body;
END $$;
