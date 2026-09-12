# HDIP-MC-VNEXT lineage

P0-00 selects a new independent native SQL lineage. This directory contains no SQL yet: business DDL delta = 0. The retained `db/migrations` chain is not installed here. The legacy migration runner rejects `hdi_mc_vnext_` database names before connecting.

Create and inspect the empty local development database using `npm run prototype:db:with -- vnext:db:create` and `npm run prototype:db:with -- vnext:db:verify`. The exact name/OID/owner/request/time is in ignored `.runtime/vnext/creation.json`; pre-create intent is saved separately. Existing intent or receipt blocks another creation. A failed or ambiguous create requires inspection, never automatic adoption or deletion.

Seed delta = 0: no synthetic business rows are needed for baseline work. Current API/client still compile against the retained schema. `npm run prototype:db:with -- check` verifies current generated database types, without regeneration or migration.

Before the first vNext DDL, its ticket must deliver an explicit-target, receipt-verified migration runner; a lineage/version/checksum registry; native constraints and owner grants; synthetic seed; separate generated types; fresh install and within-lineage upgrade tests. Reuse current Kysely generation tooling with an explicit vNext target/configuration. Do not point current codegen at this empty database or use `prototype:validate`, demo reset or legacy seed here. P0-00 does not claim a not-yet-existing schema is installable.

No disposal implementation is exposed. `node tooling/vnext/baseline.mjs cleanup` refuses even a supplied receipt. A future disposal ticket needs exact name/OID/owner/session verification and separate authorization; the development evidence database is retained.
