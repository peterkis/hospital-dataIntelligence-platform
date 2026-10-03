import {spawnSync} from 'node:child_process';
import {mkdirSync,openSync,closeSync,writeFileSync} from 'node:fs';
// One wrapper owns PostgreSQL for this entire serial, current-vNext matrix.
const checks=[
 ['typecheck'],['build'],['check:runtime'],['check:repo:layout'],['check:module-boundaries'],
 ['vnext:contracts:validate'],['vnext:files:unit'],['vnext:validation:unit'],['vnext:workbench:unit'],
 ['vnext:p1-06:unit'],['vnext:p2-01:unit'],['vnext:p2-02:unit'],['vnext:p2-03:unit'],['vnext:p2-04:unit'],['vnext:p2-05:unit'],['vnext:p2-06:unit'],
 ['vnext:p2-08:typecheck'],['vnext:catalog:boundaries'],['vnext:apply:fresh'],['vnext:files:validate'],
 ['vnext:p1-07:regression'],['vnext:p2-01:validate'],['vnext:p2-02:validate'],['vnext:p2-03:validate'],['vnext:p2-04:validate'],
 ['vnext:p2-05:validate','--','--upgrade'],['vnext:p2-06:validate','--','--upgrade'],['vnext:p2-08:validate','--','--upgrade'],
];
const args=process.argv.slice(2);if(args.length!==0&&(args.length!==2||args[0]!=='--from'))throw new Error('CLOSED_COMMAND_REQUIRED');
const start=args.length?checks.findIndex(([script])=>script===args[1]):0;if(start<0)throw new Error('CLOSED_COMMAND_REQUIRED');
const directory='.runtime/vnext/p2-08/regression/'+new Date().toISOString().replaceAll(/[:.]/g,'-');mkdirSync(directory,{recursive:true});const results=[];
for(const [script,...forwarded] of checks.slice(start)){
 const path=directory+'/'+script.replaceAll(':','-')+'.log',fd=openSync(path,'w');let run;
 try{run=spawnSync(process.execPath,[process.env.npm_execpath,'run',script,...forwarded],{stdio:['ignore',fd,fd],windowsHide:true});}finally{closeSync(fd);}
 results.push({script,args:forwarded,exit:run.status??1,path});console.log(JSON.stringify(results.at(-1)));
 if(run.status!==0){writeFileSync(directory+'/summary.json',JSON.stringify({status:'FAIL',results},null,2));process.exit(run.status??1);}
}
writeFileSync(directory+'/summary.json',JSON.stringify({status:'PASS',scope:start===0?'FULL_APPLICABLE':'REMAINING_FROM_'+checks[start][0],results},null,2));console.log(JSON.stringify({status:'P2_08_REGRESSION_PASSED',summary:directory+'/summary.json'}));
