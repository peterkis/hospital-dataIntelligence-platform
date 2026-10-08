import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {validationKeys} from './p3-07-validation-keys.mjs';
import {withP307Predecessor,p307PredecessorBaseline,p307PredecessorPrefix} from './p3-07-predecessor.mjs';
import {migrationFiles,readReceipt} from './lineage.mjs';
import {openCatalog,type UnitOutcome} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openCampus,openOperatingRelations} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {openDepartment,openDepartmentLifecycle} from '../../apps/governance-api/src/modules/department-master/index.js';
import {openBusinessUnit,openWard,openNursingUnit,openWardNursingCoverage,type WardNursingEntry} from '../../apps/governance-api/src/modules/care-organization/index.js';
import {openLocation,type LocationEntry} from '../../apps/governance-api/src/modules/location-master/index.js';
import {wardUpstreamPorts} from '../../apps/governance-api/src/composition/ward-dependencies.js';
import {nursingUpstreamPorts} from '../../apps/governance-api/src/composition/nursing-unit-dependencies.js';
import {wardNursingUpstreamPorts} from '../../apps/governance-api/src/composition/ward-nursing-dependencies.js';
import type {locationFixture} from './p3-06-fixture.js';
import type {wardFixture} from './p3-02-fixture.js';
import type {wardNursingFixture} from './p3-05-fixture.js';

type Request={candidateId:string;requestId:string};
type Query={id:string;businessAt:string;recordAsOf:string;campus?:'NORTH'|'SOUTH'};
interface ReadOwner<H,E,Q> {
 history(actor:string,input:{id:string;recordAsOf?:string}):Promise<H>;
 exact(actor:string,input:{id:string;version:string;recordAsOf?:string}):Promise<E>;
 read(actor:string,input:Query):Promise<Q>;
}
interface Captured<H,E,Q> {id:string;history:H;exact:E;recordHistories:Array<{input:{id:string;recordAsOf:string};result:H}>;queries:Array<{input:Query;result:Q}>}
type CaptureFor<O extends ReadOwner<unknown,unknown,unknown>>=Captured<Awaited<ReturnType<O['history']>>,Awaited<ReturnType<O['exact']>>,Awaited<ReturnType<O['read']>>>;
const departmentReader=(owner:ReturnType<typeof openDepartment>)=>({history:(actor:string,input:{id:string;recordAsOf?:string})=>owner.history(actor,input.id,input.recordAsOf),exact:owner.exact,read:(actor:string,input:Query)=>owner.read(actor,{...input,campus:input.campus??'NORTH'})});
type LocationOwner=ReturnType<typeof openLocation>;
type CoverageOwner=ReturnType<typeof openWardNursingCoverage>;
interface Recovery {
 request:Request;applied:Awaited<ReturnType<LocationOwner['applyUnit']>>;outcome:UnitOutcome;
 replay:Awaited<ReturnType<LocationOwner['applyUnit']>>;reconcile:'MATCHED';
}
interface PredecessorEvidence {
 gate:'P3_07_POPULATED_0200';baseline:string;prefix:number;oid:string;sourceSha256:string;sourceLoaderOverlay:unknown;
 location:CaptureFor<LocationOwner>;department:CaptureFor<ReturnType<typeof departmentReader>>;
 unit:CaptureFor<ReturnType<typeof openBusinessUnit>>;ward:CaptureFor<ReturnType<typeof openWard>>;
 nursing:CaptureFor<ReturnType<typeof openNursingUnit>>;coverage:CaptureFor<CoverageOwner>;
 recoveries:{location:Recovery;coverage:Recovery};
}

