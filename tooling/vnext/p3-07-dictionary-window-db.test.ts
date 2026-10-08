import {readFileSync} from 'node:fs';
import {randomUUID,createHmac} from 'node:crypto';
import {Pool} from 'pg';
import {beforeAll,afterAll,test,expect} from 'vitest';
import {openCatalog,canonicalPlan,planBinding,type Catalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import type {UsageTypeItem,UsageTypeReference,UsageTypeWindow} from '../../apps/governance-api/src/modules/location-master/usage-type-contracts.js';
import {locationUseFixture} from './p3-07-fixture.js';
import {validationKeys} from './p3-07-validation-keys.mjs';

const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Catalog,f:Awaited<ReturnType<typeof locationUseFixture>>,pool:Pool;
beforeAll(async()=>{
 const provider=validationKeys(receipt);pool=new Pool({connectionString:connection,max:1});
 const identity=(await pool.query('select current_user role,current_database() database,d.oid::text oid,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls from pg_database d join pg_roles r on r.rolname=current_user where d.datname=current_database()')).rows[0]!;
 expect(identity.database).toBe(receipt.name);expect(identity.oid).toBe(receipt.oid);expect(identity.role).toMatch(/^hdi_validation_[a-f0-9]{16}$/);
 expect(identity.rolsuper||identity.rolcreatedb||identity.rolcreaterole||identity.rolbypassrls).toBe(false);
 catalog=await openCatalog(connection,provider);
 const persistent=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).some(contract=>contract.dataset==='ORG04'&&contract.profile==='CORE'&&contract.status==='PUBLISHED');
 f=await locationUseFixture(receipt,identity.role,catalog,provider,connection,persistent);
});
afterAll(async()=>{await f?.close();await catalog?.close();await pool?.end();});

async function approve(draft:UsageTypeItem,evidenceId=draft.evidenceId){
 await f.dictionary.command('reviewer',{action:'VERIFY',requestId:randomUUID(),reason:'TEST independently verified dictionary content',target:draft.id,expectedHead:draft.head,versionId:draft.versionId,reviewDigest:draft.reviewDigest,evidenceId,meaningAccepted:true});
 return f.dictionary.command('reviewer',{action:'APPROVE',requestId:randomUUID(),reason:'TEST independently approved dictionary content',target:draft.id,expectedHead:draft.head,versionId:draft.versionId,reviewDigest:draft.reviewDigest});
}
async function revise(prior:UsageTypeItem,changes:{name?:string;validTo?:string|null}={}){
 return f.dictionary.command('maker',{action:'REVISE',requestId:randomUUID(),reason:'TEST immutable meaning and stable identity revision',target:prior.id,expectedHead:prior.head,code:prior.code,name:changes.name??prior.name,meaning:prior.meaning,description:prior.description,validFrom:prior.validFrom,validTo:changes.validTo===undefined?prior.validTo:changes.validTo,sourceId:prior.sourceId,sourceVersionId:prior.sourceVersionId,evidenceId:prior.evidenceId});
}
async function atMicrosecond(time:string,delta:-1|1){
 return (await pool.query<{time:string}>('select to_char($1::timestamp + $2::integer * interval \'1 microsecond\',\'YYYY-MM-DD"T"HH24:MI:SS.US\') time',[time,delta])).rows[0]!.time;
}
async function sqlWindow(pin:UsageTypeReference,code:string,validFrom:string,validTo:string|null,recordAsOf:string,actor='maker'){
 return (await pool.query<{result:UsageTypeWindow}>('select location_master.usage_type_window($1,$2::jsonb,$3,$4::timestamp,$5::timestamp,$6::timestamp) result',[actor,JSON.stringify(pin),code,validFrom,validTo,recordAsOf])).rows[0]!.result;
}
async function established(){
 const scope=await f.endpoint(),entry=await f.entry(scope),outcome=await f.apply(await f.input([entry]));
 return {scope,entry,outcome,id:outcome.facts[0]!.id,purpose:await f.dictionary.read('maker',{id:scope.usageType.id})};
}

