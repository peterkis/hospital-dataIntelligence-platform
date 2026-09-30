import {beforeAll,expect,it,vi} from 'vitest';

// Redirect only filesystem configuration. Startup, Owners, HTTP and PostgreSQL
// are real. The installed persistent receipt and secrets are never replaced.
vi.mock('node:fs',async importOriginal=>{
 const fs=await importOriginal<typeof import('node:fs')>();
 const {resolve,sep}=await import('node:path');
 const fixture=process.env['VNEXT_PERSISTENT_FIXTURE_DIR'];
 if(!fixture)throw new Error('PERSISTENT_FIXTURE_REQUIRED');
 const map=new Map([
  [resolve('.runtime/vnext/creation.json'),resolve(fixture,'creation.json')],
  [resolve('.runtime/vnext/p0-09/owner-service.json'),resolve(fixture,'owner-service.json')],
  [resolve('.runtime/vnext/p1-01/keys.secret.json'),resolve(fixture,'keys.secret.json')],
 ]);
 const evidence=resolve('.runtime/vnext/p1-06');
 const redirect=(path:unknown)=>{
  if(typeof path!=='string')return path;
  const absolute=resolve(path),mapped=map.get(absolute);
  if(mapped)return mapped;
  if(absolute===evidence||absolute.startsWith(evidence+sep))return resolve(fixture,'evidence',absolute.slice(evidence.length+1));
  return path;
 };
 return {...fs,...Object.fromEntries(['readFileSync','writeFileSync','existsSync','lstatSync','mkdirSync'].map(name=>[name,(path:unknown,...args:unknown[])=>{
  if(name==='readFileSync'&&typeof path==='string'&&resolve(path)===resolve('.runtime/vnext/p0-09/owner-service.secret.json')){
   const secret=JSON.stringify({password:new URL(process.env['VNEXT_VALIDATION_OWNER_URL']!).password});
   return args[0]?secret:Buffer.from(secret);
  }
  return Reflect.apply(Reflect.get(fs,name),fs,[redirect(path),...args]);
 }]))};
});

// The real type-verification subprocess must read the same isolated receipt.
vi.mock('node:child_process',async importOriginal=>{
 const child=await importOriginal<typeof import('node:child_process')>();
 const {resolve}=await import('node:path');
 return {...child,spawnSync:(command:unknown,...args:unknown[])=>{
  const parameters=args[0];
  if(Array.isArray(parameters)&&parameters[0]==='tooling/vnext/managed.mjs'&&parameters[1]==='types-verify'&&parameters[2]==='.runtime/vnext/creation.json'){
   args[0]=[...parameters.slice(0,2),resolve(process.env['VNEXT_PERSISTENT_FIXTURE_DIR']!,'creation.json'),...parameters.slice(3)];
  }
  return Reflect.apply(child.spawnSync,child,[command,...args]);
 }};
});

import './connection-guard.mjs';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {startWorkbench} from './workbench-runtime.mjs';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {organizationKeys} from './organization-keys.mjs';
import {peer,quote} from './lineage.mjs';
import {openHierarchy} from '../../apps/governance-api/src/modules/department-master/index.js';
import {planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {createHierarchyClient} from '../../packages/generated-api-client/src/index.js';

const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')) as {name:string};
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!;
const role=new URL(connection).username;
let viewId:string;
beforeAll(async()=>{
 const provider=organizationKeys(receipt,{create:true});
 peer(receipt.name,`INSERT INTO vnext_control.department_write_authority(key_hex) VALUES(${quote(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}))});`,{sensitive:true});
 peer(receipt.name,"INSERT INTO department_master.access(actor,scope,permission) VALUES('maker','HOSPITAL','WRITE') ON CONFLICT DO NOTHING;");
 const hierarchy=openHierarchy(connection,provider);
 try {viewId=(await hierarchy.createHierarchyView('maker',{requestId:randomUUID(),sourceClientKey:'PROVISIONING_VIEW',viewCode:'PROVISIONING_VIEW',viewName:'Provisioning regression',viewType:'ADMINISTRATIVE',purpose:'Persistent startup regression',aggregationRule:'NONE',ownerDepartmentId:null,sourceSystemId:randomUUID(),sourceRecordId:'SYNTHETIC:1',sourceVersion:'1',validFrom:'2026-09-01T00:00:00',validTo:null,recordedAt:'2026-09-01T00:00:00',approvalRef:'SYNTHETIC'})).viewId;}
 finally{await hierarchy.close();}
});

it('persistent startup rejects a missing hierarchy EXECUTE grant before reporting ready',async()=>{
 peer(receipt.name,`REVOKE EXECUTE ON FUNCTION department_master.hierarchy_read(text,text,jsonb) FROM ${role};`);
 const observations=[];
 try {
  for(let attempt=0;attempt<2;attempt++){
   let runtime:Awaited<ReturnType<typeof startWorkbench>>|undefined;
   try {
    runtime=await startWorkbench({persistent:true});
    const response=await createHierarchyClient(runtime.url,'maker').read({viewId});
    observations.push({started:true,httpStatus:response.response.status});
   }catch(error){observations.push({started:false,error:error instanceof Error?error.message:'UNKNOWN'});}
   finally{await runtime?.close();}
  }
  peer(receipt.name,`GRANT EXECUTE ON FUNCTION department_master.hierarchy_read(text,text,jsonb) TO ${role};`);
  const restored=await startWorkbench({persistent:true});
  try{expect((await createHierarchyClient(restored.url,'maker').read({viewId})).response.status).toBe(200);}
  finally{await restored.close();}
  expect(observations).toEqual([{started:false,error:'HIERARCHY_PROVISIONING_REQUIRED'},{started:false,error:'HIERARCHY_PROVISIONING_REQUIRED'}]);
 }finally{peer(receipt.name,`GRANT EXECUTE ON FUNCTION department_master.hierarchy_read(text,text,jsonb) TO ${role};`);}
});

it('reuse-existing verification rejects missing hierarchy execution capability without repairing it',async()=>{
 peer(receipt.name,`REVOKE EXECUTE ON FUNCTION department_master.hierarchy_read(text,text,jsonb) FROM ${role};`);
 try {
  const observations=[];
  for(let attempt=0;attempt<2;attempt++){
   try {await prepareWorkspaceDeployment({reuseExisting:true});observations.push('VERIFIED');}
   catch(error){observations.push(error instanceof Error?error.message:'UNKNOWN');}
  }
  // Repeated rejection also proves verification did not silently restore the grant.
  expect(observations).toEqual(['HIERARCHY_PROVISIONING_REQUIRED','HIERARCHY_PROVISIONING_REQUIRED']);
 }finally{peer(receipt.name,`GRANT EXECUTE ON FUNCTION department_master.hierarchy_read(text,text,jsonb) TO ${role};`);}
 const verified=await prepareWorkspaceDeployment({reuseExisting:true});
 await verified.complete();
 expect(JSON.parse(readFileSync(verified.evidence+'.migration.json','utf8'))).toMatchObject({status:'PASS',mode:'VERIFY_EXISTING'});
},120000);
