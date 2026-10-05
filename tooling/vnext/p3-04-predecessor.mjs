import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,lstatSync,existsSync,readFileSync} from 'node:fs';
import {resolve,dirname,sep,basename} from 'node:path';
import {unzipSync} from 'fflate';
// The populated0185 fixture uses its actually published source, not today's
// twelve-domain request schema against yesterday's eleven-domain SQL contract.
export async function withP304Predecessor(work){
 const base='ab6e8002fa2792dca52539b877fa144240fd2631',parent=resolve('.runtime/vnext/p3-04');mkdirSync(parent,{recursive:true});
 const result=spawnSync('git',['archive','--format=zip',base,'apps/governance-api/src','apps/governance-api/package.json','tooling/vnext','packages/generated-api-client/src','packages/generated-api-client/package.json','package.json','tsconfig.base.json'],{windowsHide:true,maxBuffer:32*1024*1024});if(result.status!==0)throw new Error('PREDECESSOR_SOURCE_UNAVAILABLE');
 const bytes=result.stdout,digest=createHash('sha256').update(bytes).digest('hex'),archive=resolve(parent,'predecessor-source-v2.zip');if(existsSync(archive)){if(createHash('sha256').update(readFileSync(archive)).digest('hex')!==digest)throw new Error('PREDECESSOR_SOURCE_DRIFT');}else writeFileSync(archive,bytes,{flag:'wx'});
 const directory=mkdtempSync(resolve(parent,'predecessor-'));
 try{for(const [name,data] of Object.entries(unzipSync(bytes))){const target=resolve(directory,name);if(!target.startsWith(directory+sep)||name.includes('\\')||name.includes(':'))throw new Error('PREDECESSOR_PATH_INVALID');if(name.endsWith('/')){mkdirSync(target,{recursive:true});continue;}mkdirSync(dirname(target),{recursive:true});writeFileSync(target,data,{flag:'wx'});}const packagePath=resolve(directory,'package.json'),manifest=JSON.parse(readFileSync(packagePath,'utf8'));writeFileSync(packagePath,JSON.stringify({...manifest,type:'module'}));mkdirSync(resolve(directory,'.runtime/vnext'),{recursive:true});writeFileSync(resolve(parent,'predecessor-source-v2.json'),JSON.stringify({base,sha256:digest,method:'offline git archive',scope:'populated0185 fixture only',loaderOverlay:{file:'package.json',type:'module'},domainSourceBytesChanged:false},null,2));return await work(directory);
 }finally{if(dirname(directory)!==parent||!/^predecessor-[a-zA-Z0-9]+$/.test(basename(directory))||lstatSync(directory).isSymbolicLink())throw new Error('PREDECESSOR_CLEANUP_DENIED');rmSync(directory,{recursive:true});}
}
