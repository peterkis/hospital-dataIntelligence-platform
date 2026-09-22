import {provisionCampusAuthority} from './campus-authority.mjs';
import {createCampusClient} from '../../packages/generated-api-client/src/index.js';
import {campusCodeSet} from './campus-fixture.js';
import {test,expect,afterAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Kysely,PostgresDialect,sql} from 'kysely';
import type {DB} from '../../apps/governance-api/src/platform/database/vnext-types.generated.js';
import {readFileSync} from 'node:fs';
import {openCampus,type CampusCommand} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {openCatalog,LocalSyntheticKeyProvider,CatalogTransactionScope} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {fixture} from './protected-fixture.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {Pool} from 'pg';
import {peer,quote} from './lineage.mjs';
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const exec=(s:string)=>peer(receipt.name,s);
const provider=new LocalSyntheticKeyProvider();
provisionCampusAuthority(receipt,provider);
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!;
const org=openCampus(connection,provider);
const catalog=await openCatalog(connection,provider);
const f=await fixture(catalog,{textField:true,ruleVersion:'ORG01_MANUAL_CORE_V1'});
const job=await catalog.importJobCommand('maker',{...f.create,requestId:randomUUID(),contractId:f.contract.id,contractVersionId:f.contract.versionId});
exec(`INSERT INTO vnext_control.protected_grant SELECT a,${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
const artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO_REGISTRATION_EVIDENCE'));
const source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(v=>v.kind==='SOURCE'&&v.status==='PUBLISHED')!;
const common={validFrom:'2026-01-01T00:00:00',validTo:null,source:{systemId:source.id,versionId:source.versionId,alias:'DEMO_ORG',versionNo:1,recordLocator:'DEMO_SHEET_ROW_1',recordedAt:'2026-01-01T00:00:00',recordStatus:'PUBLISHED' as const,approvalRef:'DEMO_OFFICE_APPROVAL'}};

afterAll(async()=>{await org.close();await catalog.close();});
const create=():CampusCommand=>({...structuredClone(common),action:'CREATE',evidence:artifact.artifactId,sourceOperationStatus:'PLANNING',facts:{campusCode:'DEMO_'+randomUUID(),campusName:'DEMO 本部',nodeRole:'HEADQUARTERS',nodeKind:'PHYSICAL',campusAddress:null,adminDivision:null,publicPhone:null,openingDate:null}});
const input=(command:CampusCommand)=>({requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,command});
async function prepare(command:CampusCommand){const i=await org.stage('maker',input(command));const requestId=randomUUID(),candidate=await org.plan('maker',{inputId:i.inputId,requestId});await org.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await org.approveApplyUnit('reviewer',candidate);return {candidateId:candidate.candidateId,requestId};}
async function apply(command:CampusCommand){const result=await org.applyUnit('maker',await prepare(command));expect(result.status).toBe('COMMITTED');if(result.status!=='COMMITTED')throw new Error('NOT_COMMITTED');return result.facts[0]!;}
const target=(f:{id:string;version:string})=>({owner:'organization-master/campus' as const,id:f.id,expectedVersion:f.version});

const ref=(id:string)=>({owner:'organization-master/campus' as const,id});
test('AC05 duplicate stable references fail instead of silent deduplication',async()=>{
 const a=await apply(create());
 const resolved=await org.references.resolveCampusReference('maker',{references:[ref(a.id)]});expect(resolved.items[0]).toMatchObject({id:a.id,head:'1',facts:{campusName:'DEMO 本部'},profileVersion:{version:'1'},operationStatus:'PLANNING'});
 await expect(org.references.resolveCampusReference('maker',{references:[ref(a.id),ref(a.id)]})).rejects.toThrow('CAMPUS_REFERENCE_CONFLICT');
 await expect(org.references.readCampusReferenceCoverage('maker',{references:[ref(a.id),ref(a.id)],validFrom:'2026-01-01T00:00:00',validTo:null})).rejects.toThrow('CAMPUS_REFERENCE_CONFLICT');
});

test('AC04 accurate pins preserve old facts and reject another campus version UUID',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();const a=await apply(c),b=await apply(create());
 const first=(await org.references.history('maker',a.id)).versions[0]!,other=(await org.references.history('maker',b.id)).versions[0]!;
 const pinned={...ref(a.id),version:first.version,versionId:first.versionId};
 await apply({...c,action:'REVISE',target:target(a),facts:{...c.facts,campusName:'DEMO renamed'}});
 expect((await org.references.pinCampusVersion('maker',{references:[pinned]})).items[0]).toMatchObject({reference:pinned,facts:{campusName:'DEMO 本部'}});
 await expect(org.references.pinCampusVersion('maker',{references:[{...pinned,versionId:other.versionId}]})).rejects.toThrow('CAMPUS_VERSION_MISMATCH');
 expect((await org.references.resolveCampusReference('maker',{references:[ref(a.id)]})).items[0]?.facts?.campusName).toBe('DEMO renamed');
 expect((await org.references.resolveCampusReference('maker',{references:[ref(a.id)],asOf:first.recordedAt})).items[0]).toMatchObject({head:'1',facts:{campusName:'DEMO 本部'}});
});

test('coverage reports microsecond gaps and never uses a future profile for the past',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();const a=await apply({...c,validFrom:'2027-01-01T00:00:00.000001'});
 const result=await org.references.readCampusReferenceCoverage('maker',{references:[ref(a.id)],validFrom:'2027-01-01T00:00:00',validTo:null});
 expect(result.items[0]).toMatchObject({coverage:'NOT_COVERED',gaps:[{from:'2027-01-01T00:00:00.000000',to:'2027-01-01T00:00:00.000001'}],segments:[{from:'2027-01-01T00:00:00.000001',to:null,profileVersion:{version:'1'}}]});
 expect((await org.references.readCampusReferenceCoverage('maker',{references:[ref(a.id)],validFrom:'2027-01-01T00:00:00.000001',validTo:null})).items[0]?.coverage).toBe('COVERED');
});

test('real HTTP resolves typed references and reports duplicate conflicts',async()=>{
 const a=await apply(create()),app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,{owner:org,actor:r=>actor(r.headers)});
 await app.listen({host:'127.0.0.1',port:0});
 try{const address=app.server.address();if(!address||typeof address==='string')throw new Error();const url=`http://127.0.0.1:${address.port}/api/vnext/campuses/references/resolve`;
 const result=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify({references:[ref(a.id)]})});expect(result.status).toBe(200);expect(await result.json()).toMatchObject({items:[{id:a.id}]});
 const client=createCampusClient(`http://127.0.0.1:${address.port}`,'maker');
 const resolved=await client.resolveCampusReference({references:[ref(a.id)]});expect(resolved.response.status).toBe(200);const pinned=resolved.data!.items[0]!.profileVersion!;
 const pin=await client.pinCampusVersion({references:[pinned]});expect(pin.response.status).toBe(200);expect(pin.data!.items[0]!.reference).toEqual(pinned);
 const coverage=await client.readCampusReferenceCoverage({references:[ref(a.id)],validFrom:'2026-01-01T00:00:00',validTo:null});expect(coverage.response.status).toBe(200);expect(coverage.data!.items[0]!.coverage).toBe('COVERED');
 expect(JSON.stringify([resolved.data,pin.data,coverage.data])).not.toMatch(/recordLocator|envelope|key_hex|source_record_id|DEMO_SHEET_ROW/);
 const conflict=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify({references:[ref(a.id),ref(a.id)]})});expect(conflict.status).toBe(409);expect(await conflict.json()).toMatchObject({code:'CAMPUS_REFERENCE_CONFLICT'});
 }finally{await app.close();}
});

