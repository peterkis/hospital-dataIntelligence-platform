import {beforeAll,afterAll,test,expect} from 'vitest';
import {spawn} from 'node:child_process';
import type {Readable,Writable} from 'node:stream';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import staticPlugin from '@fastify/static';
import {workspaceManualFixture} from './workspace-manual-fixture.js';
import {peer,quote} from './lineage.mjs';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationWorkspace,openOrganization,type DraftSave,type DraftAction} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';

type Mode='NORMAL'|'LOST_RESPONSE'|'RESTORE_FAILURE'|'SWITCH_AFTER_FAILURE';
type Json=Record<string,any>;
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Awaited<ReturnType<typeof openCatalog>>,workspace:ReturnType<typeof openOrganizationWorkspace>,org:ReturnType<typeof openOrganization>,fixture:Awaited<ReturnType<typeof workspaceManualFixture>>,app:Awaited<ReturnType<typeof buildCatalogServer>>,base:string;
let fault:{mode:Mode;id:string;used:boolean;armed:boolean}|null=null;
const submittedRequests:DraftAction[]=[];

// Use the runner's headless browser over its private CDP pipe. No network debug
// port, runtime dependency, browser automation mock or production database.
function browser(){
 const profile=mkdtempSync(resolve(tmpdir(),'workspace-retry-'));
 const child=spawn(process.env['HDIP_REVIEW_BROWSER_EXECUTABLE']??'google-chrome',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--user-data-dir='+profile],{stdio:['ignore','ignore','pipe','pipe','pipe']});
 const input=child.stdio[3] as Writable,output=child.stdio[4] as Readable;
 let sequence=0,buffer='',stderr='';
 const pending=new Map<number,{resolve:(value:Json)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const fail=(error:Error)=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();};
 child.stderr!.setEncoding('utf8');child.stderr!.on('data',(part:string)=>{stderr=(stderr+part).slice(-4000);});
 child.on('error',fail);child.on('exit',()=>fail(new Error('BROWSER_EXITED '+stderr)));
 output.setEncoding('utf8');output.on('data',(part:string)=>{
  buffer+=part;let end:number;
  while((end=buffer.indexOf('\0'))>=0){const text=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!text)continue;
   const message=JSON.parse(text) as Json,item=pending.get(message['id']);if(!item)continue;
   pending.delete(message['id']);clearTimeout(item.timer);
   if(message['error'])item.reject(new Error(JSON.stringify(message['error'])));else item.resolve(message['result']??{});
  }
 });
 const call=(method:string,params:Json={},sessionId?:string):Promise<Json>=>new Promise((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('BROWSER_TIMEOUT '+method+' '+stderr));},45000);
  pending.set(id,{resolve,reject,timer});input.write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
 });
 return {call,async open(url:string){
  const target=await call('Target.createTarget',{url:'about:blank'}),session=await call('Target.attachToTarget',{targetId:target['targetId'],flatten:true});
  const sessionId=session['sessionId'] as string;await call('Page.enable',{},sessionId);await call('Page.navigate',{url},sessionId);
  for(let count=0;count<200;count++){
   const result=await call('Runtime.evaluate',{expression:'location.href === '+JSON.stringify(url)+' && document.readyState === "complete"',returnByValue:true},sessionId);
   if(result['result']?.value===true)return sessionId;await delay(25);
  }throw new Error('BROWSER_PAGE_NOT_READY');
 },async close(){
  fail(new Error('BROWSER_CLOSED'));child.kill('SIGTERM');
  for(let i=0;i<40&&child.exitCode===null&&child.signalCode===null;i++)await delay(25);
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await delay(100);}
  rmSync(profile,{recursive:true,force:true});
 }};
}

