SELECT pg_advisory_xact_lock(901002);
ALTER TABLE care_organization.lifecycle_input ADD COLUMN targets jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(targets)='array' AND jsonb_array_length(targets)<=300);
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.lifecycle_record(text,text)'::regprocedure);
 needle:='ARRAY[''actor'',''transaction'',''operation'',''requestId'',''campus'',''digest'',''envelope'',''members'',''observationDigest'']';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_TARGET_LINKS_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'ARRAY[''actor'',''transaction'',''operation'',''requestId'',''campus'',''digest'',''envelope'',''members'',''observationDigest'',''targets'']');
 needle:='IF jsonb_typeof(t->''members'') IS DISTINCT FROM ''array''';
 body:=replace(body,needle,$new$IF jsonb_typeof(t->'targets') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'targets')>300 OR EXISTS(SELECT 1 FROM jsonb_array_elements(t->'targets') q WHERE q->>'kind' NOT IN ('UNIT','NURSING','WARD','LOCATION') OR coalesce(q->>'id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR (q-ARRAY['kind','id'])<>'{}'::jsonb) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF jsonb_typeof(t->'members') IS DISTINCT FROM 'array'$new$);
 needle:='envelope,members,observation_digest) VALUES(actor,identity,(t->>''requestId'')::uuid,t->>''digest'',t->>''campus'',t->''envelope'',t->''members'',t->>''observationDigest'')';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_TARGET_INSERT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'envelope,members,observation_digest,targets) VALUES(actor,identity,(t->>''requestId'')::uuid,t->>''digest'',t->>''campus'',t->''envelope'',t->''members'',t->>''observationDigest'',t->''targets'')');
 needle:='''observationDigest'',r.observation_digest,''verification'',';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_TARGET_READ_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'''observationDigest'',r.observation_digest,''targets'',r.targets,''recordedAt'',to_char(r.recorded_at,''YYYY-MM-DD"T"HH24:MI:SS.US''),''verification'',');EXECUTE body;
END $$;