test('pins reject operation heads, invisible versions and duplicate IDs across versions',async()=>{
 const a=await apply(create()),v=(await org.references.history('maker',a.id)).versions[0]!;
 const plan=await apply({...common,action:'SCHEDULE_OPENING',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'PLANNING',plannedOpeningAt:'2027-01-01T00:00:00'});
 const h=await org.references.history('maker',a.id),pinned={...ref(a.id),version:v.version,versionId:v.versionId};
 expect((await org.references.resolveCampusReference('maker',{references:[ref(a.id)]})).items[0]).toMatchObject({head:plan.version,profileVersion:{version:'1'}});
 await expect(org.references.pinCampusVersion('maker',{references:[{...ref(a.id),version:plan.version,versionId:h.plans[0]!.versionId}]})).rejects.toThrow('CAMPUS_VERSION_MISMATCH');
 await expect(org.references.pinCampusVersion('maker',{references:[pinned],asOf:'2025-01-01T00:00:00'})).rejects.toThrow('CAMPUS_VERSION_MISMATCH');
 await expect(org.references.pinCampusVersion('maker',{references:[pinned,{...pinned,version:'2'}]})).rejects.toThrow('CAMPUS_REFERENCE_CONFLICT');
});
test('coverage uses the latest known profile only inside its asserted business interval',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();const a=await apply(c),old=(await org.references.history('maker',a.id)).versions[0]!;
 await apply({...c,action:'REVISE',target:target(a),validFrom:'2026-06-01T00:00:00',validTo:'2026-07-01T00:00:00',facts:{...c.facts,campusName:'DEMO corrected'}});
 const input={references:[ref(a.id)],validFrom:'2026-01-01T00:00:00',validTo:null};
 const current=(await org.references.readCampusReferenceCoverage('maker',input)).items[0]!;
 expect(current.coverage).toBe('COVERED');expect(current.gaps).toEqual([]);
 expect(current.segments.map(s=>[s.from,s.to,s.profileVersion.version])).toEqual([['2026-01-01T00:00:00.000000','2026-06-01T00:00:00.000000','1'],['2026-06-01T00:00:00.000000','2026-07-01T00:00:00.000000','2'],['2026-07-01T00:00:00.000000',null,'1']]);
 const past=(await org.references.readCampusReferenceCoverage('maker',{...input,asOf:old.recordedAt})).items[0]!;expect(past.segments).toHaveLength(1);expect(past.segments[0]?.profileVersion.version).toBe('1');
});
test('gaps retain stable identity and independent suspension without implying operating permission',async()=>{
 const a=await apply({...create(),validTo:'2026-06-01T00:00:00'});
 await apply({...common,action:'SUSPEND',target:target(a),evidence:randomUUID(),sourceOperationStatus:'SUSPENDED',validFrom:'2026-07-01T00:00:00',reason:'DEMO_STOP'});
 const resolved=await org.references.resolveCampusReference('maker',{references:[ref(a.id)],businessAt:'2026-08-01T00:00:00'});
 expect(resolved.items[0]).toMatchObject({id:a.id,facts:null,profileVersion:null,operationStatus:'SUSPENDED',operatingPermission:'NOT_EVALUABLE'});
 const coverage=await org.references.readCampusReferenceCoverage('maker',{references:[ref(a.id)],validFrom:'2026-01-01T00:00:00',validTo:null});
 expect(coverage.items[0]?.gaps).toEqual([{from:'2026-06-01T00:00:00.000000',to:null}]);
});
test('AC04 cached pins never bypass current READ permission; a mixed batch fails as a whole',async()=>{
 const a=await apply(create()),b=await apply(create());const p=(await org.references.resolveCampusReference('maker',{references:[ref(a.id)]})).items[0]!.profileVersion!;
 exec(`DELETE FROM organization_master.access WHERE actor='maker' AND subject_id=${quote(a.id)}::uuid AND permission='READ';`);
 try{
  await expect(org.references.pinCampusVersion('maker',{references:[p]})).rejects.toThrow('ACCESS_DENIED');
  await expect(org.references.resolveCampusReference('maker',{references:[ref(b.id),ref(a.id)]})).rejects.toThrow('ACCESS_DENIED');
  await expect(org.references.readCampusReferenceCoverage('maker',{references:[ref(a.id)],validFrom:'2026-01-01T00:00:00',validTo:null})).rejects.toThrow('ACCESS_DENIED');
 }finally{exec(`INSERT INTO organization_master.access VALUES('maker',${quote(a.id)}::uuid,'NORTH','READ');`);}
});
test('closed references reject wrong owners, extras, unknown IDs, impossible dates and oversized batches',async()=>{
 const a=await apply(create());
 for(const input of [{references:[{...ref(a.id),owner:'platform/campus'}]},{references:[{...ref(a.id),campusName:'cached'}]},{references:Array.from({length:101},()=>ref(a.id))},{references:[ref(a.id)],scope:'NORTH'}])await expect(org.references.resolveCampusReference('maker',JSON.parse(JSON.stringify(input)))).rejects.toThrow('CLOSED_INPUT_REQUIRED');
 await expect(org.references.resolveCampusReference('maker',{references:[ref(randomUUID())]})).rejects.toThrow('NOT_FOUND');
 await expect(org.references.resolveCampusReference('maker',{references:[ref(a.id)],asOf:'2025-01-01T00:00:00'})).rejects.toThrow('NOT_FOUND');
 await expect(org.references.resolveCampusReference('maker',{references:[ref(a.id)],businessAt:'2026-02-30T00:00:00'})).rejects.toThrow('LOCAL_TIME_REQUIRED');
 await expect(org.references.readCampusReferenceCoverage('maker',{references:[],validFrom:'2026-02-01T00:00:00',validTo:'2026-01-01T00:00:00'})).rejects.toThrow('INVALID_BUSINESS_PERIOD');
 for(const result of [await org.references.resolveCampusReference('maker',{references:[]}),await org.references.pinCampusVersion('maker',{references:[]}),await org.references.readCampusReferenceCoverage('maker',{references:[],validFrom:'2026-01-01T00:00:00',validTo:null})])expect(result.items).toEqual([]);
});
test('batch order and one temporal basis are shared by all reference results',async()=>{
 const a=await apply(create()),b=await apply(create());const r=await org.references.resolveCampusReference('maker',{references:[ref(b.id),ref(a.id)]});
 expect(r.items.map(x=>x.id)).toEqual([b.id,a.id]);expect(r.businessAt).toBe(r.observedAt);expect(r.asOf).toBe(r.observedAt);
 const plain=await org.references.read('maker',{id:a.id,businessAt:r.businessAt,asOf:r.asOf});const {reference,profileVersion,...projection}=r.items[1]!;expect(projection).toEqual(plain);expect(reference.id).toBe(a.id);expect(profileVersion?.versionId).toBeTruthy();
});
test('AC02 the service role cannot INSERT, UPDATE or DELETE campus tables',async()=>{
 const pool=new Pool({connectionString:connection});
 try{for(const [table,column] of [['campus','scope'],['campus_event','action'],['campus_version','facts'],['campus_code','code'],['campus_plan','planned_opening_at'],['campus_operation','state']])for(const query of [`INSERT INTO organization_master.${table} DEFAULT VALUES`,`UPDATE organization_master.${table} SET ${column}=${column}`,`DELETE FROM organization_master.${table}`])await expect(pool.query(query)).rejects.toThrow('permission denied');}
 finally{await pool.end();}
 expect(org.references).not.toHaveProperty('stage');expect(org.references).not.toHaveProperty('applyUnit');
});
test('the reference port runs inside the caller transaction without opening a competing root',async()=>{
 const a=await apply(create()),db=new Kysely<DB>({dialect:new PostgresDialect({pool:new Pool({connectionString:connection,max:1})})});
 try{await db.transaction().execute(async trx=>{
  await sql`select pg_advisory_xact_lock(901002)`.execute(trx);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{const bound=org.references.inTransaction(CatalogTransactionScope.from(trx));const result=await Promise.race([bound.resolveCampusReference('maker',{references:[ref(a.id)]}),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('COMPETING_TRANSACTION_ROOT')),5000);})]);expect(result.items[0]?.id).toBe(a.id);}
  finally{clearTimeout(timer);}
 });}finally{await db.destroy();}
});

