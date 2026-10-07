import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,lstatSync,realpathSync,rmSync} from 'node:fs';
import {resolve,dirname,basename,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {unzipSync} from 'fflate';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,peer,quote,identitySQL,root,readReceipt} from './lineage.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import {grantDepartment} from './p2-01-validate.mjs';
import {removeValidationKeys} from './p3-05-validation-keys.mjs';
import {disposeWardNursingValidation} from './p3-05-disposal.mjs';

export const handoverPredecessorBaseline='b6515b22c541cc5783c4406e691202e3904dffec';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Only this isolated test loader executes the exact pre-confirmation Owner. */
export async function withHandoverPredecessor(work,receipt){
 if(receipt?.taskId!=='P3-05'||receipt.purpose!=='TEMPORARY_VALIDATION'||!/^hdi_mc_vnext_[a-f0-9]{16}$/.test(receipt.name)||!/^\d+$/.test(receipt.oid))throw new Error('TEMPORARY_VALIDATION_REQUIRED');
 const workspace=realpathSync(root),parent=resolve(workspace,'.runtime/vnext/p3-05');mkdirSync(parent,{recursive:true});
 if(lstatSync(parent).isSymbolicLink()||!realpathSync(parent).startsWith(workspace+sep))throw new Error('PREDECESSOR_PATH_INVALID');
 const archived=spawnSync('git',['archive','--format=zip',handoverPredecessorBaseline,'apps/governance-api/src','apps/governance-api/package.json','tooling/vnext','packages/generated-api-client/src','packages/generated-api-client/package.json','db/vnext','package.json','tsconfig.base.json'],{cwd:workspace,windowsHide:true,maxBuffer:128*1024*1024});
 if(archived.status!==0||!archived.stdout?.length)throw new Error('HANDOVER_PREDECESSOR_SOURCE_UNAVAILABLE');
 const bytes=archived.stdout,sha256=digest(bytes),archive=resolve(parent,'handover-predecessor0199-source.zip');
 const sourceReceipt={baseline:handoverPredecessorBaseline,prefix:199,sha256,method:'offline git archive',loaderOverlay:{file:'package.json',type:'module'},domainSourceBytesChanged:false};
 for(const [path,data] of [[archive,bytes],[resolve(parent,'handover-predecessor0199-source.json'),Buffer.from(JSON.stringify(sourceReceipt,null,2))]]){
  if(existsSync(path)){if(lstatSync(path).isSymbolicLink()||!readFileSync(path).equals(data))throw new Error('HANDOVER_PREDECESSOR_SOURCE_DRIFT');}
  else writeFileSync(path,data,{flag:'wx'});
 }
 const directory=mkdtempSync(resolve(parent,'handover-predecessor0199-')),owner=randomUUID(),ownership=resolve(directory,'.p3-05-handover-predecessor-owner');writeFileSync(ownership,owner,{flag:'wx'});
 try{
  for(const [name,data] of Object.entries(unzipSync(bytes))){
   const target=resolve(directory,name);
   if(!target.startsWith(directory+sep)||name.includes('\\')||name.includes(':')||name.split('/').some(p=>p==='..'||p==='.'))throw new Error('PREDECESSOR_PATH_INVALID');
   if(name.endsWith('/')){mkdirSync(target,{recursive:true});continue;}
   mkdirSync(dirname(target),{recursive:true});writeFileSync(target,data,{flag:'wx'});
  }
  const manifestPath=resolve(directory,'package.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));writeFileSync(manifestPath,JSON.stringify({...manifest,type:'module'}));
  mkdirSync(resolve(directory,'.runtime/vnext'),{recursive:true});
  // Archived fixtures read this default path when reusing their published
  // transport contract. Bind that test-only lookup to this owned temporary DB.
  const receiptBytes=Buffer.from(JSON.stringify(receipt,null,2));writeFileSync(resolve(directory,'.runtime/vnext/creation.json'),receiptBytes,{flag:'wx'});
  const loaderReceipt={...sourceReceipt,loaderOverlay:{...sourceReceipt.loaderOverlay,temporaryReceipt:{file:'.runtime/vnext/creation.json',name:receipt.name,oid:receipt.oid,taskId:receipt.taskId,purpose:receipt.purpose,requestId:receipt.requestId,sha256:digest(receiptBytes)}}};
  return await work(directory,loaderReceipt);
 }finally{
  if(dirname(directory)!==parent||!/^handover-predecessor0199-[a-zA-Z0-9]+$/.test(basename(directory))||lstatSync(directory).isSymbolicLink()||!realpathSync(directory).startsWith(realpathSync(parent)+sep)||lstatSync(ownership).isSymbolicLink()||readFileSync(ownership,'utf8')!==owner)throw new Error('PREDECESSOR_CLEANUP_DENIED');
  const diagnostic=resolve(directory,'.runtime/vnext/last-admin-error.log');
  if(existsSync(diagnostic)){if(lstatSync(diagnostic).isSymbolicLink())throw new Error('PREDECESSOR_CLEANUP_DENIED');writeFileSync(resolve(parent,'handover-predecessor0199-admin-'+owner+'.log'),readFileSync(diagnostic),{flag:'wx',mode:0o600});}
  rmSync(directory,{recursive:true});
 }
}

function rowHashes(receipt,tables){
 const queries=tables.filter(table=>table!=='vnext_control.migration').map(table=>{
  if(!/^(vnext_control|governance_catalog|organization_master|department_master|location_master|care_organization)\.[a-z_]+$/.test(table))throw new Error('PRESERVATION_TABLE_INVALID');
  return `SELECT ${quote(table)} name,coalesce(jsonb_agg(encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') ORDER BY to_jsonb(o)::text),'[]') hashes FROM ${table} o`;
 });
 return JSON.parse(peer(receipt.name,'\\set QUIET on\n'+identitySQL(receipt)+`SELECT jsonb_object_agg(name,hashes)::text FROM (${queries.join(' UNION ALL ')}) original_rows;`));
}
function assertOriginalRows(before,after){
 let checked=0;
 for(const [table,hashes] of Object.entries(before)){
  const remaining=new Map();for(const hash of after[table])remaining.set(hash,(remaining.get(hash)??0)+1);
  for(const hash of hashes){assert.ok((remaining.get(hash)??0)>0,'Original0199 row changed: '+table);remaining.set(hash,remaining.get(hash)-1);checked++;}
 }
 return checked;
}

async function runUpgrade(){
 const args=process.argv.slice(2);
 if(args[0]==='--dispose'){
  if(args.length!==2||!/^\.runtime\/vnext\/fresh\/hdi_mc_vnext_[a-f0-9]{16}\.json$/.test(args[1]))throw new Error('CLOSED_COMMAND_REQUIRED');
  console.log(JSON.stringify(disposeWardNursingValidation(readReceipt(args[1]))));return;
 }
 if(args.some(arg=>arg!=='--generate')||args.length>1)throw new Error('CLOSED_COMMAND_REQUIRED');
 if(!process.env.npm_execpath)throw new Error('MANAGED_NPM_SCRIPT_REQUIRED');
 const currentFiles=migrationFiles();assert.equal(currentFiles.length,200,'EXACT_0200_CANDIDATE_REQUIRED');
 const owned=createTemporary('P3-05');let session;
 const run=(mode)=>{const result=spawnSync(process.execPath,['--import','tsx','tooling/vnext/p3-05-handover-upgrade-fixture.ts',...(mode?[mode]:[])],{cwd:root,env:{...process.env,VNEXT_VALIDATION_OWNER_URL:session.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P3-05-HANDOVER-UPGRADE'},stdio:'inherit',windowsHide:true});assert.equal(result.status,0,'HANDOVER_UPGRADE_FIXTURE_FAILED');};
 const keysPath=resolve(root,'.runtime/vnext/p3-05',owned.receipt.name+'.secret.json');
 try{
  await withHandoverPredecessor(async directory=>{
   const archivedLineage=await import(pathToFileURL(resolve(directory,'tooling/vnext/lineage.mjs')).href),archivedSeed=await import(pathToFileURL(resolve(directory,'tooling/vnext/catalog-seed.mjs')).href),files=archivedLineage.migrationFiles();
   assert.equal(files.length,199);assert.deepEqual(files.map(({id,sha256})=>({id,sha256})),currentFiles.slice(0,199).map(({id,sha256})=>({id,sha256})),'Original0199 migration bytes must remain unchanged');
   await archivedLineage.migrate(owned.receipt,files);await archivedSeed.seed(owned.receipt);
  },owned.receipt);
  session=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,session.receipt.role);grantDepartment(owned.receipt,session.receipt.role);
  peer(owned.receipt.name,identitySQL(owned.receipt)+`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.department_lifecycle_assessment(text,text) TO ${session.receipt.role};`);
  run();
  const before=await inspect(owned.receipt);assert.equal(before.ledger.length,199);const originalRows=rowHashes(owned.receipt,before.tables),keyDigest=digest(readFileSync(keysPath));
  const beforePath=owned.receiptPath+'.handover0199.before.json';writeFileSync(beforePath,JSON.stringify({gate:'P3_05_HANDOVER_POPULATED_0199',baseline:handoverPredecessorBaseline,oid:owned.receipt.oid,ledger:before.ledger,rowHashes:originalRows,keyDigest},null,2),{flag:'wx'});
  await migrate(owned.receipt);const after=await inspect(owned.receipt);assert.equal(after.ledger.length,200);assert.deepEqual(after.ledger.slice(0,199),before.ledger);assert.deepEqual(rowHashes(owned.receipt,before.tables),originalRows);assert.equal(digest(readFileSync(keysPath)),keyDigest);
  assert.equal(peer(owned.receipt.name,'\\set QUIET on\n'+identitySQL(owned.receipt)+'SELECT count(*) FROM care_organization.nursing_handover_confirmation;'),'0','Upgrade must not backfill Nursing proof');
  // 0200 replaces the public mutate function and adds only explicit Nursing ports.
  peer(owned.receipt.name,identitySQL(owned.receipt)+`GRANT EXECUTE ON FUNCTION care_organization.ward_nursing_mutate(text,text),care_organization.nursing_handover_confirm(text,text),care_organization.nursing_handover_confirmation_read(text,uuid,text,jsonb) TO ${session.receipt.role};`);
  for(const command of [[args.includes('--generate')?'types-generate':'types-verify'],['authority']]){
   const result=command[0]==='authority'?spawnSync(process.execPath,['tooling/vnext/authority.mjs',owned.receiptPath],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true}):spawnSync(process.execPath,['tooling/vnext/managed.mjs',command[0],owned.receiptPath],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});assert.equal(result.status,0);
  }
  run('--verify');const rowsChecked=assertOriginalRows(originalRows,rowHashes(owned.receipt,before.tables));assert.equal(digest(readFileSync(keysPath)),keyDigest);
  const evidence=owned.receiptPath+'.handover0199-to0200.json';writeFileSync(evidence,JSON.stringify({gate:'P3_05_HANDOVER_0199_TO_0200',status:'PASS',baseline:handoverPredecessorBaseline,oid:owned.receipt.oid,predecessorPrefix:199,currentPrefix:200,originalLedgerPreserved:true,originalRowsPreserved:true,originalKeysPreserved:true,proofInitiallyEmpty:true,oldCommittedReplay:true,oldPendingRequiresFreshProof:true,refreezeRequired:true,tablesChecked:before.tables.length-1,originalRowsChecked:rowsChecked,fixtureEvidence:owned.receiptPath+'.handover0199.json',verificationEvidence:owned.receiptPath+'.handover0200.json',beforeEvidence:beforePath,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',clinicalReadiness:'NOT_READY',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});
  console.log(JSON.stringify({gate:'P3_05_HANDOVER_0199_TO_0200',status:'PASS',evidence}));
 }catch(error){session??=error.ownerSession;throw error;}finally{
  // Every fixture/inspection process has closed its pools before this disposal.
  dropTemporary(owned.receipt);if(session)dropValidationOwnerSession(session);removeValidationKeys(owned.receipt);
 }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runUpgrade();
