import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {validationKeys} from './p3-05-validation-keys.mjs';
import {withP305Predecessor,p305PredecessorBaseline} from './p3-05-predecessor.mjs';
import {migrationFiles,readReceipt} from './lineage.mjs';
import {openBusinessUnit,openWard,openNursingUnit,openUnitWardRelations} from '../../apps/governance-api/src/modules/care-organization/index.js';
import {openDepartmentLifecycle} from '../../apps/governance-api/src/modules/department-master/index.js';
import {openOperatingRelations} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {wardUpstreamPorts} from '../../apps/governance-api/src/composition/ward-dependencies.js';
import {nursingUpstreamPorts} from '../../apps/governance-api/src/composition/nursing-unit-dependencies.js';
import {unitWardUpstreamPorts} from '../../apps/governance-api/src/composition/unit-ward-dependencies.js';

const args=process.argv.slice(2);if(args.length>1||(args.length===1&&args[0]!=='--verify'))throw new Error('CLOSED_COMMAND_REQUIRED');
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receiptPath=process.env['VNEXT_TEST_RECEIPT']!;
if(!connection||!receiptPath)throw new Error('VALIDATION_ENVIRONMENT_REQUIRED');
const receipt=readReceipt(receiptPath),provider=validationKeys(receipt),pool=new Pool({connectionString:connection,max:1}),evidencePath=receiptPath+'.p3-05-predecessor.json';
try{
 const identity=(await pool.query('select current_user role,current_database() database,d.oid::text oid,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls from pg_database d join pg_roles r on r.rolname=current_user where d.datname=current_database()')).rows[0]!;
 assert.equal(identity.database,receipt.name);assert.equal(identity.oid,receipt.oid);assert.match(identity.role,/^hdi_validation_[a-f0-9]{16}$/);
 assert.ok(!identity.rolsuper&&!identity.rolcreatedb&&!identity.rolcreaterole&&!identity.rolbypassrls);
 const installed=Number((await pool.query('select count(*)::integer n from vnext_control.migration')).rows[0]!.n);
 if(args[0]==='--verify'){
  assert.equal(installed,migrationFiles().length);const prior=JSON.parse(readFileSync(evidencePath,'utf8'));
  assert.equal(prior.gate,'P3_05_POPULATED_0196');assert.equal(prior.baseline,p305PredecessorBaseline);assert.equal(prior.prefix,196);assert.equal(prior.oid,receipt.oid);
  for(const [kind,procedure] of [['ward','care_organization.ward_snapshot'],['nursing','care_organization.nursing_snapshot'],['unitWard','care_organization.unit_ward_snapshot']] as const){
   const preserved=(await pool.query(`select ${procedure}($1,$2::uuid) history`,['maker',prior[kind].history.id])).rows[0]!.history;
   assert.deepEqual(preserved,prior[kind].history,`Original0196 ${kind} history changed`);
  }
  // Exercise the current public Owners with their real composition ports. This
  // performs reads only and does not manufacture fresh post-upgrade fixtures.
  const lifecycle=openDepartmentLifecycle(connection,provider),operating=openOperatingRelations(connection,provider),units=openBusinessUnit(connection,provider,{departmentCoverage:lifecycle.readUnitBindingCoverageInTransaction,departmentBoundaries:lifecycle.readUnitBindingBoundariesInTransaction,referenceAccess:lifecycle.authorizeUnitReferenceInTransaction,operatingWindow:operating.evaluateOperatingWindowInTransaction}),ward=openWard(connection,provider,wardUpstreamPorts(units)),nursing=openNursingUnit(connection,provider,nursingUpstreamPorts),relations=openUnitWardRelations(connection,provider,unitWardUpstreamPorts(units,ward));
  try{
   for(const check of [{kind:'ward',owner:ward},{kind:'nursing',owner:nursing},{kind:'unitWard',owner:relations}]){
    const original=prior[check.kind];assert.deepEqual(await check.owner.history('maker',{id:original.history.id}),original.history);assert.deepEqual(await check.owner.exact('maker',{id:original.history.id,version:'1'}),original.exact);assert.deepEqual(await check.owner.read('maker',original.queryRequest),original.query);
   }
  }finally{await relations.close();await nursing.close();await ward.close();await units.close();await operating.close();await lifecycle.close();}
  console.log(JSON.stringify({gate:'P3_05_ORIGINAL_0196_HISTORIES',status:'PASS',restrictedApplicationRole:true,currentPublicOwners:true,realUpstreamPorts:true,exactHistoriesPreserved:true,originalExactVersionsPreserved:true,originalBusinessRecordQueriesPreserved:true,baseline:p305PredecessorBaseline,evidence:evidencePath}));
 }else{
  assert.equal(installed,196);
  await withP305Predecessor(async(directory:string,sourceReceipt:{sha256:string})=>{
   const load=(file:string)=>import(pathToFileURL(resolve(directory,file)).href);
   const {openCatalog}=await load('apps/governance-api/src/modules/governance-catalog/index.ts');
   const {nursingFixture}=await load('tooling/vnext/p3-03-fixture.ts') as typeof import('./p3-03-fixture.js'),{unitWardFixture}=await load('tooling/vnext/p3-04-fixture.ts') as typeof import('./p3-04-fixture.js');
   const catalog=await openCatalog(connection,provider);let nursing:Awaited<ReturnType<typeof nursingFixture>>|undefined,relations:Awaited<ReturnType<typeof unitWardFixture>>|undefined;
   try{
    nursing=await nursingFixture(receipt,identity.role,catalog,provider,connection);
    const nursingBinding=await nursing.endpoint(),nursingOut=await nursing.apply(await nursing.input([nursing.entry(nursingBinding)]));
    relations=await unitWardFixture(receipt,identity.role,catalog,provider,connection,true);
    const relationScope=await relations.endpoint(),entry=relations.entry(relationScope),relationOut=await relations.apply(await relations.input([entry])),relationId=relationOut.facts[0]!.id;
    await relations.apply(await relations.input([{...entry,action:'END',target:{owner:'care-organization/unit-ward-relation',id:relationId,expectedHead:'1'},endAt:'2026-03-01T00:00:00.000001',row:{...entry.row,record_status:'RETIRED'}}]));
    const wardHistory=await relations.wards.owner.history('maker',{id:relationScope.ward.id}),nursingHistory=await nursing.owner.history('maker',{id:nursingOut.facts[0]!.id}),unitWardHistory=await relations.owner.history('maker',{id:relationId});
    for(const history of [wardHistory,nursingHistory,unitWardHistory])assert.notEqual(history.id,history.versions[0]!.facts.source.sourceAlias);
    assert.equal(unitWardHistory.versions.length,2);assert.equal(unitWardHistory.versions[1]!.action,'END');
    const capture=async<H extends {id:string},E,Q>(owner:{exact:(actor:string,input:{id:string;version:string})=>Promise<E>;read:(actor:string,input:{id:string;businessAt:string;recordAsOf:string})=>Promise<Q>},history:H,recordAsOf:string)=>{const queryRequest={id:history.id,businessAt:'2026-04-01T00:00:00',recordAsOf};return {history,exact:await owner.exact('maker',{id:history.id,version:'1'}),queryRequest,query:await owner.read('maker',queryRequest)};};
    const ward=await capture(relations.wards.owner,wardHistory,wardHistory.versions[0]!.recordedAt),nursingFact=await capture(nursing.owner,nursingHistory,nursingOut.recordedAt),unitWard=await capture(relations.owner,unitWardHistory,relationOut.recordedAt);
    assert.equal(ward.query.state,'ACTIVE');assert.equal(nursingFact.query.state,'ACTIVE');assert.equal(unitWard.query.state,'ACTIVE');
    writeFileSync(evidencePath,JSON.stringify({gate:'P3_05_POPULATED_0196',baseline:p305PredecessorBaseline,prefix:196,oid:receipt.oid,sourceSha256:sourceReceipt.sha256,ward,nursing:nursingFact,unitWard,identities:{ward:wardHistory.id,nursing:nursingHistory.id,unitWard:unitWardHistory.id},originalOwners:true,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',clinicalReadiness:'NOT_READY',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});
    console.log(JSON.stringify({gate:'P3_05_POPULATED_0196',status:'PASS',realWard:wardHistory.id,realNursing:nursingHistory.id,realUnitWard:unitWardHistory.id,realOwners:true,sourceBaseline:p305PredecessorBaseline,evidence:evidencePath}));
   }finally{await relations?.close();await nursing?.close();await catalog.close();}
  });
 }
}finally{await pool.end();}