test('HTTP fails closed without a reference Owner and with closed-input violations',async()=>{
 const app=await buildCatalogServer();
 try{const result=await app.inject({method:'POST',url:'/api/vnext/campuses/references/resolve',headers:{'x-catalog-actor':'maker'},payload:{references:[]}});expect(result.statusCode).toBe(503);expect(result.json()).toMatchObject({code:'BLOCKED_DEPENDENCY'});}finally{await app.close();}
 const readOnly=await buildCatalogServer(undefined,'CONTROL_PLANE',undefined,{references:org.references,actor:r=>actor(r.headers)});
 try{
  const invalid=await readOnly.inject({method:'POST',url:'/api/vnext/campuses/references/resolve',headers:{'x-catalog-actor':'maker'},payload:{references:[],actor:'reviewer'}});expect(invalid.statusCode).toBe(400);
  const a=await apply(create());const result=await readOnly.inject({method:'POST',url:'/api/vnext/campuses/references/resolve',headers:{'x-catalog-actor':'maker'},payload:{references:[ref(a.id)]}});expect(result.statusCode).toBe(200);
  const write=await readOnly.inject({method:'POST',url:'/api/vnext/campuses/inputs',headers:{'x-catalog-actor':'maker'},payload:input(create())});expect(write.statusCode).toBe(503);
 }finally{await readOnly.close();}
});
test('database failure cannot return a prior reference cached in the port',async()=>{
 const a=await apply(create()),disconnected=openCampus(connection,provider);
 expect((await disconnected.references.resolveCampusReference('maker',{references:[ref(a.id)]})).items[0]!.id).toBe(a.id);
 await disconnected.close();await expect(disconnected.references.resolveCampusReference('maker',{references:[ref(a.id)]})).rejects.toThrow();
});
test('running campuses resolve ordinary facts without turning them into operating permission',async()=>{
 const codes=await campusCodeSet(catalog,source.versionId),c=create();if(c.action!=='CREATE')throw new Error();c.facts.adminDivision=codes.reference;c.facts.campusAddress='DEMO address';c.facts.publicPhone='DEMO public phone';
 const a=await apply(c);await apply({...common,action:'ACTIVATE',target:target(a),state:'RUNNING',sourceOperationStatus:'RUNNING',evidence:artifact.artifactId});
 const result=await org.references.resolveCampusReference('maker',{references:[ref(a.id)]});
 expect(result.items[0]).toMatchObject({operationStatus:'RUNNING',operatingPermission:'NOT_EVALUABLE',facts:c.facts,profileVersion:{version:'1'},head:'2'});
});
