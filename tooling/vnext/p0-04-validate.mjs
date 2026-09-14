import {spawnSync} from 'node:child_process';
import {root} from './lineage.mjs';
// Temporary validations complete and dispose before touching the current receipt.
for(const args of [
 ['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.files.config.ts','tooling/vnext/file-parser.test.ts'],
 ['--import','tsx','tooling/vnext/run-file-tests.mjs'],
 ['--import','tsx','tooling/vnext/run-file-tests.mjs','--upgrade'],
 ['--import','tsx','tooling/vnext/run-protected-tests.mjs'],
 ['--import','tsx','tooling/vnext/run-import-job-tests.mjs','--fresh'],
 ['tooling/vnext/managed.mjs','migrate'],
 ['tooling/vnext/managed.mjs','types-generate'],
 ['tooling/vnext/managed.mjs','types-verify'],
 ['tooling/vnext/authority.mjs'],
]){
 const result=spawnSync(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
 console.log(JSON.stringify({gate:'P0-04-VALIDATION',command:args,exit:result.status}));
 if(result.status!==0){process.exitCode=result.status??1;break;}
}
