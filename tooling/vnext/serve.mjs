import { existsSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import staticPlugin from '@fastify/static';
import { createTemporary,dropTemporary } from './fresh.mjs';
import { migrate,root,peer,quote } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { runtime } from './catalog-runtime.mjs';
import { buildCatalogServer } from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';

const owned=process.argv.includes('--fresh')?createTemporary():null;
if((process.argv.includes('--race')||process.argv.includes('--impact')||process.argv.includes('--access')||process.argv.includes('--time'))&&!owned)throw new Error('RACE_REQUIRES_OWNED_FRESH');
let catalog;let app;
try{
 if(owned){await migrate(owned.receipt);await seed(owned.receipt);}
 catalog=await runtime(owned?.receiptPath);
 app=await buildCatalogServer(catalog);
 let race;
 if(process.argv.includes('--time')){
  const command=(action,extra)=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'BROWSER_BUSINESS_TIME',...extra});
  const publish=async item=>{const review=await catalog.command('maker',command('SUBMIT',{target:item.id,expectedHead:item.head}));return catalog.command('reviewer',command('PUBLISH',{target:item.id,expectedHead:review.head,reviewDigest:review.reviewDigest}));};
  const first=await publish(await catalog.command('maker',command('CREATE',{kind:'SOURCE',code:'TIMED_BROWSER_SOURCE',values:{name:'合成分期来源',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00',validTo:'2027-01-01T00:00:00'})));
  await publish(await catalog.command('maker',command('REVISE',{target:first.id,expectedHead:first.head,values:{name:'合成分期来源'},validFrom:'2027-01-01T00:00:00',validTo:'2028-01-01T00:00:00'})));
 }
 if(process.argv.includes('--access')){
  const command=(action,extra)=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'BROWSER_ACCESS',...extra});
  await catalog.command('maker',command('CREATE',{kind:'DATASET',code:'ORG01',values:{name:'合成重复编码'},validFrom:'2026-01-01T00:00:00'}));
  let entry=await catalog.command('maker',command('CREATE',{kind:'RESPONSIBILITY',code:'HISTORY_ACCESS',values:{dataset:'ORG07',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'}));
  peer(owned.receipt.name,`INSERT INTO vnext_control.object_grant VALUES('maker',${quote(entry.id)},'SYNTHETIC','RESPONSIBILITY','SYNTHETIC_NORTH','METADATA','ALL','WRITE'),('maker',${quote(entry.id)},'SYNTHETIC','RESPONSIBILITY','SYNTHETIC_NORTH','METADATA','ALL','READ'),('maker-alias',${quote(entry.id)},'SYNTHETIC','RESPONSIBILITY','SYNTHETIC_NORTH','METADATA','ALL','READ'); DELETE FROM vnext_control.object_grant WHERE actor_code='maker-alias' AND object_id=${quote(entry.id)} AND campus='SYNTHETIC_ALL';`);
  await catalog.command('maker',command('REVISE',{target:entry.id,expectedHead:entry.head,values:{authorityScope:'NORTH'},validFrom:'2026-07-01T00:00:00'}));
  let source=await catalog.command('maker',command('CREATE',{kind:'SOURCE',code:'ACCEPTED_BROWSER_SOURCE',values:{name:'合成已发布来源',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00'}));
  source=await catalog.command('maker',command('SUBMIT',{target:source.id,expectedHead:source.head}));
  source=await catalog.command('reviewer',command('PUBLISH',{target:source.id,expectedHead:source.head,reviewDigest:source.reviewDigest}));
  peer(owned.receipt.name,`INSERT INTO vnext_control.object_grant SELECT 'maker',${quote(source.id)},'SYNTHETIC','SOURCE','UNRESOLVED_DECLARATION','METADATA','DEFINITION',p FROM unnest(ARRAY['READ','WRITE']) p;`);
  await catalog.command('maker',command('REVISE',{target:source.id,expectedHead:source.head,values:{deploymentScope:'UNRESOLVED_DECLARATION'},validFrom:'2026-01-01T00:00:00'}));
 }
 if(process.argv.includes('--race')||process.argv.includes('--impact')){
  const ids=[];
  for(const code of ['ORG01','ORG02'])ids.push((await catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',kind:'DATASET',code,requestId:randomUUID(),reason:'BROWSER_RACE',values:{name:'合成选择 '+code},validFrom:'2026-01-01T00:00:00'})).id);
  let source=await catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',kind:'SOURCE',code:'RACE_SOURCE',requestId:randomUUID(),reason:'BROWSER_RACE',values:{name:'合成资格延迟验证',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00'});
  source=await catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',target:source.id,expectedHead:source.head,requestId:randomUUID(),reason:'BROWSER_RACE'});
  source=await catalog.command('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',target:source.id,expectedHead:source.head,reviewDigest:source.reviewDigest,requestId:randomUUID(),reason:'BROWSER_RACE'});
  race={slowId:ids[0],fastId:ids[1],sourceId:source.id,releaseFile:resolve(root,'.runtime/vnext/race-release-'+process.pid),startedFile:resolve(root,'.runtime/vnext/race-started-'+process.pid),completedFile:resolve(root,'.runtime/vnext/race-completed-'+process.pid),qualificationRelease:resolve(root,'.runtime/vnext/qualification-release-'+process.pid),qualificationStarted:resolve(root,'.runtime/vnext/qualification-started-'+process.pid),qualificationCompleted:resolve(root,'.runtime/vnext/qualification-completed-'+process.pid)};
  if(process.argv.includes('--impact')){
   let child=await catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',kind:'SOURCE',code:'IMPACT_CHILD',requestId:randomUUID(),reason:'BROWSER_IMPACT',values:{name:'合成影响下游',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:source.id.toUpperCase()},validFrom:'2026-01-01T00:00:00'});
   child=await catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',target:child.id,expectedHead:child.head,requestId:randomUUID(),reason:'BROWSER_IMPACT'});
   child=await catalog.command('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',target:child.id,expectedHead:child.head,reviewDigest:child.reviewDigest,requestId:randomUUID(),reason:'BROWSER_IMPACT'});
   race.impactChildId=child.id;
   if(process.argv.includes('--delta')){
    const command=(action,extra)=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'BROWSER_EVENT_DELTA',...extra});
    source=await catalog.command('maker',command('REVISE',{target:source.id,expectedHead:source.head,values:{},validFrom:'2027-01-01T00:00:00',validTo:'2028-01-01T00:00:00'}));
    source=await catalog.command('maker',command('SUBMIT',{target:source.id,expectedHead:source.head}));
    const firstImpact=await catalog.sourceImpact('reviewer','SYNTHETIC',source.id,'PUBLISH');
    source=await catalog.command('reviewer',command('PUBLISH',{target:source.id,expectedHead:source.head,reviewDigest:source.reviewDigest,impactDigest:firstImpact.impactDigest}));
    source=await catalog.command('maker',command('REVISE',{target:source.id,expectedHead:source.head,values:{},validFrom:'2029-01-01T00:00:00',validTo:'2030-01-01T00:00:00'}));
    await catalog.command('maker',command('SUBMIT',{target:source.id,expectedHead:source.head}));
   }
   await catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',kind:'RESPONSIBILITY',code:'FILTER_OWNER',requestId:randomUUID(),reason:'BROWSER_IMPACT',values:{dataset:'ORG07',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'});
   writeFileSync(race.releaseFile,'NO_DELAY');writeFileSync(race.qualificationRelease,'NO_DELAY');
  }
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