test('DW01: actual dictionary lifecycle boundaries preserve the disabled business span after re-enable and old record knowledge',async()=>{
 const original=await established(),pin=f.reference(original.purpose);
 const stopped=await f.dictionary.command('maker',{action:'DISABLE',requestId:randomUUID(),reason:'TEST actual DB-timed disable boundary',target:original.purpose.id,expectedHead:original.purpose.head}),disable=stopped.events.at(-1)!;
 const restarted=await f.dictionary.command('maker',{action:'ENABLE',requestId:randomUUID(),reason:'TEST actual DB-timed enable boundary',target:stopped.id,expectedHead:stopped.head}),enable=restarted.events.at(-1)!;
 expect(enable.recordedAt>disable.recordedAt).toBe(true);expect(BigInt(enable.sequence)>BigInt(disable.sequence)).toBe(true);
 const before=await atMicrosecond(disable.recordedAt,-1),after=await atMicrosecond(enable.recordedAt,1),from=disable.recordedAt,to=enable.recordedAt;
 expect((await f.dictionary.read('maker',{id:stopped.id,recordAsOf:from})).events).toEqual([disable]);
 expect((await f.dictionary.read('maker',{id:stopped.id,recordAsOf:from})).enabled).toBe(false);
 expect((await f.dictionary.read('maker',{id:stopped.id,recordAsOf:to})).enabled).toBe(true);
 const historical=await f.owner.evaluateWindow('maker',{id:original.id,validFrom:before,validTo:after,mode:'HISTORICAL',recordAsOf:to});
 expect(historical).toMatchObject({declarationCovered:true,currentAdmissionCovered:false,currentGaps:[{from,to}]});
 expect(historical.checks.filter(check=>check.status==='NOT_SATISFIED')).toEqual([expect.objectContaining({from,to,reason:'USAGE_TYPE_DISABLED'})]);
 expect(historical.checks.filter(check=>check.status==='SATISFIED').map(check=>({from:check.from,to:check.to}))).toEqual([{from:before,to:from},{from:to,to:after}]);
 expect(await f.owner.evaluateWindow('maker',{id:original.id,validFrom:from,validTo:to,mode:'HISTORICAL',recordAsOf:original.outcome.recordedAt})).toMatchObject({declarationCovered:true,currentAdmissionCovered:true});
 expect(await f.owner.evaluateWindow('maker',{id:original.id,validFrom:to,validTo:after,mode:'HISTORICAL',recordAsOf:from})).toMatchObject({currentAdmissionCovered:false});
 const boundaries=(await pool.query<{result:string[]}>('select location_master.usage_type_boundaries($1,$2::jsonb,$3::timestamp,$4::timestamp,$5::timestamp) result',['maker',JSON.stringify(pin),before,after,to])).rows[0]!.result;
 expect(boundaries).toEqual([from,to]);
 expect((await sqlWindow(pin,original.purpose.code,before,from,to)).parts).toEqual([{from:before,to:from,versionId:original.purpose.versionId,version:original.purpose.version}]);
 await expect(sqlWindow(pin,original.purpose.code,from,to,to)).rejects.toMatchObject({message:'USAGE_TYPE_DISABLED'});
 expect((await sqlWindow(pin,original.purpose.code,to,after,to)).parts).toEqual([{from:to,to:after,versionId:original.purpose.versionId,version:original.purpose.version}]);
 expect((await sqlWindow(pin,original.purpose.code,from,to,original.outcome.recordedAt)).parts).toHaveLength(1);
});

