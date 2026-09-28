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
let scheduled:OwnerFact,retired:OwnerFact;
const sources:Array<{url:string;body:Record<string,unknown>;status:number}>=[];
type Chrome=ReturnType<typeof reviewBrowser>;
async function evaluate(chrome:Chrome,session:string,expression:string){const result=await chrome.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);expect(result['exceptionDetails'],JSON.stringify(result['exceptionDetails'])).toBeUndefined();return result['result'].value;}
// Executed against the built application in real Chromium.
async function inspectCampus(input:{id:string;retired:boolean;click:string}){
 const wait=async<T>(read:()=>T,label:string):Promise<NonNullable<T>>=>{const until=Date.now()+15000;while(Date.now()<until){const v=read();if(v)return v as NonNullable<T>;await new Promise(r=>setTimeout(r,25));}throw new Error(label+' | '+document.body.innerText.slice(-1600));};
 const tab=await wait(()=>Array.from(document.querySelectorAll<HTMLButtonElement>('.workspace-tabs button')).find(b=>b.textContent==='院区'&&!b.disabled),'campus tab');tab.click();
 const row=await wait(()=>Array.from(document.querySelectorAll<HTMLButtonElement>('.entity-workspace .draft-item')).find(b=>b.textContent?.includes(input.id.slice(-8))&&!b.disabled),'exact campus row');row.click();
 await wait(()=>document.querySelector('.entity-workspace article.history')&&Array.from(document.querySelectorAll<HTMLButtonElement>('.entity-workspace button')).some(b=>b.textContent==='读取当前资料'&&!b.disabled),'campus inspection complete');
 const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('.entity-workspace button'));
 const labels=buttons.map(b=>b.textContent);
 if(labels.includes('申请永久退出'))throw new Error('DUPLICATE_RETIRE_VISIBLE');
 if(input.retired&&labels.includes('以此资料版本修订'))throw new Error('TERMINAL_REVISE_VISIBLE');
 if(!input.retired&&(!labels.includes('以此资料版本修订')||!labels.includes('制定开业计划')||!document.body.innerText.includes('已登记永久退出，生效时间')))throw new Error('PRE_EXIT_MAINTENANCE_HIDDEN');
 const action=buttons.find(b=>b.textContent===input.click&&!b.disabled);if(!action)throw new Error('ACTION_UNAVAILABLE: '+input.click);action.click();return labels;
}
beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);workspace=openOrganizationWorkspace(connection,provider);scenario=await operatingScenario(receipt,connection,provider,catalog);
 const exit=async(node:OwnerFact,validFrom:string)=>{const report=await scenario.campus.assessCampusImpact('maker',{id:node.id,validFrom,validTo:null});return scenario.campusApply({...scenario.common,action:'RETIRE',validFrom,target:{owner:'organization-master/campus',id:node.id,expectedVersion:node.version},sourceOperationStatus:'RETIRED',evidence:scenario.artifact.artifactId,reason:'DEMO_BROWSER_EXIT',assessmentDigest:report.digest,plan:{responsibleOwner:'DEMO_OFFICE',dueAt:'2099-12-01T00:00:00',actions:'DEMO separate closure'}});};
 scheduled=await exit(await scenario.createCampus('DEMO future retirement'),'2099-01-01T00:00:00');retired=await exit(await scenario.createCampus('DEMO effective retirement'),scenario.common.validFrom);
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',{owner:scenario.org,actor:r=>actor(r.headers)},{owner:scenario.campus,actor:r=>actor(r.headers)},undefined,undefined,{owner:workspace,actor:r=>actor(r.headers)});
 app.addHook('onSend',async(request,reply,payload)=>{if(request.url.endsWith('/revision-source')||request.url.endsWith('/campus-lifecycle-source'))sources.push({url:request.url,body:request.body as Record<string,unknown>,status:reply.statusCode});return payload;});
 await app.register(staticPlugin,{root:resolve('apps/admin-web/dist-vnext'),prefix:'/admin/vnext/'});app.get('/admin/vnext/organizations',(_r,reply)=>reply.sendFile('vnext.html'));
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('HTTP_ADDRESS_REQUIRED');base='http://127.0.0.1:'+address.port;
});
afterAll(async()=>{await app?.close();await workspace?.close();await scenario?.close();await catalog?.close();});
test('scheduled retirement hides duplicate exit but still loads a profile revision in Chrome',async()=>{
 const chrome=reviewBrowser(),offset=sources.length;try{const session=await chrome.open(base+'/admin/vnext/organizations?as=maker');await evaluate(chrome,session,'('+inspectCampus.toString()+')('+JSON.stringify({id:scheduled.id,retired:false,click:'以此资料版本修订'})+')');await expect.poll(()=>sources.length,{timeout:15000}).toBe(offset+1);expect(sources[offset]).toMatchObject({url:'/api/vnext/organization-workspace/references/revision-source',body:{kind:'CAMPUS',id:scheduled.id},status:200});}finally{await chrome.close();}
});
for(const [action,label] of [['RECORD_DISPOSITION','登记处置证据'],['COMPLETE_DISPOSITION','申请处置结案']] as const)test('effective retirement opens '+action+' through the dedicated source in Chrome',async()=>{
 const chrome=reviewBrowser(),offset=sources.length;try{const session=await chrome.open(base+'/admin/vnext/organizations?as=maker');await evaluate(chrome,session,'('+inspectCampus.toString()+')('+JSON.stringify({id:retired.id,retired:true,click:label})+')');await expect.poll(()=>sources.length,{timeout:15000}).toBe(offset+1);expect(sources[offset]).toMatchObject({url:'/api/vnext/organization-workspace/references/campus-lifecycle-source',body:{kind:'CAMPUS',id:retired.id,action},status:200});}finally{await chrome.close();}
});
