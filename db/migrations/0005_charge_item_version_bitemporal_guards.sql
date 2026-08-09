BEGIN;

CREATE UNIQUE INDEX charge_item_one_open_version_candidate_idx
  ON charge_catalog.charge_item_version (charge_item_id)
  WHERE governance_status IN ('DRAFT', 'IN_REVIEW', 'APPROVED');

CREATE OR REPLACE FUNCTION charge_catalog.protect_published_version()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.governance_status <> 'DRAFT' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'submitted or published charge item versions cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.governance_status = 'PUBLISHED' THEN
    IF OLD.recorded_to IS NULL
       AND NEW.recorded_to IS NOT NULL
       AND NEW.recorded_to > OLD.recorded_from
       AND (to_jsonb(NEW) - ARRAY['recorded_to', 'recorded_period'])
           = (to_jsonb(OLD) - ARRAY['recorded_to', 'recorded_period']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'published charge item versions are immutable except for one-time record-period closure';
  END IF;

  IF OLD.governance_status <> 'DRAFT'
     AND (
       NEW.formal_name IS DISTINCT FROM OLD.formal_name
       OR NEW.service_definition IS DISTINCT FROM OLD.service_definition
       OR NEW.billing_unit_code IS DISTINCT FROM OLD.billing_unit_code
       OR NEW.charging_method_code IS DISTINCT FROM OLD.charging_method_code
       OR NEW.business_status IS DISTINCT FROM OLD.business_status
       OR NEW.business_valid_from IS DISTINCT FROM OLD.business_valid_from
       OR NEW.business_valid_to IS DISTINCT FROM OLD.business_valid_to
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'submitted charge item version content is immutable';
  END IF;

  RETURN NEW;
END;
$function$;

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0005_charge_item_version_bitemporal_guards');

COMMIT;
