import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,openSync,closeSync,readFileSync,writeFileSync} from 'node:fs';
// Full entry has no selector or resume option. Every required check runs in order.
if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const checks=['vnext:p3-10:unit','vnext:p3-10:typecheck','vnext:p3-11:unit','vnext:p3-11:typecheck',
 ...Array.from({length:9},(_,index)=>`vnext:p3-${String(index+1).padStart(2,'0')}:typecheck`),
 'vnext:p3-07:unit','vnext:p3-05:unit','vnext:p3-04:unit','vnext:p3-03:unit','vnext:p3-02:unit','vnext:p3-01:unit','vnext:p3-08:unit','vnext:p3-06:unit',
 'vnext:p1-01:unit','vnext:p1-02:unit','vnext:p1-03:unit','vnext:p1-04:unit','vnext:p1-05:unit','vnext:p1-06:unit',
 'vnext:p2-01:unit','vnext:p2-02:unit','vnext:p2-03:unit','vnext:p2-04:unit','vnext:p2-05:unit','vnext:p2-06:unit','vnext:p2-07:unit',
 'vnext:files:unit','vnext:workbench:unit','check:module-boundaries','vnext:p3-11:authority','vnext:contract:verify','typecheck','build','vnext:ui:build',
 'vnext:apply:fresh','vnext:p1-04:validate','vnext:p2-06:validate','vnext:p2-08:validate',
 'vnext:p3-01:validate','vnext:p3-03:validate','vnext:p3-02:validate','vnext:p3-04:validate','vnext:p3-05:validate','vnext:p3-06:validate','vnext:p3-08:validate','vnext:p3-09:validate','vnext:p3-07:validate','vnext:p3-11:validate'];
const manifest=JSON.parse(readFileSync('package.json','utf8'));if(!process.env.npm_execpath||checks.some(name=>typeof manifest.scripts?.[name]!=='string'))throw new Error('REGRESSION_SCRIPT_UNAVAILABLE');
const directory='.runtime/vnext/p3-10/regression/'+new Date().toISOString().replaceAll(/[:.]/g,'-')+'-'+randomUUID();mkdirSync(directory,{recursive:true});const results=[],summary=status=>({gate:'P3_10_AFFECTED_REGRESSION',status,checks,omittedChecks:[],results,compilerProcessConcurrency:1,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',clinicalReadiness:'NOT_READY',formalAcceptance:'NOT_RUN'});writeFileSync(directory+'/summary.json',JSON.stringify(summary('IN_PROGRESS'),null,2),{flag:'wx'});
for(const script of checks){const path=directory+'/'+script.replaceAll(':','-')+'.log',fd=openSync(path,'wx'),compilerArgs=/^vnext:p3-(0[1-9]|10|11):typecheck$/.test(script)?['--','--singleThreaded']:[];let result;try{result=spawnSync(process.execPath,[process.env.npm_execpath,'run',script,...compilerArgs],{env:{...process.env,GOMAXPROCS:'1'},stdio:['ignore',fd,fd],windowsHide:true});}finally{closeSync(fd);}const exit=result.status??1;results.push({script,arguments:compilerArgs,exit,path,signal:result.signal??null});if(exit)process.exitCode=exit;writeFileSync(directory+'/summary.json',JSON.stringify(summary(process.exitCode?'FAIL':'IN_PROGRESS'),null,2));console.log(JSON.stringify(results.at(-1)));}
if(!process.exitCode){writeFileSync(directory+'/summary.json',JSON.stringify(summary('PASS'),null,2));console.log(JSON.stringify({gate:'P3_10_AFFECTED_REGRESSION',status:'PASS',evidence:directory+'/summary.json'}));}
