import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {beforeAll,afterAll,test,expect} from 'vitest';
import {openCatalog,type Catalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import type {NursingEntry} from '../../apps/governance-api/src/modules/care-organization/index.js';
import type {LocationUseEntry,LocationUseScope} from '../../apps/governance-api/src/modules/location-master/index.js';
import {locationUseFixture} from './p3-07-fixture.js';
import {validationKeys} from './p3-07-validation-keys.mjs';

const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Catalog,f:Awaited<ReturnType<typeof locationUseFixture>>;
beforeAll(async()=>{
 const provider=validationKeys(receipt),pool=new Pool({connectionString:connection,max:1});
 try{
  const identity=(await pool.query('select current_user role,current_database() database,d.oid::text oid,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls from pg_database d join pg_roles r on r.rolname=current_user where d.datname=current_database()')).rows[0]!;
  expect(identity.database).toBe(receipt.name);expect(identity.oid).toBe(receipt.oid);expect(identity.role).toMatch(/^hdi_validation_[a-f0-9]{16}$/);expect(identity.rolsuper||identity.rolcreatedb||identity.rolcreaterole||identity.rolbypassrls).toBe(false);
  catalog=await openCatalog(connection,provider);
  const persistent=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).some(contract=>contract.dataset==='ORG04'&&contract.profile==='CORE'&&contract.status==='PUBLISHED');
  f=await locationUseFixture(receipt,identity.role,catalog,provider,connection,persistent);
 }finally{await pool.end();}
});
afterAll(async()=>{await f?.close();await catalog?.close();});

