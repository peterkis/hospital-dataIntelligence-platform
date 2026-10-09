import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,lstatSync,realpathSync,rmSync} from 'node:fs';
import {resolve,dirname,basename,sep} from 'node:path';
import {unzipSync} from 'fflate';
import {root} from './lineage.mjs';

export const p311PredecessorBaseline='be4ac4c3450bef52be739564a774eb5716b20f71';
export const p311PredecessorPrefix=205;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Load only the offline, exact published0205 source to populate its old facts. */
export async function withP311Predecessor(work,receipt){
 if(receipt?.taskId!=='P3-11'||receipt.purpose!=='TEMPORARY_VALIDATION'||!/^hdi_mc_vnext_[a-f0-9]{16}$/.test(receipt.name)||!/^\d+$/.test(receipt.oid))throw new Error('TEMPORARY_VALIDATION_REQUIRED');
 const workspace=realpathSync(root),parent=resolve(workspace,'.runtime/vnext/p3-11');mkdirSync(parent,{recursive:true});
 if(lstatSync(parent).isSymbolicLink()||!realpathSync(parent).startsWith(workspace+sep))throw new Error('PREDECESSOR_PATH_INVALID');
 const archived=spawnSync('git',['archive','--format=zip',p311PredecessorBaseline,'apps/governance-api/src','apps/governance-api/package.json','tooling/vnext','packages/generated-api-client/src','packages/generated-api-client/package.json','db/vnext','package.json','tsconfig.base.json'],{cwd:workspace,windowsHide:true,maxBuffer:128*1024*1024});
 if(archived.status!==0||!archived.stdout?.length)throw new Error('P3_11_PREDECESSOR_SOURCE_UNAVAILABLE');
 const bytes=archived.stdout,sha256=digest(bytes),archive=resolve(parent,'predecessor0205-source.zip');
 const sourceReceipt={baseline:p311PredecessorBaseline,prefix:p311PredecessorPrefix,sha256,method:'offline git archive',loaderOverlay:{file:'package.json',type:'module'},domainSourceBytesChanged:false};
 for(const [path,data] of [[archive,bytes],[resolve(parent,'predecessor0205-source.json'),Buffer.from(JSON.stringify(sourceReceipt,null,2))]]){
  if(existsSync(path)){if(lstatSync(path).isSymbolicLink()||!readFileSync(path).equals(data))throw new Error('P3_11_PREDECESSOR_SOURCE_DRIFT');}
  else writeFileSync(path,data,{flag:'wx'});
 }
 const directory=mkdtempSync(resolve(parent,'predecessor0205-')),owner=randomUUID(),ownership=resolve(directory,'.p3-11-predecessor-owner');writeFileSync(ownership,owner,{flag:'wx'});let completed=false;
 try{
  for(const [name,data] of Object.entries(unzipSync(bytes))){
   const target=resolve(directory,name);
   if(!target.startsWith(directory+sep)||name.includes('\\')||name.includes(':')||name.split('/').some(part=>part==='..'||part==='.'))throw new Error('PREDECESSOR_PATH_INVALID');
   if(name.endsWith('/')){mkdirSync(target,{recursive:true});continue;}
   mkdirSync(dirname(target),{recursive:true});writeFileSync(target,data,{flag:'wx'});
  }
  const manifestPath=resolve(directory,'package.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));writeFileSync(manifestPath,JSON.stringify({...manifest,type:'module'}));
  mkdirSync(resolve(directory,'.runtime/vnext'),{recursive:true});
  // Published cold-fixture helpers consult this default path; isolate that
  // loader-only lookup to this receipt rather than the retained workspace DB.
  const receiptBytes=Buffer.from(JSON.stringify({...receipt,taskId:'P3-07'},null,2));writeFileSync(resolve(directory,'.runtime/vnext/creation.json'),receiptBytes,{flag:'wx'});
  const loaderReceipt={...sourceReceipt,loaderOverlay:{...sourceReceipt.loaderOverlay,temporaryReceipt:{file:'.runtime/vnext/creation.json',name:receipt.name,oid:receipt.oid,taskId:'P3-07',runnerTaskId:receipt.taskId,purpose:receipt.purpose,requestId:receipt.requestId,sha256:digest(receiptBytes)}}};
  const result=await work(directory,loaderReceipt);completed=true;return result;
 }finally{
  if(dirname(directory)!==parent||!/^predecessor0205-[a-zA-Z0-9]+$/.test(basename(directory))||lstatSync(directory).isSymbolicLink()||!realpathSync(directory).startsWith(realpathSync(parent)+sep)||lstatSync(ownership).isSymbolicLink()||readFileSync(ownership,'utf8')!==owner)throw new Error('PREDECESSOR_CLEANUP_DENIED');
  const diagnostic=resolve(directory,'.runtime/vnext/last-admin-error.log');
  if(existsSync(diagnostic)){if(lstatSync(diagnostic).isSymbolicLink())throw new Error('PREDECESSOR_CLEANUP_DENIED');writeFileSync(resolve(parent,'predecessor0205-admin-'+owner+'.log'),readFileSync(diagnostic),{flag:'wx',mode:0o600});}
  if(completed)rmSync(directory,{recursive:true});
  else console.log(JSON.stringify({event:'P3_11_PREDECESSOR_FAILURE_SOURCE_RETAINED',directory,sourceArchive:archive}));
 }
}
