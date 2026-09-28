import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import staticPlugin from '@fastify/static';
import {reviewBrowser} from './review-browser.js';
import {organizationBundleFixture} from './organization-bundle-fixture.js';
import {openCatalog,LocalSyntheticKeyProvider,type OwnerFact} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationWorkspace,type DraftContent,type OrganizationCommand} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Awaited<ReturnType<typeof openCatalog>>,workspace:ReturnType<typeof openOrganizationWorkspace>,f:Awaited<ReturnType<typeof organizationBundleFixture>>,app:Awaited<ReturnType<typeof buildCatalogServer>>,base:string;
let subject:OwnerFact,node:OwnerFact;
let gate:{started:boolean;fail:boolean;pending:Promise<void>;release:()=>void}|null=null;
const requests:Array<{id:string;fromVersion:string;toVersion:string}>=[];
type Chrome=ReturnType<typeof reviewBrowser>;
async function evaluate(chrome:Chrome,session:string,expression:string){
 const result=await chrome.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);
 expect(result['exceptionDetails'],JSON.stringify(result['exceptionDetails'])).toBeUndefined();return result['result'].value;
}
// This function runs in the built application's browser, not a component mock.
async function chooseEntity(input:{kind:'ORGANIZATION'|'CAMPUS';id:string}){
 const wait=async<T>(read:()=>T,label:string):Promise<NonNullable<T>>=>{const until=Date.now()+15000;while(Date.now()<until){const v=read();if(v)return v as NonNullable<T>;await new Promise(r=>setTimeout(r,25));}throw new Error(label+' | '+document.body.innerText.slice(-2000));};
 const tab=await wait(()=>Array.from(document.querySelectorAll<HTMLButtonElement>('.workspace-tabs button')).find(b=>b.textContent===(input.kind==='CAMPUS'?'院区':'机构主体')&&!b.disabled),'tab');tab.click();
 const row=await wait(()=>Array.from(document.querySelectorAll<HTMLButtonElement>('.entity-workspace .draft-item')).find(b=>b.textContent?.includes(input.id.slice(-8))&&!b.disabled),'row');row.click();
 await wait(()=>document.querySelectorAll('.version-comparison select option').length===8,'three versions');
}
function selectPair(from:string,to:string){
 const controls=document.querySelectorAll<HTMLSelectElement>('.version-comparison select');
 for(const [select,value] of [[controls[0]!,from],[controls[1]!,to]] as const){select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}
}
async function clickComparison(){
 for(let n=0;n<400;n++){const button=document.querySelector<HTMLButtonElement>('.version-comparison button');if(button&&!button.disabled){button.click();return;}await new Promise(r=>setTimeout(r,25));}throw new Error('COMPARE_DISABLED');
}
async function settle(){await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));return document.querySelector('.version-comparison')?.textContent??'';}
beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);workspace=openOrganizationWorkspace(connection,provider);f=await organizationBundleFixture(receipt,connection,provider,catalog);
 subject=await f.x.createSubject();node=await f.x.createCampus('DEMO comparison one');
 for(const label of ['two','three']){
  const revision=await workspace.prepareRevision('maker',{kind:'ORGANIZATION',id:subject.id,version:subject.version});if(revision.domain!=='ORG01')throw new Error('ORG01_REQUIRED');
  subject=await f.x.orgApply({...revision.command,validFrom:f.x.common.validFrom,facts:{...(revision.command['facts'] as Record<string,unknown>),legalName:'DEMO comparison '+label}} as OrganizationCommand);
  const old=await f.x.campus.references.read('maker',{id:node.id});
  node=await f.x.campusApply({...f.x.common,action:'REVISE',target:{owner:'organization-master/campus',id:node.id,expectedVersion:old.head},evidence:f.x.artifact.artifactId,sourceOperationStatus:'PLANNING',facts:{...old.facts!,campusName:'DEMO comparison '+label}});
 }
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',{owner:f.x.org,actor:r=>actor(r.headers)},{owner:f.x.campus,actor:r=>actor(r.headers)},undefined,undefined,{owner:workspace,actor:r=>actor(r.headers)});
 app.addHook('onSend',async(request,reply,payload)=>{
  if(request.url.endsWith('/diff')){
   const body=request.body as {id:string;fromVersion:string;toVersion:string};requests.push({...body});const current=gate;
   if(current&&body.fromVersion==='1'&&body.toVersion==='2'){current.started=true;await current.pending;if(current.fail){reply.code(503);return JSON.stringify({code:'BLOCKED_DEPENDENCY',message:'DEMO_OLD_COMPARISON_ERROR'});}}
  }return payload;
 });
 await app.register(staticPlugin,{root:resolve('apps/admin-web/dist-vnext'),prefix:'/admin/vnext/'});app.get('/admin/vnext/organizations',(_r,reply)=>reply.sendFile('vnext.html'));
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('HTTP_ADDRESS_REQUIRED');base='http://127.0.0.1:'+address.port;
});
afterAll(async()=>{gate?.release();await app?.close();await workspace?.close();await f?.close();await catalog?.close();});
for(const kind of ['ORGANIZATION','CAMPUS'] as const)for(const mode of ['LATE_SUCCESS','LATE_ERROR','SELECTION_ONLY'] as const)test(`${kind} comparison ignores ${mode} from an obsolete version pair`,async()=>{
 const id=kind==='ORGANIZATION'?subject.id:node.id,chrome=reviewBrowser(),offset=requests.length;
 let release!:()=>void;gate={started:false,fail:mode==='LATE_ERROR',pending:new Promise<void>(r=>{release=r;}),release:()=>release()};
 try{
  const session=await chrome.open(base+'/admin/vnext/organizations?as=maker');
  await evaluate(chrome,session,'('+chooseEntity.toString()+')('+JSON.stringify({kind,id})+')');
  await evaluate(chrome,session,'('+selectPair.toString()+')("1","2")');await evaluate(chrome,session,'('+clickComparison.toString()+')()');
  await expect.poll(()=>gate?.started,{timeout:15000}).toBe(true);
  await evaluate(chrome,session,'('+selectPair.toString()+')("2","3")');
  if(mode!=='SELECTION_ONLY'){
   await evaluate(chrome,session,'('+clickComparison.toString()+')()');await expect.poll(chrome.completedDiffs,{timeout:15000}).toBe(1);
   const newer=await evaluate(chrome,session,'('+settle.toString()+')()');expect(newer).toContain('2 → 3');expect(newer).toContain('DEMO comparison three');
  }
  gate.release();await expect.poll(chrome.completedDiffs,{timeout:15000}).toBe(mode==='SELECTION_ONLY'?1:2);
  const text=await evaluate(chrome,session,'('+settle.toString()+')()');expect(text).not.toContain('1 → 2');expect(text).not.toContain('DEMO_OLD_COMPARISON_ERROR');
  if(mode==='SELECTION_ONLY')expect(await evaluate(chrome,session,'document.querySelector("[data-comparison-result]")===null')).toBe(true);else expect(text).toContain('2 → 3');
  expect(requests.slice(offset).map(r=>[r.id,r.fromVersion,r.toVersion])).toEqual(mode==='SELECTION_ONLY'?[[id,'1','2']]:[[id,'1','2'],[id,'2','3']]);
 }finally{gate?.release();gate=null;await chrome.close();}
});

