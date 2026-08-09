BEGIN;

CREATE UNIQUE INDEX price_list_one_open_release_candidate
ON price_list.price_list_release (price_list_id)
WHERE governance_status IN ('DRAFT', 'IN_REVIEW', 'APPROVED');

CREATE OR REPLACE FUNCTION price_list.protect_published_release()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.governance_status = 'PUBLISHED' THEN
    IF TG_OP = 'UPDATE'
       AND OLD.recorded_to IS NULL
       AND NEW.recorded_to IS NOT NULL
       AND NEW.recorded_to > OLD.recorded_from
       AND (to_jsonb(NEW) - ARRAY['recorded_to', 'recorded_period', 'business_period'])
           = (to_jsonb(OLD) - ARRAY['recorded_to', 'recorded_period', 'business_period']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'published price list releases are immutable except for one-time system-validity closure';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.governance_status <> 'DRAFT' THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'submitted price list releases cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.governance_status <> 'DRAFT'
     AND (to_jsonb(NEW) - ARRAY['governance_status', 'governance_release_id'])
         <> (to_jsonb(OLD) - ARRAY['governance_status', 'governance_release_id']) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'submitted price list release content is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION price_list.protect_published_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_release_id uuid;
  parent_status varchar(24);
BEGIN
  IF TG_TABLE_NAME = 'price_entry' THEN
    parent_release_id := OLD.price_list_release_id;
  ELSE
    SELECT price_list_release_id INTO STRICT parent_release_id
    FROM price_list.price_entry WHERE price_entry_id = OLD.price_entry_id;
  END IF;
  SELECT governance_status INTO STRICT parent_status
  FROM price_list.price_list_release WHERE price_list_release_id = parent_release_id;
  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'submitted price entries are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0006_price_list_draft_mutation_guards');

COMMIT;