test('DW02: a finite latest approved dictionary declaration never falls back to its prior open content',async()=>{
 const original=await established(),pin=f.reference(original.purpose),draft=await revise(original.purpose,{validTo:'2026-03-01T00:00:00.000001'}),window={id:original.id,validFrom:'2026-02-01T00:00:00',validTo:'2026-04-01T00:00:00'};
 // A content draft does not replace its last accepted version.
 expect(await f.owner.evaluateWindow('maker',{...window,mode:'CURRENT_ADMISSION'})).toMatchObject({currentAdmissionCovered:true});
 const finite=await approve(draft);expect(finite).toMatchObject({id:original.purpose.id,code:original.purpose.code,meaning:original.purpose.meaning,status:'APPROVED',validTo:'2026-03-01T00:00:00.000001'});
 const current=await f.owner.evaluateWindow('maker',{...window,mode:'CURRENT_ADMISSION'});
 expect(current).toMatchObject({declarationCovered:true,currentAdmissionCovered:false,currentGaps:[{from:'2026-03-01T00:00:00.000001',to:'2026-04-01T00:00:00.000000'}]});
 expect(current.checks).toContainEqual(expect.objectContaining({from:'2026-03-01T00:00:00.000001',reason:'USAGE_TYPE_PERIOD_NOT_COVERED'}));
 expect(await f.owner.evaluateWindow('maker',{...window,mode:'HISTORICAL',recordAsOf:original.outcome.recordedAt})).toMatchObject({currentAdmissionCovered:true});
 expect((await f.dictionary.read('maker',{id:original.purpose.id,versionId:original.purpose.versionId})).validTo).toBeNull();
 await expect(sqlWindow(pin,original.purpose.code,'2026-03-01T00:00:00.000001','2026-04-01T00:00:00',finite.approvedAt!)).rejects.toMatchObject({message:'USAGE_TYPE_PERIOD_NOT_COVERED'});
 expect((await sqlWindow(pin,original.purpose.code,'2026-03-01T00:00:00.000001','2026-04-01T00:00:00',original.outcome.recordedAt)).parts).toHaveLength(1);
});

test('DW03: approved renaming keeps the stable code and meaning while an old relation separately exposes its accepted and current bases',async()=>{
 const original=await established(),accepted=await f.owner.exact('maker',{id:original.id,version:'1'}),draft=await revise(original.purpose,{name:'TEST renamed administrative office'}),renamed=await approve(draft);
 expect(renamed).toMatchObject({id:original.purpose.id,code:original.purpose.code,meaning:original.purpose.meaning,name:'TEST renamed administrative office'});expect(renamed.versionId).not.toBe(original.purpose.versionId);
 const evaluation=await f.owner.evaluateWindow('maker',{id:original.id,validFrom:'2026-02-01T00:00:00',validTo:'2026-03-01T00:00:00',mode:'CURRENT_ADMISSION'});
 expect(evaluation.currentAdmissionCovered).toBe(true);
 expect(evaluation.checks[0]!.acceptedBasis).toEqual(accepted.facts.dependencies);
 expect(evaluation.checks[0]!.dependencyChecks).toContainEqual(expect.objectContaining({owner:'USAGE_TYPE',status:'SATISFIED',basisChanged:true,basis:expect.objectContaining({id:renamed.id,versionId:original.purpose.versionId,parts:[expect.objectContaining({versionId:renamed.versionId,version:renamed.version})]})}));
 expect(await f.owner.exact('maker',{id:original.id,version:'1'})).toEqual(accepted);
 expect((await f.owner.history('maker',{id:original.id})).versions[0]!.facts.usageType).toEqual(f.reference(original.purpose));
 expect((await f.dictionary.read('maker',{id:original.purpose.id,versionId:original.purpose.versionId})).name).toBe(original.purpose.name);
 await expect(f.dictionary.command('maker',{action:'REVISE',requestId:randomUUID(),reason:'TEST changing purpose meaning is rejected',target:renamed.id,expectedHead:renamed.head,code:renamed.code,name:renamed.name,meaning:'TEST a substantially different clinical purpose',description:null,validFrom:renamed.validFrom,validTo:renamed.validTo,sourceId:renamed.sourceId,sourceVersionId:renamed.sourceVersionId,evidenceId:renamed.evidenceId})).rejects.toThrow('USAGE_TYPE_MEANING_IMMUTABLE');
 const distinct=await f.purpose();expect(distinct.id).not.toBe(renamed.id);expect(distinct.code).not.toBe(renamed.code);
});

