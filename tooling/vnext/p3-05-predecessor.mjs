import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,lstatSync,existsSync,readFileSync,realpathSync} from 'node:fs';
import {resolve,dirname,sep,basename} from 'node:path';
import {unzipSync} from 'fflate';

export const p305PredecessorBaseline='f3778f73b9765e356f7aa44798685ec486147ed3';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Populate0196 with the real, offline, published0196 source. */
export async function withP305Predecessor(work){
 const workspace=realpathSync(resolve('.')),parent=resolve(workspace,'.runtime/vnext/p3-05');mkdirSync(parent,{recursive:true});
 if(lstatSync(parent).isSymbolicLink()||!realpathSync(parent).startsWith(workspace+sep))throw new Error('PREDECESSOR_PATH_INVALID');
 const result=spawnSync('git',['archive','--format=zip',p305PredecessorBaseline,'apps/governance-api/src','apps/governance-api/package.json','tooling/vnext','packages/generated-api-client/src','packages/generated-api-client/package.json','package.json','tsconfig.base.json'],{windowsHide:true,maxBuffer:32*1024*1024});
 if(result.status!==0||!result.stdout?.length)throw new Error('PREDECESSOR_SOURCE_UNAVAILABLE');
 const bytes=result.stdout,digest=hash(bytes),archive=resolve(parent,'predecessor0196-source.zip');
 if(existsSync(archive)){if(lstatSync(archive).isSymbolicLink()||hash(readFileSync(archive))!==digest)throw new Error('PREDECESSOR_SOURCE_DRIFT');}
 else writeFileSync(archive,bytes,{flag:'wx'});
 const sourceReceipt={base:p305PredecessorBaseline,prefix:196,sha256:digest,method:'offline git archive',scope:'populated0196 fixture only',loaderOverlay:{file:'package.json',type:'module'},domainSourceBytesChanged:false};
 const sourceReceiptPath=resolve(parent,'predecessor0196-source.json');
 if(existsSync(sourceReceiptPath)){if(lstatSync(sourceReceiptPath).isSymbolicLink()||JSON.stringify(JSON.parse(readFileSync(sourceReceiptPath,'utf8')))!==JSON.stringify(sourceReceipt))throw new Error('PREDECESSOR_SOURCE_DRIFT');}
 else writeFileSync(sourceReceiptPath,JSON.stringify(sourceReceipt,null,2),{flag:'wx'});
 const directory=mkdtempSync(resolve(parent,'predecessor0196-')),owner=randomUUID(),ownership=resolve(directory,'.p3-05-predecessor-owner');
 writeFileSync(ownership,owner,{flag:'wx'});
 try{
  for(const [name,data] of Object.entries(unzipSync(bytes))){
   const target=resolve(directory,name);
   if(!target.startsWith(directory+sep)||name.includes('\\')||name.includes(':')||name.split('/').some(p=>p==='..'||p==='.'))throw new Error('PREDECESSOR_PATH_INVALID');
   if(name.endsWith('/')){mkdirSync(target,{recursive:true});continue;}
   mkdirSync(dirname(target),{recursive:true});writeFileSync(target,data,{flag:'wx'});
  }
  const packagePath=resolve(directory,'package.json'),manifest=JSON.parse(readFileSync(packagePath,'utf8'));
  writeFileSync(packagePath,JSON.stringify({...manifest,type:'module'}));
  mkdirSync(resolve(directory,'.runtime/vnext'),{recursive:true});
  return await work(directory,sourceReceipt);
 }finally{
  if(dirname(directory)!==parent||!/^predecessor0196-[a-zA-Z0-9]+$/.test(basename(directory))||lstatSync(directory).isSymbolicLink()||!realpathSync(directory).startsWith(realpathSync(parent)+sep)||lstatSync(ownership).isSymbolicLink()||readFileSync(ownership,'utf8')!==owner)throw new Error('PREDECESSOR_CLEANUP_DENIED');
  // The original peer helper writes diagnostics beneath its own extracted root.
  // Retain those bytes before removing our source checkout on a failed fixture.
  const diagnostic=resolve(directory,'.runtime/vnext/last-admin-error.log');
  if(existsSync(diagnostic)){if(lstatSync(diagnostic).isSymbolicLink())throw new Error('PREDECESSOR_CLEANUP_DENIED');const preserved=resolve(parent,'predecessor0196-admin-diagnostic-'+owner+'.log');writeFileSync(preserved,readFileSync(diagnostic),{flag:'wx',mode:0o600});console.log(JSON.stringify({event:'P3_05_PREDECESSOR_DIAGNOSTIC_SAVED',evidence:preserved}));}
  rmSync(directory,{recursive:true});
 }
}
