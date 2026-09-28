import {checkPrefix,migrationFiles} from './lineage.mjs';

// One release boundary for the runtime and the receipt-owned deployment runner.
// Advancing SQL without advancing this boundary must fail closed, not run old SQL.
export const workspaceMigration = '0077_workspace_manifest_reference_access';
export function workspaceReleaseFiles(files=migrationFiles()) {
 checkPrefix(files,[]);
 if(files.at(-1)?.id!==workspaceMigration)throw new Error('WORKSPACE_RELEASE_MANIFEST_MISMATCH');
 return files;
}
export function workspaceStartupPrefix(files,ledger) {
 const prefix=checkPrefix(workspaceReleaseFiles(files),ledger);
 // Pre-workspace installations retain their catalog-only path. Once workspace
 // storage exists, all release repairs are mandatory before opening any Owner.
 if(prefix>=71&&prefix!==files.length)throw new Error('WORKSPACE_MIGRATION_REQUIRED');
 return prefix;
}
export function workspaceDeploymentPrefix(files,ledger,reuseExisting=false) {
 const prefix=checkPrefix(workspaceReleaseFiles(files),ledger);
 if(prefix<70)throw new Error('P1_05_LATEST_DEPLOYMENT_REQUIRED');
 if(reuseExisting&&prefix!==files.length)throw new Error('WORKSPACE_ALREADY_DEPLOYED_REQUIRED');
 return prefix;
}
