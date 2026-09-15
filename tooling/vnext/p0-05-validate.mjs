import {spawnSync} from 'node:child_process';
import {root} from './lineage.mjs';
const npm=process.env.npm_execpath;
if(!npm)throw new Error('NPM_ENTRY_REQUIRED');
const steps=[
 ['tooling/vnext/validation-sources.mjs','--verify'],
 ['--test','tooling/vnext/contract-sources.test.mjs'],
 [npm,'run','vnext:files:unit'],
 [npm,'run','vnext:validation:unit'],
 ['--import','tsx','tooling/vnext/run-validation-tests.mjs'],
 ['--import','tsx','tooling/vnext/run-validation-tests.mjs','--upgrade','--types'],
 ['--import','tsx','tooling/vnext/run-file-tests.mjs'],
 ['--import','tsx','tooling/vnext/run-protected-tests.mjs'],
 ['--import','tsx','tooling/vnext/run-import-job-tests.mjs','--fresh'],
 ['--import','tsx','tooling/vnext/run-contract-tests.mjs'],
 [npm,'run','vnext:validation:typecheck'],
 [npm,'run','vnext:files:typecheck'],
 [npm,'run','check:module-boundaries'],
 [npm,'run','build','--workspace','@hospital-data-intelligence/governance-api'],
];
for(const args of steps){
 const run=spawnSync(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
 console.log(JSON.stringify({gate:'P0-05-VALIDATION',command:args,exit:run.status,signal:run.signal}));
 if(run.status!==0){process.exitCode=run.status??1;break;}
}
