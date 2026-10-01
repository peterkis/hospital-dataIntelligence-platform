import {spawnSync} from 'node:child_process';
import {mkdirSync,openSync,closeSync,writeFileSync} from 'node:fs';

// The current vNext suite at the approved Owner/HTTP/role seams. The outer
// prototype:db:with wrapper owns PostgreSQL readiness and cleanup.
if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const scripts=['vnext:contracts:validate','vnext:files:unit','vnext:validation:unit','vnext:workbench:unit','vnext:p1-06:unit','vnext:p2-01:unit','vnext:p2-02:unit','vnext:p2-03:unit','vnext:p2-04:unit','vnext:catalog:boundaries','vnext:apply:fresh','vnext:files:validate','vnext:p2-01:validate','vnext:p2-02:validate','vnext:p2-03:validate','vnext:p2-04:validate'];
const directory='.runtime/vnext/p2-04/regression/'+new Date().toISOString().replaceAll(/[:.]/g,'-');mkdirSync(directory,{recursive:true});const results=[];
for(const script of scripts){
 const path=directory+'/'+script.replaceAll(':','-')+'.log',fd=openSync(path,'w');let run;
 try{run=spawnSync(process.execPath,[process.env.npm_execpath,'run',script],{stdio:['ignore',fd,fd],windowsHide:true});}finally{closeSync(fd);}
 results.push({script,exit:run.status??1,path});console.log(JSON.stringify(results.at(-1)));
 if(run.status!==0){writeFileSync(directory+'/summary.json',JSON.stringify({status:'FAIL',results},null,2));process.exit(run.status??1);}
}
writeFileSync(directory+'/summary.json',JSON.stringify({status:'PASS',results},null,2));
