SELECT pg_advisory_xact_lock(901002);

-- Finite internal Care interface. Catalog already authorizes the exact parse
-- revision; application/anonymous callers cannot enumerate this helper.
CREATE FUNCTION care_organization.unit_ward_validation_ready(p_revision uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM care_organization.unit_ward_input WHERE job_revision=p_revision);
$$;
REVOKE ALL ON FUNCTION care_organization.unit_ward_validation_ready(uuid) FROM PUBLIC,hdi_prototype;

DO $repair$
DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)'::regprocedure);
 needle:='EXISTS(SELECT 1 FROM care_organization.unit_ward_input WHERE job_revision=p.revision_id)';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'UNIT_WARD_VALIDATION_PORT_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'care_organization.unit_ward_validation_ready(p.revision_id)');
END $repair$;
