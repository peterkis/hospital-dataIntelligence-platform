SELECT pg_advisory_xact_lock(901002);
ALTER TABLE department_master.evolution_event ADD COLUMN compensates_event_id uuid GENERATED ALWAYS AS ((facts->'compensatesEvent'->>'id')::uuid) STORED REFERENCES department_master.evolution_event(id);
ALTER TABLE department_master.evolution_event ADD CONSTRAINT compensation_reference_shape CHECK(compensates_event_id IS NULL OR (facts->'compensatesEvent'->>'owner'='department-master/organization-evolution' AND facts->'compensatesEvent'->>'version'='1'));
CREATE FUNCTION department_master.check_forward_compensation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE original department_master.evolution_event;r department_master.evolution_relation;
BEGIN
 IF NEW.compensates_event_id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO original FROM department_master.evolution_event WHERE id=NEW.compensates_event_id;
 IF original.id IS NULL OR NEW.effective_at<=original.effective_at OR NEW.recorded_at<original.recorded_at OR original.campus<>NEW.campus THEN RAISE EXCEPTION 'UNSUPPORTED_STATE_TRANSITION';END IF;
 FOR r IN SELECT * FROM department_master.evolution_relation WHERE event_id=NEW.id LOOP
  IF NOT EXISTS(SELECT 1 FROM department_master.evolution_relation WHERE event_id=original.id AND to_department_id=r.from_department_id) THEN RAISE EXCEPTION 'UNSUPPORTED_STATE_TRANSITION';END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER forward_compensation AFTER INSERT ON department_master.evolution_event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION department_master.check_forward_compensation();
REVOKE ALL ON FUNCTION department_master.check_forward_compensation() FROM PUBLIC,hdi_prototype;
