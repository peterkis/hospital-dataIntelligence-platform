import {beforeAll,afterAll,test,expect} from 'vitest';
import {spawn} from 'node:child_process';
import type {Readable,Writable} from 'node:stream';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import staticPlugin from '@fastify/static';
import {organizationBundleFixture} from './organization-bundle-fixture.js';
import {peer} from './lineage.mjs';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationWorkspace} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
type Mode='NORTH_TO_SOUTH'|'SOUTH_TO_NORTH'|'NEWER_FILE_WINS'|'CONTRACT_CHANGED'|'REPLACE_DURING_PREVIEW';
type Json=Record<string,any>;
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Awaited<ReturnType<typeof openCatalog>>,workspace:ReturnType<typeof openOrganizationWorkspace>,fixture:Awaited<ReturnType<typeof organizationBundleFixture>>,app:Awaited<ReturnType<typeof buildCatalogServer>>,base:string;
let previewGate:{started:boolean;pending:Promise<void>;release:()=>void}|null=null;
// Private CDP pipe; Chrome executes the built application and real HTTP clients.
function browser(){
 const profile=mkdtempSync(resolve(tmpdir(),'workspace-upload-'));
 const child=spawn(process.env['HDIP_REVIEW_BROWSER_EXECUTABLE']??'google-chrome',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--user-data-dir='+profile],{stdio:['ignore','ignore','pipe','pipe','pipe']});
 const input=child.stdio[3] as Writable,output=child.stdio[4] as Readable;
 let sequence=0,buffer='',stderr='',completedPreviews=0;
 const previewRequests=new Set<string>();
 const pending=new Map<number,{resolve:(value:Json)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const fail=(error:Error)=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();};
 child.stderr!.setEncoding('utf8');child.stderr!.on('data',(part:string)=>{stderr=(stderr+part).slice(-4000);});child.on('error',fail);child.on('exit',()=>fail(new Error('BROWSER_EXITED '+stderr)));
 output.setEncoding('utf8');output.on('data',(part:string)=>{
  buffer+=part;let end:number;
  while((end=buffer.indexOf('\0'))>=0){
   const text=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!text)continue;const message=JSON.parse(text) as Json;
   if(message['method']==='Network.responseReceived'&&message['params'].response.url.endsWith('/workbook/preview'))previewRequests.add(message['params'].requestId);
   if(message['method']==='Network.loadingFinished'&&previewRequests.delete(message['params'].requestId))completedPreviews++;
   const item=pending.get(message['id']);if(!item)continue;pending.delete(message['id']);clearTimeout(item.timer);
   if(message['error'])item.reject(new Error(JSON.stringify(message['error'])));else item.resolve(message['result']??{});
  }
 });
 const call=(method:string,params:Json={},sessionId?:string):Promise<Json>=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('BROWSER_TIMEOUT '+method+' '+stderr));},45000);pending.set(id,{resolve,reject,timer});input.write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});
 return {call,completedPreviews:()=>completedPreviews,async open(url:string){const t=await call('Target.createTarget',{url:'about:blank'}),s=await call('Target.attachToTarget',{targetId:t['targetId'],flatten:true}),id=s['sessionId'] as string;await call('Page.enable',{},id);await call('Network.enable',{},id);await call('Page.navigate',{url},id);for(let n=0;n<200;n++){const r=await call('Runtime.evaluate',{expression:'location.href === '+JSON.stringify(url)+' && document.readyState === "complete"',returnByValue:true},id);if(r['result']?.value)return id;await delay(25);}throw new Error('PAGE_NOT_READY');},async close(){fail(new Error('BROWSER_CLOSED'));child.kill('SIGTERM');for(let i=0;i<40&&child.exitCode===null&&child.signalCode===null;i++)await delay(25);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await delay(100);}rmSync(profile,{recursive:true,force:true});}};
}