async function capture<H,E,Q>(owner:ReadOwner<H,E,Q>,id:string,recordTimes:string[],businessTimes:string[],queryContext:Pick<Query,'campus'>={}):Promise<Captured<H,E,Q>>{
 const recordHistories:Captured<H,E,Q>['recordHistories']=[],queries:Captured<H,E,Q>['queries']=[];
 for(const recordAsOf of [...new Set(recordTimes)]){
  const input={id,recordAsOf};recordHistories.push({input,result:await owner.history('maker',input)});
  for(const businessAt of businessTimes){const query={id,businessAt,recordAsOf,...queryContext};queries.push({input:query,result:await owner.read('maker',query)});}
 }
 return {id,history:await owner.history('maker',{id}),exact:await owner.exact('maker',{id,version:'1'}),recordHistories,queries};
}
async function verifyCapture<H,E,Q>(owner:ReadOwner<H,E,Q>,original:Captured<H,E,Q>){
 assert.deepEqual(await owner.history('maker',{id:original.id}),original.history);
 assert.deepEqual(await owner.exact('maker',{id:original.id,version:'1'}),original.exact);
 for(const known of original.recordHistories)assert.deepEqual(await owner.history('maker',known.input),known.result);
 for(const query of original.queries)assert.deepEqual(await owner.read('maker',query.input),query.result);
}
async function recovery(owner:Pick<LocationOwner,'applyUnit'|'resumeOutcome'|'reconcileCommittedUnit'>,request:Request):Promise<Recovery>{
 const applied=await owner.applyUnit('maker',request);assert.equal(applied.status,'COMMITTED');
 const outcome=await owner.resumeOutcome('maker',request);if(!outcome)throw new Error('PREDECESSOR_COMMITTED_OUTCOME_REQUIRED');
 const replay=await owner.applyUnit('maker',request);assert.deepEqual(replay,applied);
 assert.equal((await owner.reconcileCommittedUnit('maker',request)).status,'MATCHED');
 return {request,applied,outcome,replay,reconcile:'MATCHED'};
}
async function verifyRecovery(owner:Pick<LocationOwner,'applyUnit'|'resumeOutcome'|'reconcileCommittedUnit'>,original:Recovery){
 assert.deepEqual(await owner.applyUnit('maker',original.request),original.replay);
 assert.deepEqual(await owner.resumeOutcome('maker',original.request),original.outcome);
 assert.equal((await owner.reconcileCommittedUnit('maker',original.request)).status,'MATCHED');
 await assert.rejects(owner.resumeOutcome('outsider',original.request),/ACCESS_DENIED/);
}

