import {spawnSync} from 'node:child_process';
import {root} from './lineage.mjs';
const npm=process.env.npm_execpath;
if(!npm)throw new Error('NPM_ENTRY_REQUIRED');
const steps=[
 [npm,'run','vnext:apply:typecheck'],
 ['--import','tsx','tooling/vnext/run-apply-tests.mjs'],
 ['--import','tsx','tooling/vnext/run-apply-tests.mjs','--upgrade'],
 ['--import','tsx','tooling/vnext/run-dry-run-tests.mjs'],
 ['--import','tsx','tooling/vnext/run-protected-tests.mjs'],
 [npm,'run','vnext:dry-run:typecheck'],
 [npm,'run','check:module-boundaries'],
 [npm,'run','build','--workspace','@hospital-data-intelligence/governance-api']
];
for(const args of steps){
 const run=spawnSync(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
 console.log(JSON.stringify({gate:'P0-08-VALIDATION',command:args,exit:run.status,signal:run.signal}));
 if(run.status!==0){process.exitCode=run.status??1;break;}
}
