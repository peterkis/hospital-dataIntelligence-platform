import { spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { root } from './lineage.mjs';
const directory=resolve(root,'.runtime/vnext/P0-02-regressions',randomUUID());
mkdirSync(directory,{recursive:true});
const results=[];
for(const script of ['run-catalog-tests.mjs','accepted-access.mjs','object-access.mjs','source-time.mjs','impact-assessment.mjs','impact-delta.mjs','governance-boundaries.mjs','adversarial.mjs']){
 const result=spawnSync(process.execPath,['--import','tsx','tooling/vnext/'+script],{cwd:root,env:process.env,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
 const log=resolve(directory,script+'.log');writeFileSync(log,(result.stdout??'')+'\n'+(result.stderr??''),{flag:'wx'});
 const receipt={script,exit:result.status,log};results.push(receipt);console.log(JSON.stringify(receipt));
 if(result.status!==0){process.exitCode=1;break;}
}
writeFileSync(resolve(directory,'results.json'),JSON.stringify(results,null,2)+'\n',{flag:'wx'});
