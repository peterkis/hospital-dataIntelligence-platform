import {spawnSync} from 'node:child_process';
if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
for(const suite of ['campus','operating','workspace','bundle']){
 const result=spawnSync(process.execPath,['tooling/vnext/p1-07-validate.mjs','--suite='+suite],{stdio:'inherit',windowsHide:true});
 console.log(JSON.stringify({suite,exit:result.status}));if(result.status!==0){process.exitCode=result.status??1;break;}
}
