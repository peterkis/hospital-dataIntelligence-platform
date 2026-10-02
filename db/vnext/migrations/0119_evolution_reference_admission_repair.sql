SELECT pg_advisory_xact_lock(901002);

-- Preserve 0118's installed bytes. A pure ORG22 interval reduction uses its
-- accepted target/facts; it does not introduce a new reference after exit.
CREATE OR REPLACE FUNCTION department_master.guard_replaced_department() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 target uuid;boundary timestamp;
 identifier department_master.organization_identifier;
 previous_mapping department_master.organization_mapping_version;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF TG_TABLE_NAME='version' THEN
  target:=NEW.department_id;
 ELSIF TG_TABLE_NAME='organization_mapping_version' THEN
  IF NEW.action='RETRACT' OR NEW.target_type<>'ORG' THEN RETURN NEW;END IF;
  IF NEW.action='CORRECT' THEN
   SELECT * INTO previous_mapping FROM department_master.organization_mapping_version
    WHERE mapping_id=NEW.mapping_id ORDER BY number DESC LIMIT 1;
   IF previous_mapping.id IS NOT NULL AND previous_mapping.action<>'RETRACT'
    AND NEW.predecessor=previous_mapping.id
    AND NEW.target_type=previous_mapping.target_type AND NEW.target_id=previous_mapping.target_id
    AND NEW.valid_from>=previous_mapping.valid_from
    AND (previous_mapping.valid_to IS NULL OR (NEW.valid_to IS NOT NULL AND NEW.valid_to<=previous_mapping.valid_to))
    AND (NEW.facts->'sourceName') IS NOT DISTINCT FROM (previous_mapping.facts->'sourceName')
    AND (NEW.facts->'resolutionRule') IS NOT DISTINCT FROM (previous_mapping.facts->'resolutionRule')
    AND (NEW.facts->'sourceSystemId') IS NOT DISTINCT FROM (previous_mapping.facts->'sourceSystemId')
   THEN RETURN NEW;END IF;
  END IF;
  target:=NEW.target_id;
 ELSE
  IF NEW.action IN ('END','RETRACT') THEN RETURN NEW;END IF;
  SELECT * INTO identifier FROM department_master.organization_identifier WHERE id=NEW.identifier_id;
  IF identifier.target_type<>'ORG' THEN RETURN NEW;END IF;
  target:=identifier.target_id;
 END IF;
 SELECT effective_at INTO boundary FROM department_master.replacement WHERE department_id=target;
 IF boundary IS NOT NULL AND (NEW.valid_to IS NULL OR NEW.valid_to>boundary) THEN
  RAISE EXCEPTION 'UNSUPPORTED_STATE_TRANSITION';
 END IF;
 RETURN NEW;
END $$;

-- Snapshot ownership is a Department reference independently of its nodes.
DO $repair$
DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('department_master.hierarchy_publish(text,uuid,text,jsonb)'::regprocedure);
 needle:='  owner_id:=(p_payload->>''ownerDepartmentId'')::uuid;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'EVOLUTION_HIERARCHY_OWNER_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,needle||$guard$
  IF EXISTS(SELECT 1 FROM department_master.replacement exit
   WHERE exit.department_id=owner_id AND (p_valid_to IS NULL OR p_valid_to>exit.effective_at))
  THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
$guard$);
END $repair$;