async function inspectScopes(input:{ids:string[];versions:string[];versionIds:string[];append:boolean}){
 const wait=async<T>(read:()=>T,label:string):Promise<NonNullable<T>>=>{const until=Date.now()+15000;while(Date.now()<until){const v=read();if(v)return v as NonNullable<T>;await new Promise(r=>setTimeout(r,25));}throw new Error(label+' | '+document.body.innerText.slice(-1800));};
 const button=(label:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent===label&&!b.disabled);
 (await wait(()=>button('读取受限原文件预览'),'preview')).click();
 await wait(()=>document.querySelectorAll('[data-scope-license="EXACT"]').length===input.ids.length,'scope summaries');
 const summaries=Array.from(document.querySelectorAll<HTMLElement>('[data-scope-license="EXACT"]')).map(el=>el.innerText);
 input.ids.forEach((id,i)=>{if(!summaries[i]!.includes(id)||!summaries[i]!.includes('v'+input.versions[i])||!summaries[i]!.includes(input.versionIds[i]!))throw new Error('WRONG_EXACT_SCOPE '+i);});
 if(!document.querySelector('[data-scope-license="ROW_LICENSE"]')?.textContent?.includes('DEMO_SUBJECT'))throw new Error('BATCH_LICENSE_NOT_DISTINGUISHED');
 if(input.append){
  const row=Array.from(document.querySelectorAll('article.history')).find(el=>el.querySelector('h4')?.textContent==='ORG03 · 物理行 2')!;
  const radio=await wait(()=>Array.from(row.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find(el=>el.parentElement?.textContent?.includes('v1')),'license option');radio.click();
  await wait(()=>radio.checked,'pending selection visible');
  if(document.querySelectorAll('[data-scope-license="EXACT"]').length!==input.ids.length)throw new Error('SELECTION_SILENTLY_APPENDED');
  (await wait(()=>Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent==='追加所选证照范围'&&!b.disabled),'explicit add')).click();
  await wait(()=>document.querySelectorAll('[data-scope-license="EXACT"]').length===input.ids.length+1,'new card');
  (await wait(()=>button('保存草稿'),'save')).click();await wait(()=>document.body.innerText.includes('草稿已保存到服务器'),'saved');
 }
 return summaries;
}
test('restored ORG03 scope cards retain exact license versions and additions require explicit confirmation',async()=>{
 const license=await f.x.addLicense(subject),first=(await f.x.org.historyDetails('maker',subject.id)).licenses.find(l=>l.id===license.id)!;
 const revision=await workspace.prepareRevision('maker',{kind:'LICENSE',id:first.id,version:first.version});if(revision.domain!=='ORG01')throw new Error('ORG01_REQUIRED');
 await f.x.orgApply({...revision.command,validFrom:f.x.common.validFrom} as OrganizationCommand);
 const second=(await f.x.org.historyDetails('maker',subject.id)).licenses.find(l=>l.id===license.id&&l.version==='2')!;
 const refs=[first,second].map(l=>({owner:'organization-master/license' as const,id:l.id,version:l.version,versionId:l.versionId}));
 const metadata=structuredClone(f.input),row=metadata.manifest.rows.find(r=>r.dataset==='ORG03')!;
 if(row.dataset!=='ORG03')throw new Error('ORG03_REQUIRED');
 row.subject={kind:'PLATFORM_REF',dataset:'ORG01',id:subject.id,expectedVersion:subject.version};
 const template=row.scopes[0]!;if(template.kind!=='VERIFY_SCOPE')throw new Error('SCOPE_REQUIRED');row.scopes=refs.map(license=>({...template,license}));
 const content:Extract<DraftContent,{domain:'BUNDLE'}>={domain:'BUNDLE',campus:'NORTH',metadata,bytesBase64:f.workbook().toString('base64')};
 const saved=await workspace.saveDraft('maker',{...content,requestId:randomUUID()}),chrome=reviewBrowser();
 try{
  const session=await chrome.open(base+'/admin/vnext/organizations?as=maker&draft='+saved.id);
  const args={ids:refs.map(l=>l.id),versions:refs.map(l=>l.version),versionIds:refs.map(l=>l.versionId),append:true};
  await evaluate(chrome,session,'('+inspectScopes.toString()+')('+JSON.stringify(args)+')');
  const restored=await workspace.readDraft('maker',saved.id);expect(restored.version).toBe('2');if(restored.content.domain!=='BUNDLE')throw new Error('BUNDLE_REQUIRED');
  const rows=(restored.content.metadata['manifest'] as {rows:Array<{dataset:string;row:number;scopes?:unknown[]}>}).rows;
  const scopes=rows.find(r=>r.dataset==='ORG03'&&r.row===2)!.scopes as Array<{license:unknown}>;expect(scopes.map(s=>s.license)).toEqual([refs[0],refs[1],refs[0]]);expect(restored.content.bytesBase64).toBe(content.bytesBase64);
  const reopened=await chrome.open(base+'/admin/vnext/organizations?as=maker&draft='+saved.id);
  const all=[refs[0]!,refs[1]!,refs[0]!];await evaluate(chrome,reopened,'('+inspectScopes.toString()+')('+JSON.stringify({ids:all.map(l=>l.id),versions:all.map(l=>l.version),versionIds:all.map(l=>l.versionId),append:false})+')');
 }finally{await chrome.close();}
});
