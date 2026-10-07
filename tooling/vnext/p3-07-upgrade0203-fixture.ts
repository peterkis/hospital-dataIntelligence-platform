import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {validationKeys} from './p3-07-validation-keys.mjs';
import {withP307Predecessor0203,p307Predecessor0203Baseline,p307Predecessor0203Prefix} from './p3-07-predecessor0203.mjs';
import {migrationFiles,readReceipt} from './lineage.mjs';
import {openCatalog,type Catalog,type HistoryRow,type UnitOutcome} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openCampus,openOperatingRelations} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {openDepartment,openDepartmentLifecycle} from '../../apps/governance-api/src/modules/department-master/index.js';
import {openBusinessUnit,openWard,openNursingUnit} from '../../apps/governance-api/src/modules/care-organization/index.js';
import {openLocation,openLocationUse,openLocationUsageTypes,type LocationUseEntry} from '../../apps/governance-api/src/modules/location-master/index.js';
import type {UsageTypeItem,UsageTypeCommand} from '../../apps/governance-api/src/modules/location-master/usage-type-contracts.js';
import {wardUpstreamPorts} from '../../apps/governance-api/src/composition/ward-dependencies.js';
import {nursingUpstreamPorts} from '../../apps/governance-api/src/composition/nursing-unit-dependencies.js';
import {locationUseUpstreamPorts} from '../../apps/governance-api/src/composition/location-use-dependencies.js';
import type {locationUseFixture} from './p3-07-fixture.js';

type Query={id:string;businessAt:string;recordAsOf:string;campus?:'NORTH'|'SOUTH'};
type Request={candidateId:string;requestId:string};
interface ReadOwner<H,E,Q>{history(actor:string,input:{id:string;recordAsOf?:string}):Promise<H>;exact(actor:string,input:{id:string;version:string;recordAsOf?:string}):Promise<E>;read(actor:string,input:Query):Promise<Q>}
interface Captured<H,E,Q>{id:string;history:H;exact:E;recordHistories:Array<{input:{id:string;recordAsOf:string};result:H}>;queries:Array<{input:Query;result:Q}>}
type CaptureFor<O extends ReadOwner<unknown,unknown,unknown>>=Captured<Awaited<ReturnType<O['history']>>,Awaited<ReturnType<O['exact']>>,Awaited<ReturnType<O['read']>>>;
type UseOwner=ReturnType<typeof openLocationUse>;
type DictionaryOwner=ReturnType<typeof openLocationUsageTypes>;
const departmentReader=(owner:ReturnType<typeof openDepartment>)=>({history:(actor:string,input:{id:string;recordAsOf?:string})=>owner.history(actor,input.id,input.recordAsOf),exact:owner.exact,read:(actor:string,input:Query)=>owner.read(actor,{...input,campus:input.campus??'NORTH'})});
interface Recovery{request:Request;applied:Awaited<ReturnType<UseOwner['applyUnit']>>;outcome:UnitOutcome;reconcile:'MATCHED'}
type DictionaryQuery={id:string;versionId?:string;recordAsOf?:string};
interface DictionaryReplay{actor:'maker'|'reviewer';command:UsageTypeCommand;result:UsageTypeItem}
interface DictionaryCapture{id:string;initialVersionId:string;history:UsageTypeItem[];exact:UsageTypeItem;reads:Array<{query:DictionaryQuery;result:UsageTypeItem}>;replays:DictionaryReplay[]}
type Window=Parameters<UseOwner['evaluateWindow']>[1];
interface RelationCapture{kind:'ORG'|'WARD'|'NURSING';facts:CaptureFor<UseOwner>;recoveries:Recovery[];windows:Array<{input:Window;result:Awaited<ReturnType<UseOwner['evaluateWindow']>>}>}
interface Evidence{
 gate:'P3_07_POPULATED_0203';baseline:string;prefix:203;oid:string;sourceSha256:string;sourceLoaderOverlay:unknown;originalMigrationDigests:Array<{id:string;sha256:string}>;keyDigest:string;
 catalog:{dataset:{id:string;history:HistoryRow[]};source:{id:string;history:HistoryRow[]}};
 masters:{location:CaptureFor<ReturnType<typeof openLocation>>;department:CaptureFor<ReturnType<typeof departmentReader>>;unit:CaptureFor<ReturnType<typeof openBusinessUnit>>;ward:CaptureFor<ReturnType<typeof openWard>>;nursing:CaptureFor<ReturnType<typeof openNursingUnit>>};
 dictionaries:DictionaryCapture[];relations:RelationCapture[];
}