// Only file decoding and one preview response can be held. React, fetch,
// generated clients, permissions, serialization and storage are not substituted.
async function uploadRace(input:{mode:Mode;bytes:string}){
 const wait=async<T>(read:()=>T,label:string):Promise<NonNullable<T>>=>{const end=Date.now()+15000;while(Date.now()<end){const r=read();if(r)return r as NonNullable<T>;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error(label+' | '+document.body.innerText.slice(-2200));};
 const frames=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
 const field=(label:string)=>Array.from(document.querySelectorAll('label')).find(l=>l.textContent?.startsWith(label))?.querySelector('select') as HTMLSelectElement|undefined;
 const button=(label:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent===label&&!b.disabled);
 const raw=Uint8Array.from(atob(input.bytes),c=>c.charCodeAt(0));
 const fileInput=await wait(()=>{const f=document.querySelector<HTMLInputElement>('input[type="file"][accept=".xlsx"]');return f&&!f.disabled?f:null;},'workbook input');
 const delayed=(name:string,bytes:Uint8Array)=>{
  let release!:()=>void,started=false,finished=false;const file=new File([bytes as BlobPart],name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  Object.defineProperty(file,'arrayBuffer',{value:()=>{started=true;return new Promise<ArrayBuffer>(resolve=>{release=()=>{finished=true;resolve(bytes.slice().buffer as ArrayBuffer);};});}});
  const transfer=new DataTransfer();transfer.items.add(file);fileInput.files=transfer.files;fileInput.dispatchEvent(new Event('change',{bubbles:true}));return {release:()=>release(),started:()=>started,finished:()=>finished};
 };
 const first=delayed('first.xlsx',input.mode==='NEWER_FILE_WINS'?new Uint8Array([1,2,3]):raw);
 await wait(first.started,'file read pending');
 if(input.mode==='REPLACE_DURING_PREVIEW'){
  Reflect.set(window,'__releaseWorkbookRead',first.release);
  (await wait(()=>button('读取受限原文件预览'),'old preview enabled')).click();
  await wait(first.finished,'file completed while preview held');
  await wait(()=>document.body.innerText.includes('原文件已替换')&&button('读取受限原文件预览'),'replacement releases obsolete preview busy state');
 }else if(input.mode==='CONTRACT_CHANGED'){
  const select=field('ORG01 文件 CORE 版本')!;select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>select.value==='','binding removed');first.release();await frames();
 }else{
  const next=input.mode==='SOUTH_TO_NORTH'?'NORTH':'SOUTH',scope=field('接收治理范围')!;
  if(scope.disabled)throw new Error('SCOPE_EDIT_UNEXPECTEDLY_DISABLED');scope.value=next;scope.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>field('接收治理范围')?.value===next,'scope changed while reading');
  if(input.mode==='NEWER_FILE_WINS'){const second=delayed('second.xlsx',raw);await wait(second.started,'newer file pending');second.release();await wait(()=>document.body.innerText.includes('原文件已替换'),'newer file completed');first.release();await frames();}
  else{first.release();await wait(()=>document.body.innerText.includes('原文件已替换'),'upload completed');}
  if(field('接收治理范围')?.value!==next)throw new Error('UPLOAD_REVERTED_SCOPE');
 }
 (await wait(()=>button('保存草稿'),'save enabled')).click();await wait(()=>document.body.innerText.includes('草稿已保存到服务器')&&document.querySelector('.stage-label')?.textContent?.includes('v2'),'saved v2');
 return {scope:field('接收治理范围')?.value,version:document.querySelector('.stage-label')?.textContent};
}
beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);workspace=openOrganizationWorkspace(connection,provider);fixture=await organizationBundleFixture(receipt,connection,provider,catalog);
 // Both scopes are explicitly authorized for the browser races. The last HTTP
 // case removes SOUTH WRITE and confirms that saving cannot bypass policy.
 peer(receipt.name,"INSERT INTO organization_master.access SELECT 'maker','00000000-0000-0000-0000-000000000000'::uuid,'SOUTH',p FROM unnest(ARRAY['READ','WRITE','READ_RESTRICTED']) p ON CONFLICT DO NOTHING;INSERT INTO vnext_control.protected_grant SELECT actor_code,dataset_id,'SOUTH',purpose,permission FROM vnext_control.protected_grant WHERE actor_code='maker' AND campus='NORTH' ON CONFLICT DO NOTHING;");
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,{owner:workspace,actor:r=>actor(r.headers)});
 app.addHook('onSend',async(request,_reply,payload)=>{const gate=previewGate;if(gate&&request.url==='/api/vnext/organization-workspace/workbook/preview'){gate.started=true;await gate.pending;}return payload;});
 const dist=resolve('apps/admin-web/dist-vnext');await app.register(staticPlugin,{root:dist,prefix:'/admin/vnext/'});app.get('/admin/vnext/organizations',(_r,reply)=>reply.sendFile('vnext.html'));
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('HTTP_ADDRESS_REQUIRED');base='http://127.0.0.1:'+address.port;
});
afterAll(async()=>{previewGate?.release();await app?.close();await workspace?.close();await fixture?.close();await catalog?.close();});
for(const mode of ['NORTH_TO_SOUTH','SOUTH_TO_NORTH','NEWER_FILE_WINS','CONTRACT_CHANGED','REPLACE_DURING_PREVIEW'] as const)test('real workbook upload: '+mode+' preserves latest editing intent',async()=>{
 const campus=mode==='SOUTH_TO_NORTH'?'SOUTH':'NORTH',bytes=fixture.workbook().toString('base64');
 const metadata={...fixture.input,campus,retentionSeconds:1800};
 let oldBytes:string|undefined;
 if(mode==='REPLACE_DURING_PREVIEW'){
  const row=fixture.values['ORG01']![0]!,name=row['legal_name']!;row['legal_name']='DEMO superseded upload';oldBytes=fixture.workbook().toString('base64');row['legal_name']=name;
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});previewGate={started:false,pending,release};
 }
 const saved=await workspace.saveDraft('maker',{domain:'BUNDLE',campus,requestId:randomUUID(),metadata,...(oldBytes?{bytesBase64:oldBytes}:{})});
 const chrome=browser();
 try{
  const session=await chrome.open(base+'/admin/vnext/organizations?as=maker&draft='+saved.id);
  const exercise=chrome.call('Runtime.evaluate',{expression:'('+uploadRace.toString()+')('+JSON.stringify({mode,bytes})+')',awaitPromise:true,returnByValue:true},session);void exercise.catch(()=>{});
  if(mode==='REPLACE_DURING_PREVIEW'){
   await expect.poll(()=>previewGate?.started,{timeout:15000}).toBe(true);
   const release=await chrome.call('Runtime.evaluate',{expression:'Reflect.get(window,"__releaseWorkbookRead")()',returnByValue:true},session);expect(release['exceptionDetails']).toBeUndefined();
  }
  const r=await exercise;expect(r['exceptionDetails'],JSON.stringify(r['exceptionDetails'])).toBeUndefined();
  if(mode==='REPLACE_DURING_PREVIEW'){
   previewGate!.release();await expect.poll(chrome.completedPreviews,{timeout:10000}).toBe(1);
   const stale=await chrome.call('Runtime.evaluate',{expression:'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(document.querySelectorAll("article.history").length===0 && Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="读取受限原文件预览"&&!b.disabled)))))',awaitPromise:true,returnByValue:true},session);
   expect(stale['exceptionDetails']).toBeUndefined();expect(stale['result'].value).toBe(true);
  }
  const restored=await workspace.readDraft('maker',saved.id);expect(restored.version).toBe('2');expect(restored.content.domain).toBe('BUNDLE');if(restored.content.domain!=='BUNDLE')throw new Error('BUNDLE_REQUIRED');
  const expected=mode==='NORTH_TO_SOUTH'||mode==='NEWER_FILE_WINS'?'SOUTH':'NORTH';expect(restored.content.campus).toBe(expected);expect(restored.content.metadata['campus']).toBe(expected);expect(restored.content.metadata['retentionSeconds']).toBe(1800);
  if(mode==='CONTRACT_CHANGED'){expect(restored.content.bytesBase64).toBeUndefined();expect(restored.content.metadata['contracts']).toHaveLength(2);}
  else{expect(restored.content.bytesBase64).toBe(bytes);expect(restored.content.metadata['manifest']).toEqual({policy:'ORG_BUNDLE_V1'});expect(restored.content.metadata['contracts']).toEqual(metadata.contracts);expect(await workspace.previewWorkbook('maker',restored.content)).toMatchObject({structuralStatus:'PARSED'});}
  await expect(workspace.readDraft('reviewer',saved.id)).rejects.toThrow('ACCESS_DENIED');
  console.log(JSON.stringify({check:'WORKBOOK_UPLOAD_RACE',mode,campus:restored.content.campus,version:restored.version,bytesMatch:restored.content.bytesBase64===bytes}));
 }finally{previewGate?.release();previewGate=null;await chrome.close();}
});
test('real HTTP refuses the completed workbook in a receiving scope whose WRITE was revoked',async()=>{
 const metadata={...fixture.input,manifest:{policy:'ORG_BUNDLE_V1'}},saved=await workspace.saveDraft('maker',{domain:'BUNDLE',campus:'NORTH',requestId:randomUUID(),metadata});
 const original=await workspace.readDraft('maker',saved.id),rows=peer(receipt.name,'SELECT count(*) FROM organization_master.workspace_draft_revision');
 peer(receipt.name,"DELETE FROM organization_master.access WHERE actor='maker' AND subject_id='00000000-0000-0000-000000000000'::uuid AND campus='SOUTH' AND permission='WRITE'");
 try{
  const payload={...original.content,id:saved.id,expectedVersion:saved.version,requestId:randomUUID(),campus:'SOUTH',metadata:{...metadata,campus:'SOUTH'},bytesBase64:fixture.workbook().toString('base64')};
  const response=await fetch(base+'/api/vnext/organization-workspace/drafts/save',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify(payload)});
  expect(response.status).toBe(403);expect((await response.json() as {code:string}).code).toBe('ACCESS_DENIED');expect(await workspace.readDraft('maker',saved.id)).toEqual(original);expect(peer(receipt.name,'SELECT count(*) FROM organization_master.workspace_draft_revision')).toBe(rows);
 }finally{peer(receipt.name,"INSERT INTO organization_master.access VALUES('maker','00000000-0000-0000-0000-000000000000'::uuid,'SOUTH','WRITE') ON CONFLICT DO NOTHING");}
});
