import {spawnSync} from 'node:child_process';
import {root} from './lineage.mjs';
// Sequential: at most one receipt-owned temporary database exists at a time.
for(const args of [
 ['tooling/vnext/managed.mjs','types-generate'],
 ['tooling/vnext/managed.mjs','types-verify'],
 ['tooling/vnext/authority.mjs'],
 ['--import','tsx','tooling/vnext/run-import-job-tests.mjs'],
 ['--import','tsx','tooling/vnext/run-contract-tests.mjs'],
 ['--import','tsx','tooling/vnext/run-catalog-tests.mjs'],
]){
 const result=spawnSync(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
 console.log(JSON.stringify({gate:'P0-03-CURRENT-REGRESSIONS',command:args,exit:result.status}));
 if(result.status!==0){process.exitCode=result.status??1;break;}
}
