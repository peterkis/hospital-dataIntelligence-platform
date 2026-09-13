-- Preserve installed 0021 bytes; enforce the frozen contract/version pair.
SELECT pg_advisory_xact_lock(901002);
ALTER TABLE governance_catalog.import_job
 ADD CONSTRAINT import_job_contract_version_pair
 FOREIGN KEY(contract_version_id,contract_id)
 REFERENCES governance_catalog.import_contract_version(id,contract_id);
