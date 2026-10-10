import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,openSync,closeSync,writeFileSync} from 'node:fs';

// One managed DB session owns all child processes. Every validation target
// remains complete; the browser and regression use different owned databases.
if(process.argv.length!==2||!process.env.npm_execpath)throw new Error('CLOSED_COMMAND_REQUIRED');
const directory='.runtime/vnext/p3-10/session/'+new Date().toISOString().replaceAll(/[:.]/g,'-')+'-'+randomUUID();
mkdirSync(directory,{recursive:true});const results=[];
async function run(name,file,args=[]){
 const path=directory+'/'+name+'.log',fd=openSync(path,'wx');
 let result;
 try{
  result=await new Promise(resolve=>{
   const child=spawn(process.execPath,['--import','tsx',file,...args],{env:{...process.env,GOMAXPROCS:'1'},stdio:['ignore',fd,fd],windowsHide:true});
   console.log(JSON.stringify({event:'P3_10_SESSION_CHILD_STARTED',name,pid:child.pid,path}));
   child.once('error',error=>resolve({name,path,exit:1,errorCode:error.code??'CHILD_START_FAILED'}));
   child.once('close',(exit,signal)=>resolve({name,path,exit:exit??1,signal:signal??null}));
  });
 }finally{closeSync(fd);}
 results.push(result);console.log(JSON.stringify({event:'P3_10_SESSION_CHILD_CLOSED',...result}));return result;
}
for(const [name,args] of [['fresh',[]],['populated0252',['--upgrade']]]){
 const result=await run(name,'tooling/vnext/p3-10-validate.mjs',args);
 if(result.exit){process.exitCode=result.exit;break;}
}
if(!process.exitCode){
 const finished=await Promise.all([run('regression','tooling/vnext/p3-10-regression.mjs'),run('browser','tooling/vnext/p3-10-browser.mjs')]);
 if(finished.some(result=>result.exit!==0))process.exitCode=1;
}
const report={gate:'P3_10_CONTROLLED_VALIDATION_SESSION',status:process.exitCode?'FAIL':'PROGRAMS_COMPLETED',results,browserAcceptance:'SEE_SEPARATE_ACTUAL_BROWSER_EVIDENCE',retainedDeployment:'SEPARATE_GATE',clinicalReadiness:'NOT_READY',hospitalPolicy:'NOT_ADOPTED',formalAcceptance:'NOT_RUN'};
writeFileSync(directory+'/summary.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({gate:report.gate,status:report.status,evidence:directory+'/summary.json'}));