async function capture<H,E,Q>(owner:ReadOwner<H,E,Q>,id:string,recordTimes:string[],businessTimes:string[],queryContext:Pick<Query,'campus'>={}):Promise<Captured<H,E,Q>>{
 const recordHistories:Captured<H,E,Q>['recordHistories']=[],queries:Captured<H,E,Q>['queries']=[];
 for(const recordAsOf of [...new Set(recordTimes)]){const input={id,recordAsOf};recordHistories.push({input,result:await owner.history('maker',input)});for(const businessAt of businessTimes){const query={id,businessAt,recordAsOf,...queryContext};queries.push({input:query,result:await owner.read('maker',query)});}}
 return {id,history:await owner.history('maker',{id}),exact:await owner.exact('maker',{id,version:'1'}),recordHistories,queries};
}
async function verifyCapture<H,E,Q>(owner:ReadOwner<H,E,Q>,original:Captured<H,E,Q>){
 assert.deepEqual(await owner.history('maker',{id:original.id}),original.history);assert.deepEqual(await owner.exact('maker',{id:original.id,version:'1'}),original.exact);
 for(const known of original.recordHistories)assert.deepEqual(await owner.history('maker',known.input),known.result);for(const query of original.queries)assert.deepEqual(await owner.read('maker',query.input),query.result);
}
async function recover(owner:UseOwner,request:Request):Promise<Recovery>{
 const applied=await owner.applyUnit('maker',request);assert.equal(applied.status,'COMMITTED');const outcome=await owner.resumeOutcome('maker',request);if(!outcome)throw new Error('PREDECESSOR_COMMITTED_OUTCOME_REQUIRED');assert.deepEqual(await owner.applyUnit('maker',request),applied);assert.equal((await owner.reconcileCommittedUnit('maker',request)).status,'MATCHED');return {request,applied,outcome,reconcile:'MATCHED'};
}
async function verifyRecovery(owner:UseOwner,original:Recovery){assert.deepEqual(await owner.applyUnit('maker',original.request),original.applied);assert.deepEqual(await owner.resumeOutcome('maker',original.request),original.outcome);assert.equal((await owner.reconcileCommittedUnit('maker',original.request)).status,'MATCHED');await assert.rejects(owner.resumeOutcome('outsider',original.request),/ACCESS_DENIED/);}
async function dictionaryCapture(owner:DictionaryOwner,initial:UsageTypeItem,recordTimes:string[],replays:DictionaryReplay[]):Promise<DictionaryCapture>{
 const reads:DictionaryCapture['reads']=[];for(const recordAsOf of [...new Set(recordTimes)]){const query={id:initial.id,recordAsOf};reads.push({query,result:await owner.read('maker',query)});}
 return {id:initial.id,initialVersionId:initial.versionId,history:await owner.history('maker',{id:initial.id}),exact:await owner.read('maker',{id:initial.id,versionId:initial.versionId}),reads,replays};
}
async function verifyDictionary(owner:DictionaryOwner,original:DictionaryCapture){
 assert.deepEqual(await owner.history('maker',{id:original.id}),original.history);assert.deepEqual(await owner.read('maker',{id:original.id,versionId:original.initialVersionId}),original.exact);for(const read of original.reads)assert.deepEqual(await owner.read('maker',read.query),read.result);for(const replay of original.replays)assert.deepEqual(await owner.command(replay.actor,replay.command),replay.result);await assert.rejects(owner.read('outsider',{id:original.id}),/ACCESS_DENIED/);
}
async function catalogCapture(catalog:Catalog,id:string){return {id,history:await catalog.history('maker','SYNTHETIC',id)};}

