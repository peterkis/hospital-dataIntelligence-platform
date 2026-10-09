SELECT pg_advisory_xact_lock(901002);
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.lifecycle_record(text,text)'::regprocedure);
 needle:='IF op=''STAGE'' THEN';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_STAGE_REPLAY_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$IF op='LOOKUP_STAGE' THEN
  PERFORM care_organization.closed(t,ARRAY['actor','transaction','operation','requestId','inputDigest']);
  SELECT * INTO r FROM care_organization.lifecycle_input WHERE identity_code=identity AND request_id=(t->>'requestId')::uuid;IF NOT FOUND THEN RETURN NULL;END IF;
  IF r.digest IS DISTINCT FROM t->>'inputDigest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
  RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision,'digest',r.digest);
 END IF;
 IF op='STAGE' THEN$new$);
 body:=replace(body,'q->>''kind'' NOT IN (''UNIT'',''NURSING'',''WARD'',''LOCATION'')','coalesce(q->>''kind'','''') NOT IN (''UNIT'',''NURSING'',''WARD'',''LOCATION'')');EXECUTE body;
END $$;