test('DW04: expired raw material does not prevent metadata reads, direct lifecycle maintenance, or exact request replay and still blocks fresh content verification',async()=>{
 const job=await f.newJob(),artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:5},Buffer.from('TEST short-lived independently checked dictionary content'));
 const request={action:'CREATE' as const,requestId:randomUUID(),reason:'TEST purpose with naturally expiring raw material',code:'EXPIRY_'+randomUUID().replaceAll('-','').toUpperCase(),name:'TEST expiring raw material purpose',meaning:'TEST metadata remains readable after material retention',description:null,validFrom:'2026-01-01T00:00:00',validTo:null,sourceId:f.source.id,sourceVersionId:f.source.versionId,evidenceId:artifact.artifactId};
 const created=await f.dictionary.command('maker',request),approved=await approve(created),draft=await revise(approved,{name:'TEST pending fresh content review'});
 const remaining=(await pool.query<{ms:number}>('select greatest(0,ceil(extract(epoch from ($1::timestamp-timezone(\'Asia/Shanghai\',clock_timestamp()))) * 1000))::integer ms',[artifact.expiresAt])).rows[0]!.ms;
 await new Promise(resolve=>setTimeout(resolve,remaining+30));
 await expect(f.dictionary.readMaterial('maker',{id:artifact.artifactId,sourceVersionId:f.source.versionId})).rejects.toThrow('PAYLOAD_UNAVAILABLE');
 expect((await f.dictionary.read('maker',{id:approved.id,versionId:approved.versionId})).status).toBe('APPROVED');
 expect(await f.dictionary.command('maker',request)).toEqual(created);
 const disable={action:'DISABLE' as const,requestId:randomUUID(),reason:'TEST direct maintenance needs current permission but no expired raw material',target:approved.id,expectedHead:draft.head},stopped=await f.dictionary.command('maker',disable);
 expect(stopped).toMatchObject({id:approved.id,versionId:approved.versionId,status:'APPROVED',enabled:false});expect(await f.dictionary.command('maker',disable)).toEqual(stopped);
 expect((await f.dictionary.read('maker',{id:approved.id})).status).toBe('DRAFT');
 expect((await sqlWindow(f.reference(approved),approved.code,'2026-01-01T00:00:00','2026-02-01T00:00:00',stopped.events.at(-1)!.recordedAt)).parts.map(part=>part.versionId)).toEqual([approved.versionId]);
 await expect(f.dictionary.command('reviewer',{action:'VERIFY',requestId:randomUUID(),reason:'TEST fresh verification still requires readable raw evidence',target:draft.id,expectedHead:stopped.head,versionId:draft.versionId,reviewDigest:draft.reviewDigest,evidenceId:artifact.artifactId,meaningAccepted:true})).rejects.toThrow('PAYLOAD_UNAVAILABLE');
 const enabled=await f.dictionary.command('maker',{action:'ENABLE',requestId:randomUUID(),reason:'TEST re-enable cannot publish the pending draft',target:stopped.id,expectedHead:stopped.head});
 expect(enabled).toMatchObject({versionId:approved.versionId,status:'APPROVED',enabled:true});expect((await f.dictionary.read('maker',{id:approved.id})).status).toBe('DRAFT');
 expect((await f.dictionary.read('maker',{id:approved.id,versionId:approved.versionId})).status).toBe('APPROVED');
 expect((await sqlWindow(f.reference(approved),approved.code,'2026-01-01T00:00:00','2026-02-01T00:00:00',enabled.events.at(-1)!.recordedAt)).parts.map(part=>part.versionId)).toEqual([approved.versionId]);
 expect((await f.dictionary.history('maker',{id:approved.id})).map(item=>item.versionId)).toEqual([approved.versionId,draft.versionId]);
});

