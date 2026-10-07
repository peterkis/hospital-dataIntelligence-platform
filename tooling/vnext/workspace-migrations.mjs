import {checkPrefix,migrationFiles} from './lineage.mjs';

// 0087 marks the start of the workspace Owner release. Startup requires the
// complete current chain; predecessor prefixes are supported for upgrades only.
export const workspaceMigration = '0087_department_catalog_interfaces';
const postWorkspaceMigrations = [
 '0088_hierarchy_views',
 '0089_department_committed_row_repair',
 '0090_hierarchy_publish_binding',
 '0091_hierarchy_publish_invariants',
 '0092_hierarchy_publish_whitespace_guard',
 '0093_hierarchy_publication_review',
 '0094_hierarchy_lifecycle',
 '0095_hierarchy_closed_nodes',
 '0096_hierarchy_view_authorization',
 '0097_hierarchy_authorized_reads',
 '0098_hierarchy_candidate_shape',
 '0099_hierarchy_registration_and_clock',
 '0100_hierarchy_registration_time',
 '0101_hierarchy_forest_staging',
 '0102_hierarchy_identity_immutable',
 '0103_hierarchy_snapshot_version_bound',
 '0104_hierarchy_core_full_admission',
 '0105_hierarchy_group_staging',
 '0106_hierarchy_registration_shape',
 '0107_hierarchy_registration_replay',
 '0108_hierarchy_closure_shape',
 '0109_hierarchy_source_record_status',
 '0110_hierarchy_department_effective_period',
 '0111_hierarchy_reviewer_identity_binding',
 '0112_organization_source_mapping',
 '0113_organization_mapping_optional_snapshot',
 '0114_organization_mapping_original_maker_approval',
 '0115_organization_identifiers',
 '0116_org23_contract_and_department_code',
 '0117_organization_identifier_read_authority',
 '0118_department_evolution',
 '0119_evolution_reference_admission_repair',
 '0120_evolution_authorization_closure',
 '0121_evolution_original_read_authority',
 '0122_department_change_impacts',
 '0123_department_impact_dispositions',
 '0124_statistical_frozen_source',
 '0125_impact_exact_hierarchy_closure',
 '0126_impact_original_semantics',
 '0127_impact_frozen_current_authority',
 '0128_identifier_impact_gate',
 '0129_external_impact_owner_authority',
 '0130_impact_assessment_budget',
 '0131_impact_replay_and_terminal_state',
 '0132_impact_terminal_command_order',
 '0133_impact_historical_receipt_replay',
 '0134_department_campus_lifecycle',
 '0135_department_forward_compensation',
 '0136_lifecycle_shared_impacts',
 '0137_department_lifecycle_reference_admission',
 '0138_campus_relation_impact_references',
 '0139_evolution_campus_bundle',
 '0140_lifecycle_authority_closure',
 '0141_lifecycle_effective_time_projection',
 '0142_future_replacement_bounded_rename',
 '0143_evolution_end_relation_scope',
 '0144_department_workspace_drafts',
 '0145_hierarchy_workspace_queries',
 '0146_department_workspace_reference_authorization',
 '0147_department_workspace_complete_references',
 '0148_department_workspace_result_bindings',
 '0149_location_master',
 '0150_location_contract_and_campus_coverage',
 '0151_location_interval_local_revision',
 '0152_campus_business_unit',
 '0153_business_unit_public_ports',
 '0154_business_unit_references_and_withdrawal',
 '0155_business_unit_historical_scope_and_property_stream',
 '0156_business_unit_json_fact_comparison',
 '0157_business_unit_extended_period_and_sql_guard',
 '0158_business_unit_source_rule_integrity',
 '0159_business_unit_expanded_write_budget',
 '0160_business_unit_budget_binding',
 '0161_business_unit_historical_list_and_campus_impact',
 '0162_nursing_unit_core',
 '0163_nursing_unit_public_integration',
 '0164_nursing_masked_binding_impact_period',
 '0165_nursing_ended_campus_impact_window',
 '0166_ward_core',
 '0167_ward_public_integration',
 '0168_ward_accepted_impact_evidence',
 '0169_ward_historical_rebind_evidence',
 '0170_ward_ended_management_references',
 '0171_scoped_parameter_values',
 '0172_unit_capabilities',
 '0173_capability_import_and_impact_integration',
 '0174_capability_finite_impacts',
 '0175_capability_dependency_and_parameter_window_repairs',
 '0176_adopted_subject_codes',
 '0177_subject_permissions_and_mappings',
 '0178_subject_contract_and_public_integration',
 '0179_subject_review_current_interval',
 '0180_subject_unchanged_successor_coverage',
 '0181_subject_replacement_review',
 '0182_subject_retirement_period',
 '0183_subject_retirement_context',
 '0184_subject_catalog_interval_interface',
 '0185_subject_admission_label_notices',
 '0186_unit_ward_relations',
 '0187_unit_ward_public_integration',
 '0188_unit_ward_finite_impacts',
 '0189_unit_ward_shared_boundary_agreement',
 '0190_unit_ward_participant_campus',
 '0191_unit_ward_participant_pins',
 '0192_unit_ward_participant_lifecycle',
 '0193_unit_ward_current_evidence_authority',
 '0194_unit_ward_verification_pins',
 '0195_unit_ward_validation_port',
 '0196_unit_ward_source_windows',
 '0197_ward_nursing_coverages',
 '0198_ward_nursing_public_integration',
 '0199_ward_nursing_finite_impacts',
 '0200_nursing_owner_handover_confirmation',
 '0201_location_usage_types',
 '0202_location_use_relations',
 '0203_location_use_public_integration',
];
export function workspaceReleaseFiles(files=migrationFiles()) {
 checkPrefix(files,[]);
 const boundary=files.findIndex(file=>file.id===workspaceMigration);
 if(boundary<0||JSON.stringify(files.slice(boundary+1).map(file=>file.id))!==JSON.stringify(postWorkspaceMigrations))throw new Error('WORKSPACE_RELEASE_MANIFEST_MISMATCH');
 return files;
}
export function workspaceStartupPrefix(files,ledger) {
 const releaseFiles=workspaceReleaseFiles(files);
 const prefix=checkPrefix(releaseFiles,ledger);
 // Pre-workspace installations retain their catalog-only path. Once workspace
 // storage exists, all current Owner capabilities must precede credential/key
 // loading, Owner creation and listen.
 if(prefix>=71&&prefix!==releaseFiles.length)throw new Error('WORKSPACE_MIGRATION_REQUIRED');
 return prefix;
}
export function workspaceDeploymentPrefix(files,ledger,reuseExisting=false) {
 const prefix=checkPrefix(workspaceReleaseFiles(files),ledger);
 if(prefix<70)throw new Error('P1_05_LATEST_DEPLOYMENT_REQUIRED');
 if(reuseExisting&&prefix!==files.length)throw new Error('WORKSPACE_ALREADY_DEPLOYED_REQUIRED');
 return prefix;
}
