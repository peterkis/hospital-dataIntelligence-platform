BEGIN;

ALTER TABLE charge_catalog.charge_item
  ADD COLUMN governance_object_id uuid REFERENCES platform.governance_object;

UPDATE charge_catalog.charge_item item
SET governance_object_id = source.governance_object_id
FROM (
  SELECT DISTINCT ON (version.charge_item_id)
         version.charge_item_id, release.governance_object_id
  FROM charge_catalog.charge_item_version version
  JOIN release_distribution.governance_release release
    ON release.release_id = version.release_id
  ORDER BY version.charge_item_id, version.version_no DESC
) source
WHERE source.charge_item_id = item.charge_item_id;

UPDATE charge_catalog.charge_item item
SET governance_object_id = singleton.governance_object_id
FROM (
  SELECT min(governance_object_id::text)::uuid AS governance_object_id
  FROM platform.governance_object
  WHERE object_type = 'CHARGE_CATALOG'
  HAVING count(*) = 1
) singleton
WHERE item.governance_object_id IS NULL;

DO $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM charge_catalog.charge_item WHERE governance_object_id IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'existing charge item without published governance-object evidence requires controlled remediation';
  END IF;
END;
$function$;

ALTER TABLE charge_catalog.charge_item
  ALTER COLUMN governance_object_id SET NOT NULL,
  DROP CONSTRAINT charge_item_internal_code_key,
  ADD CONSTRAINT charge_item_governance_object_code_key
    UNIQUE (governance_object_id, internal_code);

CREATE INDEX charge_item_governance_object_idx
  ON charge_catalog.charge_item (governance_object_id, charge_item_id);

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0011_charge_item_governance_object_scope');

COMMIT;