test('DW05: restricted dictionary SQL independently rejects wrong pins, wrong codes, outsiders and table reads',async()=>{
 const purpose=await f.purpose(),pin=f.reference(purpose),from='2026-01-01T00:00:00',to='2026-02-01T00:00:00',recordAsOf=purpose.approvedAt!;
 expect((await sqlWindow(pin,purpose.code,from,to,recordAsOf)).parts).toHaveLength(1);
 await expect(sqlWindow({...pin,version:String(BigInt(pin.version)+1n)},purpose.code,from,to,recordAsOf)).rejects.toMatchObject({message:'BLOCKED_DEPENDENCY'});
 await expect(sqlWindow(pin,'UNREGISTERED_NAME',from,to,recordAsOf)).rejects.toMatchObject({message:'USAGE_TYPE_PERIOD_NOT_COVERED'});
 await expect(sqlWindow(pin,purpose.code,from,to,recordAsOf,'outsider')).rejects.toMatchObject({message:'ACCESS_DENIED'});
 await expect(pool.query('select * from location_master.usage_type_version')).rejects.toMatchObject({code:'42501'});
});

async function signedDictionaryCreate(command:Record<string,unknown>){
 const provider=validationKeys(receipt),client=await pool.connect(),key=Buffer.from(planBinding(provider,'LOCATION_USE_SQL_AUTHORITY_V1',{}),'hex');
 try{
  const material=await f.dictionary.readMaterial('maker',{id:f.artifact.artifactId,sourceVersionId:f.source.versionId});
  const materials=[{id:material.id,digest:planBinding(provider,'LOCATION_USE_MATERIAL_V1',material.bytesBase64)}];
  await client.query('BEGIN');await client.query('select pg_advisory_xact_lock(901002)');
  const transaction=(await client.query<{transaction:string}>('select pg_current_xact_id()::text transaction')).rows[0]!.transaction;
  const ticket=canonicalPlan({command,materialDigest:planBinding(provider,'LOCATION_USAGE_TYPE_MATERIALS_V1',materials),actor:'maker',transaction});
  return (await client.query<{result:UsageTypeItem}>('select location_master.usage_type_command($1,$2) result',[ticket,createHmac('sha256',key).update(ticket).digest('hex')])).rows[0]!.result;
 }finally{await client.query('ROLLBACK');client.release();key.fill(0);}
}
const directDictionaryCommand=()=>({action:'CREATE',requestId:randomUUID(),reason:'TEST signed SQL primitive shape',code:'SIGNED_'+randomUUID().replaceAll('-','').toUpperCase(),name:'TEST explicit string name',meaning:'TEST explicit string purpose meaning',description:null,validFrom:'2026-01-01T00:00:00',validTo:null,sourceId:f.source.id,sourceVersionId:f.source.versionId,evidenceId:f.artifact.artifactId});

test.each(['name','reason','meaning'] as const)('DW06: authentic restricted SQL rejects boolean %s rather than interpreting its text extraction',async field=>{
 const command={...directDictionaryCommand(),[field]:false};
 await expect(signedDictionaryCreate(command)).rejects.toMatchObject({message:'CLOSED_INPUT_REQUIRED'});
});
test('DW07: authentic restricted SQL accepts the corresponding primitive-valid CREATE and rollback leaves no dictionary identity',async()=>{
 const command=directDictionaryCommand(),result=await signedDictionaryCreate(command);
 expect(result).toMatchObject({code:command.code,name:command.name,meaning:command.meaning,status:'DRAFT'});
 await expect(f.dictionary.read('maker',{id:result.id})).rejects.toThrow('NOT_FOUND');
});
