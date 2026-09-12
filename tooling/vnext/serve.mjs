import { existsSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import staticPlugin from '@fastify/static';
import { createTemporary,dropTemporary } from './fresh.mjs';
import { migrate,root } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { runtime } from './catalog-runtime.mjs';
import { buildCatalogServer } from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';

const owned=process.argv.includes('--fresh')?createTemporary():null;
if(process.argv.includes('--race')&&!owned)throw new Error('RACE_REQUIRES_OWNED_FRESH');
let catalog;let app;
try{
 if(owned){await migrate(owned.receipt);await seed(owned.receipt);}
 catalog=await runtime(owned?.receiptPath);
 app=await buildCatalogServer(catalog);
 let race;
 if(process.argv.includes('--race')){
  const ids=[];
  for(const code of ['ORG01','ORG02'])ids.push((await catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',kind:'DATASET',code,requestId:randomUUID(),reason:'BROWSER_RACE',values:{name:'合成选择 '+code},validFrom:'2026-01-01T00:00:00'})).id);
  let source=await catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',kind:'SOURCE',code:'RACE_SOURCE',requestId:randomUUID(),reason:'BROWSER_RACE',values:{name:'合成资格延迟验证',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00'});
  source=await catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',target:source.id,expectedHead:source.head,requestId:randomUUID(),reason:'BROWSER_RACE'});
  source=await catalog.command('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',target:source.id,expectedHead:source.head,reviewDigest:source.reviewDigest,requestId:randomUUID(),reason:'BROWSER_RACE'});
  race={slowId:ids[0],fastId:ids[1],sourceId:source.id,releaseFile:resolve(root,'.runtime/vnext/race-release-'+process.pid),startedFile:resolve(root,'.runtime/vnext/race-started-'+process.pid),completedFile:resolve(root,'.runtime/vnext/race-completed-'+process.pid),qualificationRelease:resolve(root,'.runtime/vnext/qualification-release-'+process.pid),qualificationStarted:resolve(root,'.runtime/vnext/qualification-started-'+process.pid),qualificationCompleted:resolve(root,'.runtime/vnext/qualification-completed-'+process.pid)};
  app.addHook('preHandler',async request=>{
   if(request.method==='GET'&&request.url.includes('/api/vnext/catalog/'+race.slowId)){
    writeFileSync(race.startedFile,'SLOW_DETAIL_REQUESTED');
    const deadline=Date.now()+120000;while(!existsSync(race.releaseFile)&&Date.now()<deadline)await delay(100);
    if(!existsSync(race.releaseFile))throw new Error('BROWSER_RACE_RELEASE_TIMEOUT');
   }
   if(request.method==='GET'&&request.url.includes('/api/vnext/sources/'+race.sourceId)){
    writeFileSync(race.qualificationStarted,'QUALIFICATION_REQUESTED');
    const deadline=Date.now()+120000;while(!existsSync(race.qualificationRelease)&&Date.now()<deadline)await delay(100);
    if(!existsSync(race.qualificationRelease))throw new Error('BROWSER_RACE_RELEASE_TIMEOUT');
   }
  });
  app.addHook('onResponse',async request=>{if(request.method==='GET'&&request.url.includes('/api/vnext/catalog/'+race.slowId))writeFileSync(race.completedFile,'SLOW_RESPONSE_COMPLETE');if(request.method==='GET'&&request.url.includes('/api/vnext/sources/'+race.sourceId))writeFileSync(race.qualificationCompleted,'QUALIFICATION_COMPLETE');});
 }
 await app.register(staticPlugin,{root:resolve(root,'apps/admin-web/dist-vnext'),prefix:'/admin/vnext/'});
 app.get('/admin/vnext/catalog',(_request,reply)=>reply.sendFile('vnext.html'));
 await app.listen({host:'127.0.0.1',port:4317});
 const stopFile=resolve(root,'.runtime/vnext/stop-'+process.pid);
 writeFileSync(resolve(root,'.runtime/vnext/server.json'),JSON.stringify({pid:process.pid,url:'http://127.0.0.1:4317/admin/vnext/catalog',stopFile,receipt:owned?.receiptPath??'.runtime/vnext/creation.json',race}));
 console.log(JSON.stringify({status:'VNEXT_BROWSER_READY',url:'http://127.0.0.1:4317/admin/vnext/catalog',stopFile}));
 while(!existsSync(stopFile))await delay(500);
}finally{await app?.close();await catalog?.close();if(owned)dropTemporary(owned.receipt);}