// Runs inside the real built React application. It never invokes component
// functions or replaces fetch, hooks, generated clients, routes or Owner logic.
async function exercise(input:{a:string;b:string;mode:Mode}){
 const wait=async<T>(read:()=>T,label:string):Promise<NonNullable<T>>=>{
  const until=Date.now()+15000;
  while(Date.now()<until){const value=read();if(value)return value as NonNullable<T>;await new Promise(r=>setTimeout(r,30));}
  throw new Error(label+' | '+location.href+' | '+document.body.innerText.slice(-1800));
 };
 const button=(label:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent===label&&!b.disabled);
 const submit=async()=>{(await wait(()=>button('提交申请'),'submit enabled')).click();};
 const select=async(id:string)=>{
  (await wait(()=>{const b=document.querySelector<HTMLButtonElement>('button[data-draft-id="'+id+'"]');return b&&!b.disabled?b:null;},'select '+id)).click();
  await wait(()=>new URL(location.href).searchParams.get('draft')===id&&button('提交申请'),'restored '+id);
 };
 const application=async()=>await wait(()=>new URL(location.href).searchParams.get('input')&&document.querySelector('.application-panel'),'application visible');
 await wait(()=>new URL(location.href).searchParams.get('draft')===input.a&&button('提交申请'),'initial A');
 await submit();
 if(input.mode!=='NORMAL'){
  const expected=input.mode==='LOST_RESPONSE'?'提交结果尚未确认':input.mode==='RESTORE_FAILURE'?'DEMO_RETRY_READ_FAILURE':'DEMO_RETRY_BEFORE_COMMIT';
  await wait(()=>document.body.innerText.includes(expected)&&button('提交申请'),'fault observed');
  if(input.mode==='SWITCH_AFTER_FAILURE'){
   await select(input.b);await submit();await application();const second=new URL(location.href).searchParams.get('input');
   await select(input.a);await submit();await application();
   return {first:new URL(location.href).searchParams.get('input'),second};
  }
  await submit();
 }
 await application();const first=new URL(location.href).searchParams.get('input');
 await select(input.b);await submit();await application();
 return {first,second:new URL(location.href).searchParams.get('input')};
}

