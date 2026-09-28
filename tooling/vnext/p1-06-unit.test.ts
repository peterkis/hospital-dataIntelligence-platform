import {test,expect} from 'vitest';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {readAllWorkspacePages} from '../../apps/admin-web/src/vnext/workspace-pagination.js';
import {isManualWorkspaceContract} from '../../apps/admin-web/src/vnext/workspace-transport.js';
test('workspace HTTP fails closed without an Owner even for a valid incomplete draft',async()=>{
 const app=await buildCatalogServer();try{
  const response=await app.inject({method:'POST',url:'/api/vnext/organization-workspace/drafts/save',payload:{requestId:'00000000-0000-0000-0000-000000000001',domain:'ORG01',campus:'NORTH',command:{action:'CREATE',facts:{legalName:'DEMO incomplete'}}}});
  expect(response.statusCode).toBe(503);expect(response.json().code).toBe('BLOCKED_DEPENDENCY');expect(response.headers['cache-control']).toBe('no-store');
 }finally{await app.close();}
});
test('workspace HTTP rejects client identity, arbitrary SQL and unknown draft fields before dispatch',async()=>{
 const app=await buildCatalogServer();try{
  const base={requestId:'00000000-0000-0000-0000-000000000001',domain:'ORG01',campus:'NORTH',command:{action:'CREATE'}};
  for(const payload of [{...base,actor:'reviewer'},{...base,recordedAt:'2026-01-01T00:00:00'},{...base,command:{...base.command,sql:'SELECT 1'}}]){
   const response=await app.inject({method:'POST',url:'/api/vnext/organization-workspace/drafts/save',payload});expect(response.statusCode).toBe(400);
  }
 }finally{await app.close();}
});
test('a one MiB editing payload reaches the capability Owner boundary without a smaller transport limit',async()=>{
 const app=await buildCatalogServer();try{
  const response=await app.inject({method:'POST',url:'/api/vnext/organization-workspace/capabilities',payload:{domain:'BUNDLE',campus:'NORTH',metadata:{},bytesBase64:Buffer.alloc(1048576).toString('base64')}});
  expect(response.statusCode).toBe(503);expect(response.json().code).toBe('BLOCKED_DEPENDENCY');
 }finally{await app.close();}
});

test('workspace pagination follows the last visible id until a short page is returned',async()=>{
 const calls:Array<string|undefined>=[],items=Array.from({length:203},(_,index)=>({id:String(index+1).padStart(4,'0')}));
 const result=await readAllWorkspacePages(async after=>{
  calls.push(after);
  const start=after?items.findIndex(item=>item.id===after)+1:0;
  return {data:items.slice(start,start+100)};
 });
 expect(result.error).toBeUndefined();
 expect(result.data).toEqual(items);
 expect(calls).toEqual([undefined,'0100','0200']);
});
test('workspace pagination fails closed when a full page does not advance its cursor',async()=>{
 const page=Array.from({length:100},(_,index)=>({id:String(index+1).padStart(4,'0')}));
 let calls=0;
 const result=await readAllWorkspacePages(async()=>{calls++;return {data:page};});
 expect(result.data).toBeUndefined();
 expect(result.error).toBeInstanceOf(Error);
 expect(calls).toBe(2);
});
for(const domain of ['ORG01','ORG02','ORG03'])test(domain+' selector permits only its published CORE manual template',()=>{
 const valid={dataset:domain,status:'PUBLISHED',profile:'CORE',definition:{templateVersion:domain+'_MANUAL_CORE_V1'}};
 expect(isManualWorkspaceContract(valid,domain)).toBe(true);
 for(const dataset of ['ORG01','ORG02','ORG03','GOV01'].filter(d=>d!==domain))expect(isManualWorkspaceContract({...valid,dataset},domain)).toBe(false);
 for(const status of ['DRAFT','APPROVED','RETIRED'])expect(isManualWorkspaceContract({...valid,status},domain)).toBe(false);
 expect(isManualWorkspaceContract({...valid,profile:'FULL'},domain)).toBe(false);
 for(const templateVersion of [domain+'_BUNDLE_CORE_V1',domain+'_OTHER_CORE_V1','ORG99_MANUAL_CORE_V1'])expect(isManualWorkspaceContract({...valid,definition:{templateVersion}},domain)).toBe(false);
 expect(isManualWorkspaceContract(valid,'BUNDLE')).toBe(false);
});
