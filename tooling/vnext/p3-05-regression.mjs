import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,openSync,closeSync,readFileSync,writeFileSync} from 'node:fs';

// Each database target owns a temporary receipt. The caller holds one managed
// database session around this complete sequential run.
const checks=['vnext:p3-05:unit','vnext:p3-05:typecheck','vnext:files:unit','vnext:workbench:unit','vnext:p1-06:unit','vnext:p2-06:unit','vnext:p2-07:unit','check:module-boundaries','vnext:p3-05:authority','vnext:contract:verify','vnext:apply:fresh','vnext:files:validate','vnext:p1-04:validate','vnext:p2-06:validate','vnext:p2-08:validate','vnext:p3-01:validate','vnext:p3-03:validate','vnext:p3-02:validate','vnext:p3-04:validate'];
const args=process.argv.slice(2);if(args.length!==0&&(args.length!==2||args[0]!=='--from'))throw new Error('CLOSED_COMMAND_REQUIRED');
const start=args.length?checks.indexOf(args[1]):0;if(start<0)throw new Error('CLOSED_COMMAND_REQUIRED');
const manifest=JSON.parse(readFileSync('package.json','utf8'));
if(!process.env.npm_execpath||checks.some(name=>typeof manifest.scripts?.[name]!=='string'))throw new Error('REGRESSION_SCRIPT_UNAVAILABLE');
const directory='.runtime/vnext/p3-05/regression/'+new Date().toISOString().replaceAll(/[:.]/g,'-')+'-'+randomUUID();mkdirSync(directory,{recursive:true});
const results=[],omittedChecks=checks.slice(0,start),summary=status=>({gate:'P3_05_AFFECTED_REGRESSION',status,allChecks:checks,omittedChecks,results,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',clinicalReadiness:'NOT_READY',formalAcceptance:'NOT_RUN'});
writeFileSync(directory+'/summary.json',JSON.stringify(summary('IN_PROGRESS'),null,2),{flag:'wx'});
for(const script of checks.slice(start)){
 const path=directory+'/'+script.replaceAll(':','-')+'.log',fd=openSync(path,'wx');let run;
 try{run=spawnSync(process.execPath,[process.env.npm_execpath,'run',script],{stdio:['ignore',fd,fd],windowsHide:true});}finally{closeSync(fd);}
 const exit=run.status??1;results.push({script,exit,path,signal:run.signal??null});writeFileSync(directory+'/summary.json',JSON.stringify(summary(exit===0?'IN_PROGRESS':'FAIL'),null,2));
 console.log(JSON.stringify(results.at(-1)));
 if(exit!==0){process.exitCode=exit;break;}
}
if(!process.exitCode){const status=omittedChecks.length?'PARTIAL_PASS':'PASS';writeFileSync(directory+'/summary.json',JSON.stringify(summary(status),null,2));console.log(JSON.stringify({gate:'P3_05_AFFECTED_REGRESSION',status,evidence:directory+'/summary.json'}));}
