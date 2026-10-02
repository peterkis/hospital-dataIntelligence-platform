SELECT pg_advisory_xact_lock(901002);

-- Explicit synthetic external-domain authority, provisioned independently of
-- Department/ORG26 access. Each grant binds an accepted responsibility version.
CREATE TABLE department_master.impact_external_owner_access (
 actor text NOT NULL REFERENCES vnext_control.actor(code),
 owner text NOT NULL CHECK(owner IN ('PERSONNEL','PATIENT','ACCOUNT','INVENTORY','FINANCE','CONSUMER')),
 campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),
 permission text NOT NULL CHECK(permission IN ('WRITE','REVIEW')),
 owner_role text NOT NULL CHECK(owner_role ~ '\S'),
 responsibility_version_id uuid NOT NULL REFERENCES governance_catalog.version(id),
 PRIMARY KEY(actor,owner,campus,permission,owner_role,responsibility_version_id)
);
REVOKE ALL ON department_master.impact_external_owner_access FROM PUBLIC,hdi_prototype;

DO $$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('department_master.impact_case_authorize(text,jsonb,text,text)'::regprocedure);
 needle:=$old$IF p_obligation->>'kind'='REFERENCE' THEN$old$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'EXTERNAL_OWNER_AUTHORITY_BASELINE_MISMATCH';END IF;
 EXECUTE replace(definition,needle,$new$IF p_obligation->>'kind'='EXTERNAL' AND p_permission<>'READ' THEN
  IF NOT EXISTS(SELECT 1 FROM department_master.impact_external_owner_access g
   WHERE g.actor=p_actor AND g.owner=p_obligation->>'owner' AND g.campus=p_campus
    AND g.permission=p_permission AND g.owner_role=p_obligation->>'ownerRole') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  IF p_permission='REVIEW' AND identity IS DISTINCT FROM p_obligation->>'ownerSignatory' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 END IF;
 IF p_obligation->>'kind'='REFERENCE' THEN$new$);

 definition:=pg_get_functiondef('governance_catalog.department_impact_responsibility(text,uuid,uuid,text)'::regprocedure);
 needle:=$old$ELSE 'ORG26' END;$old$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'EXTERNAL_RESPONSIBILITY_BASELINE_MISMATCH';END IF;
 definition:=replace(definition,needle,$new$ELSE NULL END;
 IF c.obligation->>'kind'='EXTERNAL' THEN
  PERFORM department_master.impact_case_authorize(p_actor,c.obligation,c.campus,CASE WHEN p_permission='READ' THEN 'WRITE' ELSE p_permission END);
  IF v.payload->>'assigneeRole' IS DISTINCT FROM c.obligation->>'ownerRole'
   OR NOT EXISTS(SELECT 1 FROM department_master.impact_external_owner_access g
    WHERE g.actor=p_actor AND g.owner=c.obligation->>'owner' AND g.campus=c.campus
     AND g.permission=CASE WHEN p_permission='READ' THEN 'WRITE' ELSE p_permission END AND g.owner_role=c.obligation->>'ownerRole'
     AND g.responsibility_version_id=v.id) THEN RAISE EXCEPTION 'RESPONSIBILITY_NOT_READY';END IF;
 ELSIF dataset IS NULL THEN RAISE EXCEPTION 'RESPONSIBILITY_NOT_READY';END IF;$new$);
 needle:=$old$v.payload->>'dataset' IS DISTINCT FROM dataset$old$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'EXTERNAL_RESPONSIBILITY_BASELINE_MISMATCH';END IF;
 EXECUTE replace(definition,needle,$new$(c.obligation->>'kind'='REFERENCE' AND v.payload->>'dataset' IS DISTINCT FROM dataset)$new$);
END $$;
