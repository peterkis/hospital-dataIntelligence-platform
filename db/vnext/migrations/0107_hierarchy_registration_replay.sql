SELECT pg_advisory_xact_lock(901002);

-- Old registrations did not retain request IDs; keep those bindings unknown.
-- New bindings are protected by the existing base-identity immutability trigger.
ALTER TABLE department_master.hierarchy_view
 ADD COLUMN registration_request_id uuid UNIQUE,
 ADD COLUMN registration_payload jsonb,
 ADD CONSTRAINT hierarchy_registration_binding CHECK (
   (registration_request_id IS NULL AND registration_payload IS NULL)
   OR (registration_request_id IS NOT NULL AND registration_payload IS NOT NULL
       AND jsonb_typeof(registration_payload)='object'
       AND registration_payload->>'requestId' IS NOT DISTINCT FROM registration_request_id::text)
 );

DO $patch$ DECLARE body text; needle text; BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_create_view(text,jsonb)'::regprocedure);
 needle:='DECLARE identity text; view_id uuid; digest text;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_REGISTRATION_REPLAY_DECLARE_MISMATCH'; END IF;
 body:=replace(body,needle,needle||' registration_view uuid; registration_body jsonb; registration_identity text;');
 needle:='  IF EXISTS (SELECT 1 FROM department_master.hierarchy_view WHERE source_client_key=';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_REGISTRATION_REPLAY_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,$guard$
  IF coalesce(p_payload->>'viewDigest','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  SELECT h.id,h.registration_payload,v.maker_identity INTO registration_view,registration_body,registration_identity
   FROM department_master.hierarchy_view h JOIN department_master.hierarchy_view_version v ON v.view_id=h.id AND v.version_no=1
   WHERE h.registration_request_id=(p_payload->>'requestId')::uuid;
  IF FOUND THEN
   PERFORM department_master.hierarchy_authorize(p_actor,registration_view,'WRITE');
   PERFORM department_master.hierarchy_authorize(p_actor,registration_view,'READ');
   IF registration_identity IS DISTINCT FROM identity OR registration_body IS DISTINCT FROM p_payload-'viewDigest' THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
   RETURN jsonb_build_object('viewId',registration_view);
  END IF;
$guard$||needle);
 needle:='  INSERT INTO department_master.hierarchy_view(source_client_key,view_code) VALUES (p_payload->>''sourceClientKey'',p_payload->>''viewCode'') RETURNING id INTO view_id;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'HIERARCHY_REGISTRATION_INSERT_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(body,needle,'  INSERT INTO department_master.hierarchy_view(source_client_key,view_code,registration_request_id,registration_payload) VALUES (p_payload->>''sourceClientKey'',p_payload->>''viewCode'',(p_payload->>''requestId'')::uuid,p_payload-''viewDigest'') RETURNING id INTO view_id;');
END $patch$;
