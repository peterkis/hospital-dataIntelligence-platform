BEGIN;

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
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0003_price_list_recording_closure_guard');

COMMIT;