beforeAll(async()=>{
 const dist=resolve('apps/admin-web/dist-vnext');if(!existsSync(resolve(dist,'vnext.html')))throw new Error('BUILT_WORKSPACE_REQUIRED');
 catalog=await openCatalog(connection,provider);workspace=openOrganizationWorkspace(connection,provider);org=openOrganization(connection,provider);
 fixture=await workspaceManualFixture(catalog);
 peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(fixture.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',{owner:org,actor:r=>actor(r.headers)},undefined,undefined,undefined,{owner:workspace,actor:r=>actor(r.headers)});
 app.addHook('preHandler',async(request,reply)=>{
  if(request.url==='/api/vnext/organization-workspace/drafts/submit'){
   const body=request.body as DraftAction;submittedRequests.push({...body});
   if(fault?.id===body.id&&fault.mode==='SWITCH_AFTER_FAILURE'&&!fault.used){fault.used=true;return reply.code(503).send({code:'DEMO_RETRY_BEFORE_COMMIT',message:'Injected before commit'});}
  }
  if(request.url==='/api/vnext/organization-workspace/drafts/read'&&fault?.mode==='RESTORE_FAILURE'&&fault.armed&&!fault.used&&(request.body as {id:string}).id===fault.id){fault.used=true;return reply.code(503).send({code:'DEMO_RETRY_READ_FAILURE',message:'Injected after successful submit'});}
 });
 app.addHook('onSend',async(request,reply,payload)=>{
  if(request.url==='/api/vnext/organization-workspace/drafts/submit'&&reply.statusCode===200&&fault?.id===(request.body as DraftAction).id){
   fault.armed=true;
   if(fault.mode==='LOST_RESPONSE'&&!fault.used){fault.used=true;reply.hijack();reply.raw.destroy();return;}
  }return payload;
 });
 await app.register(staticPlugin,{root:dist,prefix:'/admin/vnext/'});
 app.get('/admin/vnext/organizations',(_request,reply)=>reply.sendFile('vnext.html'));
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('HTTP_ADDRESS_REQUIRED');base='http://127.0.0.1:'+address.port;
});
afterAll(async()=>{await app?.close();await workspace?.close();await org?.close();await catalog?.close();});
async function save(name:string){
 const input:DraftSave={requestId:randomUUID(),domain:'ORG01',campus:'NORTH',transport:{contractId:fixture.contract.id,contractVersionId:fixture.contract.versionId},attachment:{filename:'DEMO.txt',bytesBase64:Buffer.from('DEMO_RETRY_EVIDENCE').toString('base64')},command:{action:'CREATE',source:{systemId:fixture.source.id,versionId:fixture.source.versionId,alias:'DEMO_RETRY',versionNo:1,recordLocator:name,recordedAt:'2026-01-01T00:00:00',recordStatus:'PUBLISHED',approvalRef:'DEMO_APPROVAL'},validFrom:'2026-01-01T00:00:00',validTo:null,facts:{legalName:name,entityNature:'DEMO',authority:null,legalAddress:null},identifiers:[{kind:'INSTITUTION_CODE',namespace:'DEMO_REGISTRY',value:randomUUID()}]}};
 return workspace.saveDraft('maker',input);
}
const counts=()=>JSON.parse(peer(receipt.name,"SELECT jsonb_build_array((SELECT count(*) FROM governance_catalog.import_job),(SELECT count(*) FROM governance_catalog.protected_artifact),(SELECT count(*) FROM organization_master.input),(SELECT count(*) FROM organization_master.workspace_draft_revision WHERE state='SUBMITTED'))")) as number[];
for(const mode of ['NORMAL','LOST_RESPONSE','RESTORE_FAILURE','SWITCH_AFTER_FAILURE'] as const)test('real React browser: '+mode+' never submits the previously selected draft',async()=>{
 const a=await save('DEMO '+mode+' A'),b=await save('DEMO '+mode+' B'),before=counts(),start=submittedRequests.length;
 fault={mode,id:a.id,used:false,armed:false};const chrome=browser();
 try{
  const session=await chrome.open(base+'/admin/vnext/organizations?as=maker&draft='+a.id);
  const result=await chrome.call('Runtime.evaluate',{expression:'('+exercise.toString()+')('+JSON.stringify({a:a.id,b:b.id,mode})+')',awaitPromise:true,returnByValue:true},session);
  expect(result['exceptionDetails'],JSON.stringify(result['exceptionDetails'])).toBeUndefined();
  const visible=result['result'].value as {first:string;second:string};expect(visible.first).not.toBe(visible.second);
  const attempts=submittedRequests.slice(start),expected=mode==='NORMAL'?[a.id,b.id]:mode==='SWITCH_AFTER_FAILURE'?[a.id,b.id,a.id]:[a.id,a.id,b.id];
  expect(attempts.map(r=>r.id)).toEqual(expected);expect(attempts.every(r=>r.expectedVersion==='1')).toBe(true);
  if(mode==='LOST_RESPONSE'||mode==='RESTORE_FAILURE')expect(attempts[1]).toEqual(attempts[0]);
  if(mode==='SWITCH_AFTER_FAILURE')expect(attempts[2]!.requestId).not.toBe(attempts[0]!.requestId);
  expect(counts()).toEqual(before.map(n=>n+2));
  for(const [saved,name,inputId] of [[a,'A',visible.first],[b,'B',visible.second]] as const){
   const read=await workspace.readDraft('maker',saved.id);expect(read.state).toBe('SUBMITTED');expect(read.submission?.inputId).toBe(inputId);
   const command=await org.readRestrictedInput('maker',inputId);expect(command.command).toMatchObject({facts:{legalName:'DEMO '+mode+' '+name}});
   const finalRequest=attempts.filter(r=>r.id===saved.id).at(-1)!;expect(await workspace.submitDraft('maker',finalRequest)).toEqual(read.submission);
   await expect(workspace.readDraft('reviewer',saved.id)).rejects.toThrow('ACCESS_DENIED');
   const requestId=randomUUID(),candidate=await org.plan('maker',{inputId,requestId});await org.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await org.approveApplyUnit('reviewer',candidate);
   const applied=await org.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(applied.status).toBe('COMMITTED');expect(await org.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).toEqual(applied);
  }
  expect(counts()).toEqual(before.map(n=>n+2));
 }finally{fault=null;await chrome.close();}
});
