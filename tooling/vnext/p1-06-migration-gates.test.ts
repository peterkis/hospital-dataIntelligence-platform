import {test,expect} from 'vitest';
import {migrationFiles} from './lineage.mjs';
import {workspaceReleaseFiles,workspaceStartupPrefix,workspaceDeploymentPrefix,workspaceMigration} from './workspace-migrations.mjs';

type Entry={id:string;sha256:string};
const files=migrationFiles(),ledger=(count=files.length):Entry[]=>files.slice(0,count).map(({id,sha256})=>({id,sha256}));

test('the shared release boundary ends at the exact-reference authorization repair',()=>{
 expect(workspaceMigration).toBe('0077_workspace_manifest_reference_access');
 expect(workspaceReleaseFiles(files)).toEqual(files);
 expect(files.at(-1)?.id).toBe(workspaceMigration);
});

for(const prefix of [71,72,73,74,75,76])test(`persistent startup rejects workspace prefix ${prefix}`,()=>{
 expect(()=>workspaceStartupPrefix(files,ledger(prefix))).toThrow('WORKSPACE_MIGRATION_REQUIRED');
});

test('pre-workspace prefix 70 remains supported and the complete release opens',()=>{
 expect(workspaceStartupPrefix(files,ledger(70))).toBe(70);
 expect(workspaceStartupPrefix(files,ledger())).toBe(files.length);
});

for(const defect of ['checksum','hole','reordered','extra'] as const)test(`ordered checksummed lineage rejects ${defect}`,()=>{
 const value=ledger();
 if(defect==='checksum')value[76]={...value[76]!,sha256:'0'.repeat(64)};
 if(defect==='hole')value.splice(74,1);
 if(defect==='reordered')[value[75],value[76]]=[value[76]!,value[75]!];
 if(defect==='extra')value.push({id:'0078_unreviewed',sha256:'0'.repeat(64)});
 expect(()=>workspaceStartupPrefix(files,value)).toThrow('LINEAGE_MISMATCH');
});

test('missing or unexpected migration files require an explicit release update',()=>{
 expect(()=>workspaceReleaseFiles(files.slice(0,-1))).toThrow('WORKSPACE_RELEASE_MANIFEST_MISMATCH');
 expect(()=>workspaceReleaseFiles([...files,{id:'0078_unreviewed',sha256:'0'.repeat(64),sql:''}])).toThrow('WORKSPACE_RELEASE_MANIFEST_MISMATCH');
});

for(const prefix of [70,71,72,73,74,75,76])test(`deployment may upgrade supported prefix ${prefix} but reuse cannot bypass 0077`,()=>{
 expect(workspaceDeploymentPrefix(files,ledger(prefix),false)).toBe(prefix);
 expect(()=>workspaceDeploymentPrefix(files,ledger(prefix),true)).toThrow('WORKSPACE_ALREADY_DEPLOYED_REQUIRED');
});

test('reuse-existing accepts only the complete exact release',()=>{
 expect(workspaceDeploymentPrefix(files,ledger(),true)).toBe(files.length);
});

test('unsupported predecessors remain blocked',()=>{
 expect(()=>workspaceDeploymentPrefix(files,ledger(69),false)).toThrow('P1_05_LATEST_DEPLOYMENT_REQUIRED');
});
