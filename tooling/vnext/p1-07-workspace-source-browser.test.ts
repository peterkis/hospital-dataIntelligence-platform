import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import staticPlugin from '@fastify/static';
import {reviewBrowser} from './review-browser.js';
import {operatingScenario} from './operating-scenario.js';
import {openCatalog,LocalSyntheticKeyProvider,type OwnerFact} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationWorkspace} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Awaited<ReturnType<typeof openCatalog>>,workspace:ReturnType<typeof openOrganizationWorkspace>,scenario:Awaited<ReturnType<typeof operatingScenario>>,app:Awaited<ReturnType<typeof buildCatalogServer>>,base:string;
let scheduled:OwnerFact,retired:OwnerFact,retiredWithPlan:OwnerFact,completed:OwnerFact,trial:OwnerFact;
const sources:Array<{url:string;body:Record<string,unknown>;status:number}>=[];
type Chrome=ReturnType<typeof reviewBrowser>;
async function evaluate(chrome:Chrome,session:string,expression:string){const result=await chrome.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);expect(result['exceptionDetails'],JSON.stringify(result['exceptionDetails'])).toBeUndefined();return result['result'].value;}
// Executed against the built application in real Chromium.
async function inspectCampus(input:{id:string;retired:boolean|null;click?:string;completed?:boolean}){
 const wait=async<T>(read:()=>T,label:string):Promise<NonNullable<T>>=>{const until=Date.now()+15000;while(Date.now()<until){const v=read();if(v)return v as NonNullable<T>;await new Promise(r=>setTimeout(r,25));}throw new Error(label+' | '+document.body.innerText.slice(-1600));};
 const tab=await wait(()=>Array.from(document.querySelectorAll<HTMLButtonElement>('.workspace-tabs button')).find(b=>b.textContent==='院区'&&!b.disabled),'campus tab');tab.click();
 const row=await wait(()=>Array.from(document.querySelectorAll<HTMLButtonElement>('.entity-workspace .draft-item')).find(b=>b.textContent?.includes(input.id.slice(-8))&&!b.disabled),'exact campus row');row.click();
 await wait(()=>document.querySelector('.entity-workspace article.history')&&Array.from(document.querySelectorAll<HTMLButtonElement>('.entity-workspace button')).some(b=>b.textContent==='读取当前资料'&&!b.disabled),'campus inspection complete');
  let buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('.entity-workspace button'));
 let labels=buttons.map(b=>b.textContent);
 if(input.retired!==null&&labels.includes('申请永久退出'))throw new Error('DUPLICATE_RETIRE_VISIBLE');
 if(input.retired&&labels.includes('以此资料版本修订'))throw new Error('TERMINAL_REVISE_VISIBLE');
 if(input.retired===false&&(!labels.includes('以此资料版本修订')||!labels.includes('制定开业计划')||!document.body.innerText.includes('已登记永久退出，生效时间')))throw new Error('PRE_EXIT_MAINTENANCE_HIDDEN');
 if(input.completed){await wait(()=>document.body.innerText.includes('处置状态：已结案（合成范围）'),'completed disposition report');labels=Array.from(document.querySelectorAll<HTMLButtonElement>('.entity-workspace button')).map(b=>b.textContent);if(labels.includes('登记处置证据')||labels.includes('申请处置结案'))throw new Error('COMPLETED_DISPOSITION_ACTION_VISIBLE');}
 if(input.click==='登记处置证据'||input.click==='申请处置结案'){await wait(()=>Array.from(document.querySelectorAll<HTMLButtonElement>('.entity-workspace button')).some(b=>b.textContent===input.click&&!b.disabled),'disposition action');buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('.entity-workspace button'));labels=buttons.map(b=>b.textContent);}
 if(input.click){const action=buttons.find(b=>b.textContent===input.click&&!b.disabled);if(!action)throw new Error('ACTION_UNAVAILABLE: '+input.click);action.click();}return labels;
}
beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);workspace=openOrganizationWorkspace(connection,provider);scenario=await operatingScenario(receipt,connection,provider,catalog);
 const exit=async(node:OwnerFact,validFrom:string)=>{const report=await scenario.campus.assessCampusImpact('maker',{id:node.id,validFrom,validTo:null});return scenario.campusApply({...scenario.common,action:'RETIRE',validFrom,target:{owner:'organization-master/campus',id:node.id,expectedVersion:node.version},sourceOperationStatus:'RETIRED',evidence:scenario.artifact.artifactId,reason:'DEMO_BROWSER_EXIT',assessmentDigest:report.digest,plan:{responsibleOwner:'DEMO_OFFICE',dueAt:'2099-12-01T00:00:00',actions:'DEMO separate closure'}});};
 scheduled=await exit(await scenario.createCampus('DEMO future retirement'),'2099-01-01T00:00:00');retired=await exit(await scenario.createCampus('DEMO effective retirement'),scenario.common.validFrom);
 const opening=await scenario.campusApply({...scenario.common,action:'SCHEDULE_OPENING',target:{owner:'organization-master/campus',id:(await scenario.createCampus('DEMO retirement with opening')).id,expectedVersion:'1'},evidence:scenario.artifact.artifactId,sourceOperationStatus:'PLANNING',plannedOpeningAt:'2099-12-01T00:00:00'});
 retiredWithPlan=await exit(opening,scenario.common.validFrom);let current=retiredWithPlan;
 for(const owner of ['BUSINESS_UNIT','LOCATION','ASSIGNMENT','CONSUMPTION'] as const){const report=await scenario.campus.assessCampusImpact('maker',{id:current.id,validFrom:scenario.common.validFrom,validTo:null});current=await scenario.campusApply({...scenario.common,action:'RECORD_DISPOSITION',target:{owner:'organization-master/campus',id:current.id,expectedVersion:current.version},sourceOperationStatus:'RETIRED',evidence:scenario.artifact.artifactId,reason:'DEMO_BROWSER_CLEAR',assessmentDigest:report.digest,resolution:{owner,status:'CLEAR',scope:'SYNTHETIC'}});}
 const finalReport=await scenario.campus.assessCampusImpact('maker',{id:current.id,validFrom:scenario.common.validFrom,validTo:null});completed=await scenario.campusApply({...scenario.common,action:'COMPLETE_DISPOSITION',target:{owner:'organization-master/campus',id:current.id,expectedVersion:current.version},sourceOperationStatus:'RETIRED',evidence:scenario.artifact.artifactId,reason:'DEMO_BROWSER_COMPLETE',assessmentDigest:finalReport.digest});
 const active=await scenario.activateCampus(await scenario.createCampus('DEMO resumed trial'));
 const stopped=await scenario.campusApply({...scenario.common,validFrom:'2026-02-01T00:00:00',action:'SUSPEND',target:{owner:'organization-master/campus',id:active.id,expectedVersion:active.version},evidence:scenario.artifact.artifactId,sourceOperationStatus:'SUSPENDED',reason:'DEMO_BROWSER_PAUSE'});
 trial=await scenario.campusApply({...scenario.common,validFrom:'2026-03-01T00:00:00',action:'RESUME',target:{owner:'organization-master/campus',id:active.id,expectedVersion:stopped.version},evidence:scenario.artifact.artifactId,sourceOperationStatus:'TRIAL_RUNNING',state:'TRIAL_RUNNING'});
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',{owner:scenario.org,actor:r=>actor(r.headers)},{owner:scenario.campus,actor:r=>actor(r.headers)},undefined,undefined,{owner:workspace,actor:r=>actor(r.headers)});
 app.addHook('onSend',async(request,reply,payload)=>{if(request.url.endsWith('/revision-source')||request.url.endsWith('/campus-lifecycle-source'))sources.push({url:request.url,body:request.body as Record<string,unknown>,status:reply.statusCode});return payload;});
 await app.register(staticPlugin,{root:resolve('apps/admin-web/dist-vnext'),prefix:'/admin/vnext/'});app.get('/admin/vnext/organizations',(_r,reply)=>reply.sendFile('vnext.html'));
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('HTTP_ADDRESS_REQUIRED');base='http://127.0.0.1:'+address.port;
});
afterAll(async()=>{await app?.close();await workspace?.close();await scenario?.close();await catalog?.close();});
test('scheduled retirement hides duplicate exit but still loads a profile revision in Chrome',async()=>{
 const chrome=reviewBrowser(),offset=sources.length;try{const session=await chrome.open(base+'/admin/vnext/organizations?as=maker');await evaluate(chrome,session,'('+inspectCampus.toString()+')('+JSON.stringify({id:scheduled.id,retired:false,click:'以此资料版本修订'})+')');await expect.poll(()=>sources.length,{timeout:15000}).toBe(offset+1);expect(sources[offset]).toMatchObject({url:'/api/vnext/organization-workspace/references/revision-source',body:{kind:'CAMPUS',id:scheduled.id},status:200});}finally{await chrome.close();}
});
test('scheduled retirement opens evidence collection but hides premature completion in Chrome',async()=>{
 const chrome=reviewBrowser(),offset=sources.length;try{const session=await chrome.open(base+'/admin/vnext/organizations?as=maker');const labels=await evaluate(chrome,session,'('+inspectCampus.toString()+')('+JSON.stringify({id:scheduled.id,retired:false,click:'登记处置证据'})+')');expect(labels).not.toContain('申请处置结案');await expect.poll(()=>sources.length,{timeout:15000}).toBe(offset+1);expect(sources[offset]).toMatchObject({url:'/api/vnext/organization-workspace/references/campus-lifecycle-source',body:{kind:'CAMPUS',id:scheduled.id,action:'RECORD_DISPOSITION'},status:200});}finally{await chrome.close();}
});
test('effective retirement keeps a surviving opening plan cancellable in Chrome',async()=>{
 const chrome=reviewBrowser(),offset=sources.length;try{const session=await chrome.open(base+'/admin/vnext/organizations?as=maker');await evaluate(chrome,session,'('+inspectCampus.toString()+')('+JSON.stringify({id:retiredWithPlan.id,retired:true,click:'取消开业计划'})+')');await expect.poll(()=>sources.length,{timeout:15000}).toBe(offset+1);expect(sources[offset]).toMatchObject({url:'/api/vnext/organization-workspace/references/campus-lifecycle-source',body:{kind:'CAMPUS',id:retiredWithPlan.id,action:'CANCEL_OPENING'},status:200});}finally{await chrome.close();}
});
test('completed retirement hides disposition actions in Chrome',async()=>{
 const chrome=reviewBrowser();try{const session=await chrome.open(base+'/admin/vnext/organizations?as=maker');const labels=await evaluate(chrome,session,'('+inspectCampus.toString()+')('+JSON.stringify({id:completed.id,retired:true,completed:true})+')');expect(labels).not.toContain('登记处置证据');expect(labels).not.toContain('申请处置结案');}finally{await chrome.close();}
});
for(const [action,label] of [['RECORD_DISPOSITION','登记处置证据'],['COMPLETE_DISPOSITION','申请处置结案']] as const)test('effective retirement opens '+action+' through the dedicated source in Chrome',async()=>{
 const chrome=reviewBrowser(),offset=sources.length;try{const session=await chrome.open(base+'/admin/vnext/organizations?as=maker');await evaluate(chrome,session,'('+inspectCampus.toString()+')('+JSON.stringify({id:retired.id,retired:true,click:label})+')');await expect.poll(()=>sources.length,{timeout:15000}).toBe(offset+1);expect(sources[offset]).toMatchObject({url:'/api/vnext/organization-workspace/references/campus-lifecycle-source',body:{kind:'CAMPUS',id:retired.id,action},status:200});}finally{await chrome.close();}
});

test('resumed trial campus exposes the activation entry point in real Chrome',async()=>{
 const chrome=reviewBrowser(),offset=sources.length;try{const session=await chrome.open(base+'/admin/vnext/organizations?as=maker');await evaluate(chrome,session,'('+inspectCampus.toString()+')('+JSON.stringify({id:trial.id,retired:null,click:'申请试运行 / 运行'})+')');await expect.poll(()=>sources.length,{timeout:15000}).toBe(offset+1);expect(sources[offset]).toMatchObject({url:'/api/vnext/organization-workspace/references/campus-lifecycle-source',body:{kind:'CAMPUS',id:trial.id,action:'ACTIVATE'},status:200});}finally{await chrome.close();}
});