const args=process.argv.slice(2);if(args.length>1||(args.length===1&&args[0]!=='--verify'))throw new Error('CLOSED_COMMAND_REQUIRED');
const connection=process.env['VNEXT_VALIDATION_OWNER_URL'],receiptPath=process.env['VNEXT_TEST_RECEIPT'];if(!connection||!receiptPath)throw new Error('VALIDATION_ENVIRONMENT_REQUIRED');
const receipt=readReceipt(receiptPath);if(receipt.taskId!=='P3-07'||receipt.purpose!=='TEMPORARY_VALIDATION')throw new Error('TEMPORARY_VALIDATION_REQUIRED');
const provider=validationKeys(receipt),pool=new Pool({connectionString:connection,max:1}),evidencePath=receiptPath+'.p3-07-predecessor0203.json',keysPath=resolve('.runtime/vnext/p3-07',receipt.name+'.secret.json');
const keyDigest=()=>{if(lstatSync(keysPath).isSymbolicLink())throw new Error('KEY_RECEIPT_MISMATCH');return createHash('sha256').update(readFileSync(keysPath)).digest('hex');};
try{
 const identity=(await pool.query('select current_user role,current_database() database,d.oid::text oid,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls from pg_database d join pg_roles r on r.rolname=current_user where d.datname=current_database()')).rows[0]!;
 assert.equal(identity.database,receipt.name);assert.equal(identity.oid,receipt.oid);assert.match(identity.role,/^hdi_validation_[a-f0-9]{16}$/);assert.ok(!identity.rolsuper&&!identity.rolcreatedb&&!identity.rolcreaterole&&!identity.rolbypassrls);
 const ledger=(await pool.query<{id:string;sha256:string}>('select id,sha256 from vnext_control.migration order by id')).rows,installed=ledger.length;
 if(args[0]!=='--verify'){
  assert.equal(installed,p307Predecessor0203Prefix);
  await withP307Predecessor0203(async(directory:string,sourceReceipt:{sha256:string;loaderOverlay:unknown;migrationDigests:Array<{id:string;sha256:string}>})=>{
   assert.deepEqual(ledger,sourceReceipt.migrationDigests);
   const load=(file:string)=>import(pathToFileURL(resolve(directory,file)).href),{openCatalog:legacyCatalog}=await load('apps/governance-api/src/modules/governance-catalog/index.ts') as {openCatalog:typeof openCatalog},{locationUseFixture:legacyFixture}=await load('tooling/vnext/p3-07-fixture.ts') as {locationUseFixture:typeof locationUseFixture};
   const catalog=await legacyCatalog(connection,provider);let fixture:Awaited<ReturnType<typeof locationUseFixture>>|undefined;
   try{
    fixture=await legacyFixture(receipt,identity.role,catalog,provider,connection);const f=fixture;
    const scopes={ORG:await f.endpoint('ORG'),WARD:await f.endpoint('WARD'),NURSING:await f.endpoint('NURSING')},relations:RelationCapture[]=[],originals=new Map<string,{entry:LocationUseEntry;recovery:Recovery;purpose:UsageTypeItem}>();
    for(const kind of ['ORG','WARD','NURSING'] as const){const scope=scopes[kind],base=await f.entry(scope,kind==='ORG'?{kind:'EXCLUSIVE',version:'WHOLE_LOCATION_V1'}:{kind:'SHARED',version:'WHOLE_LOCATION_V1'}),entry={...base,row:{...base.row,is_primary:kind==='ORG'?'Y' as const:'N' as const}},request=await f.prepare(await f.input([entry])),original=await recover(f.owner,request);originals.set(kind,{entry,recovery:original,purpose:await f.dictionary.read('maker',{id:scope.usageType.id})});}
    const org=originals.get('ORG')!,ward=originals.get('WARD')!,nursing=originals.get('NURSING')!,dictionaryReplays:DictionaryReplay[]=[];
    const disable:UsageTypeCommand={action:'DISABLE',requestId:randomUUID(),reason:'TEST original203 direct disable audit',target:org.purpose.id,expectedHead:org.purpose.head},disabled=await f.dictionary.command('maker',disable);dictionaryReplays.push({actor:'maker',command:disable,result:disabled});
    const enable:UsageTypeCommand={action:'ENABLE',requestId:randomUUID(),reason:'TEST original203 direct enable audit',target:org.purpose.id,expectedHead:disabled.head},enabled=await f.dictionary.command('maker',enable);dictionaryReplays.push({actor:'maker',command:enable,result:enabled});assert.ok(enabled.events.at(-1)!.recordedAt>disabled.events.at(-1)!.recordedAt);
    const revise:UsageTypeCommand={action:'REVISE',requestId:randomUUID(),reason:'TEST original203 independently reviewed rename',target:nursing.purpose.id,expectedHead:nursing.purpose.head,code:nursing.purpose.code,name:'TEST original203 renamed office purpose',meaning:nursing.purpose.meaning,description:'TEST same stable meaning',validFrom:nursing.purpose.validFrom,validTo:nursing.purpose.validTo,sourceId:nursing.purpose.sourceId,sourceVersionId:nursing.purpose.sourceVersionId,evidenceId:nursing.purpose.evidenceId},draft=await f.dictionary.command('maker',revise),renameReplays:DictionaryReplay[]=[{actor:'maker',command:revise,result:draft}];
    const verify:UsageTypeCommand={action:'VERIFY',requestId:randomUUID(),reason:'TEST original203 independent rename verification',target:draft.id,expectedHead:draft.head,versionId:draft.versionId,reviewDigest:draft.reviewDigest,evidenceId:draft.evidenceId,meaningAccepted:true},verified=await f.dictionary.command('reviewer',verify);renameReplays.push({actor:'reviewer',command:verify,result:verified});
    const approve:UsageTypeCommand={action:'APPROVE',requestId:randomUUID(),reason:'TEST original203 independent rename approval',target:draft.id,expectedHead:draft.head,versionId:draft.versionId,reviewDigest:draft.reviewDigest},renamed=await f.dictionary.command('reviewer',approve);renameReplays.push({actor:'reviewer',command:approve,result:renamed});
    assert.equal(renamed.id,nursing.purpose.id);assert.equal(renamed.code,nursing.purpose.code);assert.equal(renamed.meaning,nursing.purpose.meaning);assert.equal(renamed.version,'2');
    const pending:UsageTypeCommand={...revise,requestId:randomUUID(),reason:'TEST original203 retained unapproved dictionary draft',expectedHead:renamed.head,name:'TEST original203 pending name'},pendingDraft=await f.dictionary.command('maker',pending);renameReplays.push({actor:'maker',command:pending,result:pendingDraft});assert.equal(pendingDraft.status,'DRAFT');
    const wardId=ward.recovery.outcome.facts[0]!.id,reduction:LocationUseEntry={...ward.entry,action:'REVISE',target:{owner:'location-master/location-use',id:wardId,expectedHead:'1'},row:{...ward.entry.row,valid_to:'2030-06-01T00:00:00.000001'}},reduced=await recover(f.owner,await f.prepare(await f.input([reduction])));
    const ending:LocationUseEntry={...reduction,action:'END',target:{owner:'location-master/location-use',id:wardId,expectedHead:'2'},endAt:'2030-04-01T00:00:00.000001',row:{...reduction.row,record_status:'RETIRED'}},ended=await recover(f.owner,await f.prepare(await f.input([ending])));
    for(const kind of ['ORG','WARD','NURSING'] as const){
     const original=originals.get(kind)!,id=original.recovery.outcome.facts[0]!.id,history=await f.owner.history('maker',{id}),facts=await capture(f.owner,id,history.versions.map(version=>version.recordedAt),['2026-02-01T00:00:00','2030-05-01T00:00:00','2031-01-01T00:00:00']),recoveries=kind==='WARD'?[original.recovery,reduced,ended]:[original.recovery],windows:RelationCapture['windows']=[];
     for(const recordAsOf of new Set([original.recovery.outcome.recordedAt,history.versions.at(-1)!.recordedAt,ended.outcome.recordedAt])){const input:Window={id,validFrom:'2026-01-01T00:00:00',validTo:'2026-04-01T00:00:00',mode:'HISTORICAL',recordAsOf},result=await f.owner.evaluateWindow('maker',input);assert.equal(result.currentAdmissionCovered,true);windows.push({input,result});}
     if(kind==='ORG'){const input:Window={id,validFrom:disabled.events.at(-1)!.recordedAt,validTo:enabled.events.at(-1)!.recordedAt,mode:'HISTORICAL',recordAsOf:enabled.events.at(-1)!.recordedAt};const result=await f.owner.evaluateWindow('maker',input);assert.equal(result.currentAdmissionCovered,false);windows.push({input,result});}
     assert.notEqual(id,facts.history.versions[0]!.facts.source.sourceAlias);relations.push({kind,facts,recoveries,windows});
    }
    assert.equal(relations.find(relation=>relation.kind==='WARD')!.facts.history.versions.length,3);
    const wardMaster=await f.wards.owner.history('maker',{id:scopes.WARD.target.id}),unitId=wardMaster.bindings[0]!.managingUnitId,unitMaster=await f.base.owner.history('maker',{id:unitId}),locationMaster=await f.locations.owner.history('maker',{id:scopes.ORG.location.id}),nursingMaster=await f.nursing.owner.history('maker',{id:scopes.NURSING.target.id}),departmentExact=await f.base.department.exact('maker',{id:scopes.ORG.target.id,version:'1'});
    const masters:Evidence['masters']={location:await capture(f.locations.owner,locationMaster.id,locationMaster.versions.map(version=>version.recordedAt),['2026-02-01T00:00:00']),department:await capture(departmentReader(f.base.department),scopes.ORG.target.id,[departmentExact.recordedAt],['2026-02-01T00:00:00'],{campus:'NORTH'}),unit:await capture(f.base.owner,unitMaster.id,unitMaster.versions.map(version=>version.recordedAt),['2026-02-01T00:00:00']),ward:await capture(f.wards.owner,wardMaster.id,wardMaster.versions.map(version=>version.recordedAt),['2026-02-01T00:00:00']),nursing:await capture(f.nursing.owner,nursingMaster.id,nursingMaster.versions.map(version=>version.recordedAt),['2026-02-01T00:00:00'])};
    for(const master of [masters.location,masters.unit,masters.ward,masters.nursing])assert.equal(master.queries[0]!.result.state,'ACTIVE');assert.equal(masters.department.queries[0]!.result.businessState,'ACTIVE');
    const dictionaries=[await dictionaryCapture(f.dictionary,org.purpose,[org.purpose.approvedAt!,disabled.events.at(-1)!.recordedAt,enabled.events.at(-1)!.recordedAt],dictionaryReplays),await dictionaryCapture(f.dictionary,ward.purpose,[ward.purpose.approvedAt!],[]),await dictionaryCapture(f.dictionary,nursing.purpose,[nursing.purpose.approvedAt!,renamed.approvedAt!,pendingDraft.recordedAt],renameReplays)];
    const evidence:Evidence={gate:'P3_07_POPULATED_0203',baseline:p307Predecessor0203Baseline,prefix:203,oid:receipt.oid,sourceSha256:sourceReceipt.sha256,sourceLoaderOverlay:sourceReceipt.loaderOverlay,originalMigrationDigests:ledger,keyDigest:keyDigest(),catalog:{dataset:await catalogCapture(catalog,f.dataset.id),source:await catalogCapture(catalog,f.source.id)},masters,dictionaries,relations};
    writeFileSync(evidencePath,JSON.stringify({...evidence,originalPublicOwners:true,restrictedApplicationRole:true,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',clinicalReadiness:'NOT_READY',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});
    console.log(JSON.stringify({gate:evidence.gate,status:'PASS',baseline:evidence.baseline,prefix:203,originalDictionaryIdentities:3,originalLocationUseIdentities:3,originalCommittedCatalogUnits:5,originalMasterIdentities:5,unapprovedDraftRetained:true,evidence:evidencePath}));
   }finally{await fixture?.close();await catalog.close();}
  },receipt);
 }else{
  assert.equal(installed,204);assert.equal(migrationFiles().length,204);const prior=JSON.parse(readFileSync(evidencePath,'utf8')) as Evidence;assert.equal(prior.gate,'P3_07_POPULATED_0203');assert.equal(prior.baseline,p307Predecessor0203Baseline);assert.equal(prior.prefix,203);assert.equal(prior.oid,receipt.oid);assert.deepEqual(ledger.slice(0,203),prior.originalMigrationDigests);assert.equal(keyDigest(),prior.keyDigest);
  const catalog=await openCatalog(connection,provider),campus=openCampus(connection,provider),location=openLocation(connection,provider,campus.references),department=openDepartment(connection,provider),lifecycle=openDepartmentLifecycle(connection,provider),operating=openOperatingRelations(connection,provider),units=openBusinessUnit(connection,provider,{departmentCoverage:lifecycle.readUnitBindingCoverageInTransaction,departmentBoundaries:lifecycle.readUnitBindingBoundariesInTransaction,referenceAccess:lifecycle.authorizeUnitReferenceInTransaction,operatingWindow:operating.evaluateOperatingWindowInTransaction}),ward=openWard(connection,provider,wardUpstreamPorts(units)),nursing=openNursingUnit(connection,provider,nursingUpstreamPorts),dictionary=openLocationUsageTypes(connection,provider),owner=openLocationUse(connection,provider,locationUseUpstreamPorts(location,lifecycle,units,ward,nursing),dictionary);
  try{
   assert.deepEqual(await catalogCapture(catalog,prior.catalog.dataset.id),prior.catalog.dataset);assert.deepEqual(await catalogCapture(catalog,prior.catalog.source.id),prior.catalog.source);
   await verifyCapture(location,prior.masters.location);await verifyCapture(departmentReader(department),prior.masters.department);await verifyCapture(units,prior.masters.unit);await verifyCapture(ward,prior.masters.ward);await verifyCapture(nursing,prior.masters.nursing);
   for(const original of prior.dictionaries)await verifyDictionary(dictionary,original);
   for(const original of prior.relations){await verifyCapture(owner,original.facts);for(const recorded of original.windows)assert.deepEqual(await owner.evaluateWindow('maker',recorded.input),recorded.result);for(const recovered of original.recoveries)await verifyRecovery(owner,recovered);await verifyCapture(owner,original.facts);}
   assert.equal(keyDigest(),prior.keyDigest);
   const verifiedPath=receiptPath+'.p3-07-original0203-verification.json';writeFileSync(verifiedPath,JSON.stringify({gate:'P3_07_ORIGINAL_0203_TO_0204_RECOVERY',status:'PASS',baseline:p307Predecessor0203Baseline,oid:receipt.oid,currentPrefix:204,restrictedApplicationRole:true,currentComposedPublicOwners:true,originalDictionaryHistoriesPreserved:true,originalDictionaryContentVersionsPreserved:true,originalLifecycleEventsPreserved:true,originalDictionaryCommandReplayPreserved:true,originalLocationUseHistoriesPreserved:true,originalExactVersionsPreserved:true,originalBRQueriesPreserved:true,originalQualificationWindowsPreserved:true,originalCatalogOutcomesPreserved:true,originalMasterHistoriesPreserved:true,originalCatalogHistoriesPreserved:true,original203LedgerPreserved:true,originalKeyBytesPreserved:true,accurateReplay:true,resumePreserved:true,reconcile:'MATCHED',currentOutsiderDenied:true,noPostUpgradeFixtures:true,keyDigest:prior.keyDigest,predecessorEvidence:evidencePath,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',clinicalReadiness:'NOT_READY',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});console.log(JSON.stringify({gate:'P3_07_ORIGINAL_0203_TO_0204_RECOVERY',status:'PASS',evidence:verifiedPath}));
  }finally{await owner.close();await dictionary.close();await nursing.close();await ward.close();await units.close();await operating.close();await lifecycle.close();await department.close();await location.close();await campus.close();await catalog.close();}
 }
}finally{await pool.end();}
