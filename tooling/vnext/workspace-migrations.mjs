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