const window=(id:string)=>({id,validFrom:'2026-01-01T00:00:00',validTo:'2026-04-01T00:00:00'});
async function preview(entries:LocationUseEntry[]){
 const value=await f.input(entries),staged=await f.owner.stage('maker',value);await f.owner.verify('reviewer',f.verification(value,staged));return f.owner.preview('maker',{inputId:staged.inputId});
}
async function manager(scope:LocationUseScope){
 if(scope.targetType==='NURSING')return {base:f.nursing.base,lifecycle:f.nursing.lifecycle,id:(await f.nursing.owner.history('maker',{id:scope.target.id})).departmentId};
 const unitId=scope.targetType==='WARD'?(await f.wards.owner.history('maker',{id:scope.target.id})).bindings[0]!.managingUnitId:scope.target.id;
 return {base:f.base,lifecycle:f.wards.lifecycle,id:(await f.base.owner.history('maker',{id:unitId})).departmentId};
}
async function changeManagerLifecycle(scope:LocationUseScope,action:'SUSPEND'|'RESUME',effectiveAt:string){
 const parent=await manager(scope),department=await parent.base.department.history('maker',parent.id),life=await parent.lifecycle.history('maker',{id:parent.id}),job=await parent.base.dep.newJob();
 const staged=await parent.lifecycle.stage('maker',{requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',profile:'CORE',commands:[{action,department:{owner:'department-master',id:parent.id,expectedVersion:department.versions.at(-1)!.number,expectedLifecycleHead:life.lifecycle.at(-1)?.number??'0'},effectiveAt,reason:'TEST independently reviewed management lifecycle '+action,evidenceId:parent.base.dep.artifact.artifactId}],impacts:parent.base.impacts.map(impact=>({...impact,determination:'AFFECTED' as const}))});
 await parent.lifecycle.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST complete independent management impact attestation',policyApproved:true,materialsAccepted:true,impactReviews:parent.base.impactReviews});
 const requestId=randomUUID(),candidate=await parent.lifecycle.plan('maker',{inputId:staged.inputId,requestId});await parent.lifecycle.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await parent.lifecycle.approveApplyUnit('reviewer',candidate);const outcome=await parent.lifecycle.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(outcome.status).toBe('COMMITTED');
}

test('UW01: all five allowed actual physical location types admit the same logical office target',async()=>{
 const scope=await f.endpoint(),ids:string[]=[];
 for(const type of ['ROOM','CLINIC_ROOM','OPERATING_ROOM','WAREHOUSE','DISPENSING_WINDOW'] as const){
  const location=type==='ROOM'?scope.location:await f.newLocation(scope.campus.id,type),applicability={...scope,location},outcome=await f.apply(await f.input([await f.entry(applicability)])),id=outcome.facts[0]!.id;
  expect((await f.locations.owner.history('maker',{id:location.id})).versions[0]!.facts.locationType).toBe(type);
  expect(await f.owner.evaluateWindow('maker',{...window(id),mode:'CURRENT_ADMISSION'})).toMatchObject({declarationCovered:true,currentAdmissionCovered:true});ids.push(id);
 }
 expect(new Set(ids).size).toBe(5);expect((await f.owner.list('maker',{campus:'NORTH',targetId:scope.target.id})).items).toHaveLength(5);
});

test('UW02: actual CAMPUS, BUILDING and FLOOR identities cannot be published as whole-location use',async()=>{
 const scope=await f.endpoint(),tree=await f.locations.owner.tree('maker',{campusId:scope.campus.id,businessAt:'2026-02-01T00:00:00'});
 for(const type of ['CAMPUS','BUILDING','FLOOR'] as const){
  const location=tree.items.find(item=>item.version.facts.locationType===type)!;expect(location).toBeDefined();
  const value=await preview([await f.entry({...scope,location:{owner:'location-master',id:location.id}})]);
  expect(value.decision).toBe('BLOCKED');expect(value.issues.some(issue=>issue.code==='LOCATION_TYPE_INVALID')).toBe(true);
 }
 expect((await f.owner.list('maker',{campus:'NORTH',targetId:scope.target.id})).items).toHaveLength(0);
});

test('UW03: OTHER is blocked by the actual Location Owner before it can become a use endpoint',async()=>{
 const scope=await f.endpoint(),before=await f.locations.owner.tree('maker',{campusId:scope.campus.id,businessAt:'2026-02-01T00:00:00'});
 await expect(f.newLocation(scope.campus.id,'OTHER')).rejects.toThrow('BLOCKED_DEPENDENCY');
 expect(await f.locations.owner.tree('maker',{campusId:scope.campus.id,businessAt:'2026-02-01T00:00:00'})).toEqual(before);
 expect((await f.owner.list('maker',{campus:'NORTH',targetId:scope.target.id})).items).toHaveLength(0);
});

test.each(['UNIT','WARD','NURSING'] as const)('UW04: %s management SUSPEND/RESUME middle gap defeats endpoint-only and null-unbounded admission',async targetType=>{
 const scope=await f.endpoint(targetType),entry=await f.entry(scope),outcome=await f.apply(await f.input([entry])),id=outcome.facts[0]!.id,accepted=await f.owner.exact('maker',{id,version:'1'}),F='2026-02-01T00:00:00.000001',T='2026-03-01T00:00:00.000001';
 await changeManagerLifecycle(scope,'SUSPEND',F);await changeManagerLifecycle(scope,'RESUME',T);
 const evaluation=await f.owner.evaluateWindow('maker',{...window(id),mode:'CURRENT_ADMISSION'});
 expect(evaluation).toMatchObject({declarationCovered:true,currentAdmissionCovered:false,currentGaps:[{from:F,to:T}]});
 expect(evaluation.checks).toContainEqual(expect.objectContaining({from:F,to:T,status:'NOT_SATISFIED',dependencyChecks:expect.arrayContaining([expect.objectContaining({owner:'ORGANIZATION',status:'NOT_SATISFIED'})])}));
 expect(await f.owner.evaluateWindow('maker',{id,validFrom:'2026-01-01T00:00:00',validTo:F,mode:'CURRENT_ADMISSION'})).toMatchObject({currentAdmissionCovered:true});
 expect(await f.owner.evaluateWindow('maker',{id,validFrom:T,validTo:'2026-04-01T00:00:00',mode:'CURRENT_ADMISSION'})).toMatchObject({currentAdmissionCovered:true});
 expect(await f.owner.evaluateWindow('maker',{id,validFrom:'2026-01-01T00:00:00',validTo:null,mode:'CURRENT_ADMISSION'})).toMatchObject({declarationCovered:true,currentAdmissionCovered:false,currentGaps:[{from:F,to:T}]});
 expect(await f.owner.evaluateWindow('maker',{...window(id),mode:'HISTORICAL',recordAsOf:outcome.recordedAt})).toMatchObject({currentAdmissionCovered:true});
 expect(await f.owner.exact('maker',{id,version:'1'})).toEqual(accepted);
 const targetOwner=targetType==='UNIT'?f.base.owner:targetType==='WARD'?f.wards.owner:f.nursing.owner;
 expect((await targetOwner.read('maker',{id:scope.target.id,businessAt:'2026-01-01T00:00:00'})).state).toBe('ACTIVE');expect((await targetOwner.read('maker',{id:scope.target.id,businessAt:'2026-04-01T00:00:00'})).state).toBe('ACTIVE');
 const candidateScope={...scope,location:await f.newLocation(scope.campus.id)},candidate=await f.entry(candidateScope);candidate.row.valid_to='2026-04-01T00:00:00';
 expect((await preview([candidate])).decision).toBe('BLOCKED');
});

test('UW05: Nursing suspension retains an exclusive reservation while pure contraction and permanent END can still explicitly release it',async()=>{
 const scope=await f.endpoint('NURSING'),entry=await f.entry(scope,{kind:'EXCLUSIVE',version:'WHOLE_LOCATION_V1'}),outcome=await f.apply(await f.input([entry])),id=outcome.facts[0]!.id,accepted=await f.owner.exact('maker',{id,version:'1'}),nursing=await f.nursing.owner.history('maker',{id:scope.target.id}),version=nursing.versions[0]!,binding=nursing.bindings[0]!.versions[0]!.binding;
 const suspend:NursingEntry={action:'SUSPEND',target:{owner:'care-organization/nursing',id:nursing.id,expectedHead:'1'},row:{...f.nursing.row(binding),nursing_unit_id:version.facts.source.sourceAlias,nursing_code:version.facts.nursingCode,nursing_name:version.facts.nursingName,care_level:version.facts.careLevel,office_phone:version.facts.officePhone,valid_from:'2026-03-01T00:00:00',record_status:'SUSPENDED'},reason:'TEST actual upstream Nursing suspension',evidenceId:f.nursing.artifact.artifactId};
 await f.nursing.apply(await f.nursing.input([suspend]));
 expect(await f.owner.evaluateWindow('maker',{...window(id),mode:'CURRENT_ADMISSION'})).toMatchObject({declarationCovered:true,currentAdmissionCovered:false,currentGaps:[{from:'2026-03-01T00:00:00.000000',to:'2026-04-01T00:00:00.000000'}]});
 const another=await f.endpoint('ORG',{campus:scope.campus,location:scope.location}),incoming=await f.entry(another);incoming.row.valid_from='2026-03-01T00:00:00';
 expect((await preview([incoming])).issues).toContainEqual(expect.objectContaining({code:'LOCATION_USE_CONFLICT'}));
 const reduction:LocationUseEntry={...entry,action:'REVISE',target:{owner:'location-master/location-use',id,expectedHead:'1'},row:{...entry.row,valid_to:'2026-06-01T00:00:00'}};
 await f.apply(await f.input([reduction]));expect((await preview([incoming])).issues).toContainEqual(expect.objectContaining({code:'LOCATION_USE_CONFLICT'}));
 const ending:LocationUseEntry={...reduction,action:'END',target:{owner:'location-master/location-use',id,expectedHead:'2'},endAt:'2026-03-01T00:00:00',row:{...reduction.row,record_status:'RETIRED'}};
 await f.apply(await f.input([ending]));expect((await f.apply(await f.input([incoming]))).facts).toHaveLength(1);
 expect((await f.owner.read('maker',{id,businessAt:'2026-03-01T00:00:00'})).state).toBe('ENDED');expect(await f.owner.exact('maker',{id,version:'1'})).toEqual(accepted);
 expect((await f.nursing.owner.history('maker',{id:nursing.id})).versions.map(item=>item.action)).toEqual(['CREATE','SUSPEND']);
 expect((await f.locations.owner.history('maker',{id:scope.location.id})).versions).toHaveLength(1);
});

test('UW06: a currently disabled purpose blocks a new CREATE for an old business interval while the original historical interval remains admitted',async()=>{
 const scope=await f.endpoint(),entry=await f.entry(scope);entry.row.valid_to='2026-04-01T00:00:00';const outcome=await f.apply(await f.input([entry])),id=outcome.facts[0]!.id,purpose=await f.dictionary.read('maker',{id:scope.usageType.id});
 const stopped=await f.dictionary.command('maker',{action:'DISABLE',requestId:randomUUID(),reason:'TEST current disable is not backdated into old historical intervals',target:purpose.id,expectedHead:purpose.head});
 const other={...scope,location:await f.newLocation(scope.campus.id)},candidate=await f.entry(other);candidate.row.valid_to='2026-04-01T00:00:00';
 const denied=await preview([candidate]);expect(denied.decision).toBe('BLOCKED');expect(denied.issues).toContainEqual(expect.objectContaining({code:'USAGE_TYPE_DISABLED'}));
 expect(await f.owner.evaluateWindow('maker',{...window(id),mode:'HISTORICAL',recordAsOf:stopped.events.at(-1)!.recordedAt})).toMatchObject({declarationCovered:true,currentAdmissionCovered:true});
 expect(await f.owner.evaluateWindow('maker',{...window(id),mode:'HISTORICAL',recordAsOf:outcome.recordedAt})).toMatchObject({currentAdmissionCovered:true});
 expect((await f.owner.history('maker',{id})).versions).toHaveLength(1);
});
