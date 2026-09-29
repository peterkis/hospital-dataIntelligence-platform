import {checkPrefix,migrationFiles} from './lineage.mjs';

// The workspace Owner release ends at 0087. Later vNext migrations remain in
// the same ordered chain, but are accepted only as the complete current tail
// so historical workspace upgrades can still exercise their 0087 seam.
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
 // storage exists, the workspace release or the complete current vNext tail
 // is mandatory before opening any Owner.
 const boundary=releaseFiles.findIndex(file=>file.id===workspaceMigration)+1;
 if(prefix>=71&&prefix!==boundary&&prefix!==releaseFiles.length)throw new Error('WORKSPACE_MIGRATION_REQUIRED');
 return prefix;
}
export function workspaceDeploymentPrefix(files,ledger,reuseExisting=false) {
 const prefix=checkPrefix(workspaceReleaseFiles(files),ledger);
 if(prefix<70)throw new Error('P1_05_LATEST_DEPLOYMENT_REQUIRED');
 if(reuseExisting&&prefix!==files.length)throw new Error('WORKSPACE_ALREADY_DEPLOYED_REQUIRED');
 return prefix;
}
