SELECT pg_advisory_xact_lock(901002);
ALTER TABLE care_organization.nursing_handover_confirmation DROP CONSTRAINT nursing_handover_confirmation_check;
ALTER TABLE care_organization.nursing_handover_confirmation ADD CONSTRAINT nursing_handover_confirmation_check CHECK(
 source_nursing_id<>successor_nursing_id OR (
  binding->'handover' ? 'partitionPlan' AND care_organization.nursing_partial_plan(binding->'handover',binding->'handover'->'partitionPlan'->'sourceCoverage')
 )
);