const args=process.argv.slice(2);if(args.length>1||(args.length===1&&args[0]!=='--verify'))throw new Error('CLOSED_COMMAND_REQUIRED');
const connection=process.env['VNEXT_VALIDATION_OWNER_URL'],receiptPath=process.env['VNEXT_TEST_RECEIPT'];
if(!connection||!receiptPath)throw new Error('VALIDATION_ENVIRONMENT_REQUIRED');
const receipt=readReceipt(receiptPath);if(receipt.taskId!=='P3-07'||receipt.purpose!=='TEMPORARY_VALIDATION')throw new Error('TEMPORARY_VALIDATION_REQUIRED');
const provider=validationKeys(receipt),pool=new Pool({connectionString:connection,max:1}),evidencePath=receiptPath+'.p3-07-predecessor0200.json';
try{
 const identity=(await pool.query('select current_user role,current_database() database,d.oid::text oid,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls from pg_database d join pg_roles r on r.rolname=current_user where d.datname=current_database()')).rows[0]!;
 assert.equal(identity.database,receipt.name);assert.equal(identity.oid,receipt.oid);assert.match(identity.role,/^hdi_validation_[a-f0-9]{16}$/);
 assert.ok(!identity.rolsuper&&!identity.rolcreatedb&&!identity.rolcreaterole&&!identity.rolbypassrls);
 const installed=Number((await pool.query('select count(*)::integer n from vnext_control.migration')).rows[0]!.n);
 if(args[0]!=='--verify'){
  assert.equal(installed,p307PredecessorPrefix);
  await withP307Predecessor(async(directory:string,sourceReceipt:{sha256:string;loaderOverlay:unknown})=>{
   const load=(file:string)=>import(pathToFileURL(resolve(directory,file)).href);
   const {openCatalog:legacyOpenCatalog}=await load('apps/governance-api/src/modules/governance-catalog/index.ts') as {openCatalog:typeof openCatalog};
   const {locationFixture:legacyLocationFixture}=await load('tooling/vnext/p3-06-fixture.ts') as {locationFixture:typeof locationFixture};
   const {wardFixture:legacyWardFixture}=await load('tooling/vnext/p3-02-fixture.ts') as {wardFixture:typeof wardFixture};
   const {wardNursingFixture:legacyCoverageFixture}=await load('tooling/vnext/p3-05-fixture.ts') as {wardNursingFixture:typeof wardNursingFixture};
   const catalog=await legacyOpenCatalog(connection,provider);let locations:Awaited<ReturnType<typeof locationFixture>>|undefined,wards:Awaited<ReturnType<typeof wardFixture>>|undefined,coverage:Awaited<ReturnType<typeof wardNursingFixture>>|undefined;
   try{
    locations=await legacyLocationFixture(receipt,identity.role,catalog,provider,connection);
    const locationCampus=await locations.newCampus(),locationRequest=await locations.prepare(await locations.input(locationCampus,locations.tree(locationCampus))),locationRecovery=await recovery(locations.owner,locationRequest),locationId=locationRecovery.outcome.facts[3]!.id;
    const firstLocation=await locations.owner.history('maker',{id:locationId}),firstVersion=firstLocation.versions[0]!;
    const revised:LocationEntry={action:'REVISE',target:{owner:'location-master',id:locationId,expectedVersion:'1'},row:{...locations.row(locationCampus,'ROOM',firstVersion.facts.source.sourceAlias,firstVersion.facts.parentId!),location_code:firstVersion.facts.locationCode,location_name:'TEST pre0200 renamed room',room_number:'002',valid_from:'2027-03-01T00:00:00.000001'},reason:'TEST historical location preservation',evidenceId:locations.artifact.artifactId};
    await locations.apply(await locations.input(locationCampus,[revised]));
    const locationHistory=await locations.owner.history('maker',{id:locationId}),location=await capture(locations.owner,locationId,locationHistory.versions.map(version=>version.recordedAt),['2026-04-01T00:00:00','2027-03-01T00:00:00.000001']);
    // The published cold fixture establishes original service/transport facts;
    // reuse those through its own archived Owners for the Nursing chain.
    wards=await legacyWardFixture(receipt,identity.role,catalog,provider,connection,false);
    coverage=await legacyCoverageFixture(receipt,identity.role,catalog,provider,connection,false,wards);
    const scope=await coverage.endpoint(),entry=coverage.entry(scope),coverageRequest=await coverage.prepare(await coverage.input([entry])),coverageRecovery=await recovery(coverage.owner,coverageRequest),coverageId=coverageRecovery.outcome.facts[0]!.id,cutover='2030-04-01T00:00:00.000001';
    const ending:WardNursingEntry={...entry,action:'END',target:{owner:'care-organization/ward-nursing-coverage',id:coverageId,expectedHead:'1'},endAt:cutover,row:{...entry.row,record_status:'RETIRED'}};
    await coverage.apply(await coverage.input([ending]));
    const wardHistory=await wards.owner.history('maker',{id:scope.ward.id}),unitId=wardHistory.bindings[0]!.managingUnitId,unitHistory=await wards.base.owner.history('maker',{id:unitId}),departmentId=unitHistory.departmentId;
    const nursingHistory=await coverage.nursing.owner.history('maker',{id:scope.nursing.id}),coverageHistory=await coverage.owner.history('maker',{id:coverageId});
    const departmentExact=await wards.base.department.exact('maker',{id:departmentId,version:'1'});
    const department=await capture(departmentReader(wards.base.department),departmentId,[departmentExact.recordedAt],['2026-04-01T00:00:00'],{campus:'NORTH'});
    const unit=await capture(wards.base.owner,unitId,unitHistory.versions.map(version=>version.recordedAt),['2026-04-01T00:00:00']);
    const ward=await capture(wards.owner,scope.ward.id,wardHistory.versions.map(version=>version.recordedAt),['2026-04-01T00:00:00']);
    const nursing=await capture(coverage.nursing.owner,scope.nursing.id,nursingHistory.versions.map(version=>version.recordedAt),['2026-04-01T00:00:00']);
    const originalCoverage=await capture(coverage.owner,coverageId,coverageHistory.versions.map(version=>version.recordedAt),['2030-03-31T23:59:59.999999',cutover]);
    assert.equal(location.history.versions.length,2);assert.equal(originalCoverage.history.versions.length,2);assert.equal(originalCoverage.history.versions[1]!.action,'END');
    assert.equal(location.queries[1]!.result.version!.facts.roomNumber,'001');assert.equal(location.queries[3]!.result.version!.facts.roomNumber,'002');
    assert.equal(department.queries[0]!.result.businessState,'ACTIVE');
    for(const original of [unit,ward,nursing])assert.equal(original.queries[0]!.result.state,'ACTIVE');
    assert.equal(originalCoverage.queries[1]!.result.state,'ACTIVE');assert.equal(originalCoverage.queries[3]!.result.state,'ENDED');
    for(const original of [location,unit,ward,nursing,originalCoverage])assert.notEqual(original.id,original.history.versions[0]!.facts.source.sourceAlias);
    const evidence:PredecessorEvidence={gate:'P3_07_POPULATED_0200',baseline:p307PredecessorBaseline,prefix:p307PredecessorPrefix,oid:receipt.oid,sourceSha256:sourceReceipt.sha256,sourceLoaderOverlay:sourceReceipt.loaderOverlay,location,department,unit,ward,nursing,coverage:originalCoverage,recoveries:{location:locationRecovery,coverage:coverageRecovery}};
    writeFileSync(evidencePath,JSON.stringify({...evidence,originalOwners:true,restrictedApplicationRole:true,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',clinicalReadiness:'NOT_READY',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});
    console.log(JSON.stringify({gate:evidence.gate,status:'PASS',baseline:evidence.baseline,prefix:p307PredecessorPrefix,realOriginalOwners:['Location','Department','Unit','Ward','Nursing','WardNursingCoverage'],originalCatalogOutcomes:2,evidence:evidencePath}));
   }finally{await coverage?.close();await wards?.close();await locations?.owner.close();await locations?.campus.close();await catalog.close();}
  },receipt);
 }else{
  assert.equal(installed,migrationFiles().length);assert.ok(installed>p307PredecessorPrefix);
  const prior=JSON.parse(readFileSync(evidencePath,'utf8')) as PredecessorEvidence;
  assert.equal(prior.gate,'P3_07_POPULATED_0200');assert.equal(prior.baseline,p307PredecessorBaseline);assert.equal(prior.prefix,p307PredecessorPrefix);assert.equal(prior.oid,receipt.oid);
  const catalog=await openCatalog(connection,provider),campus=openCampus(connection,provider),location=openLocation(connection,provider,campus.references),department=openDepartment(connection,provider),lifecycle=openDepartmentLifecycle(connection,provider),operating=openOperatingRelations(connection,provider);
  const units=openBusinessUnit(connection,provider,{departmentCoverage:lifecycle.readUnitBindingCoverageInTransaction,departmentBoundaries:lifecycle.readUnitBindingBoundariesInTransaction,referenceAccess:lifecycle.authorizeUnitReferenceInTransaction,operatingWindow:operating.evaluateOperatingWindowInTransaction}),ward=openWard(connection,provider,wardUpstreamPorts(units)),nursing=openNursingUnit(connection,provider,nursingUpstreamPorts),coverage=openWardNursingCoverage(connection,provider,wardNursingUpstreamPorts(ward,nursing,units));
  try{
   await verifyCapture(location,prior.location);await verifyCapture(departmentReader(department),prior.department);await verifyCapture(units,prior.unit);await verifyCapture(ward,prior.ward);await verifyCapture(nursing,prior.nursing);await verifyCapture(coverage,prior.coverage);
   await verifyRecovery(location,prior.recoveries.location);await verifyRecovery(coverage,prior.recoveries.coverage);
   // Recovery must not modify or migrate the old domain histories.
   await verifyCapture(location,prior.location);await verifyCapture(coverage,prior.coverage);
   const verifiedPath=receiptPath+'.p3-07-original0200-verification.json';
   writeFileSync(verifiedPath,JSON.stringify({gate:'P3_07_ORIGINAL_0200_RECOVERY',status:'PASS',baseline:p307PredecessorBaseline,oid:receipt.oid,currentPrefix:installed,restrictedApplicationRole:true,currentComposedPublicOwners:true,originalHistoriesPreserved:true,originalExactVersionsPreserved:true,originalBRQueriesPreserved:true,originalCatalogOutcomesPreserved:true,accurateReplay:true,resumePreserved:true,reconcile:'MATCHED',currentOutsiderDenied:true,noPostUpgradeFixtures:true,predecessorEvidence:evidencePath,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',clinicalReadiness:'NOT_READY',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});
   console.log(JSON.stringify({gate:'P3_07_ORIGINAL_0200_RECOVERY',status:'PASS',evidence:verifiedPath}));
  }finally{await coverage.close();await nursing.close();await ward.close();await units.close();await operating.close();await lifecycle.close();await department.close();await location.close();await campus.close();await catalog.close();}
 }
}finally{await pool.end();}
