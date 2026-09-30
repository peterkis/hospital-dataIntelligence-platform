import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {peer,identitySQL,quote} from './lineage.mjs';
import {ORGANIZATION_MAPPING_FUNCTIONS,assertOrganizationMappingsProvisioned} from './organization-mapping-provisioning.mjs';
import {openCatalog,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {openOrganizationMappings} from '../../apps/governance-api/src/modules/department-master/index.ts';
import {persistentOrganizationMappingFixture} from './p2-03-persistent-fixture.ts';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts';
import {createOrganizationMappingClient} from '../../packages/generated-api-client/src/index.ts';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const deployment=await prepareWorkspaceDeployment({evidenceTask:'p2-03'}),{receipt,connection,provider,evidence}=deployment;
const service=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));
peer(receipt.name,identitySQL(receipt)+` BEGIN;SELECT pg_advisory_xact_lock(901002);DO $$ BEGIN IF (SELECT oid::text FROM pg_roles WHERE rolname=${quote(service.role)}) IS DISTINCT FROM ${quote(service.roleOid)} THEN RAISE EXCEPTION 'OWNER_ROLE_IDENTITY_MISMATCH';END IF;END $$;
 GRANT EXECUTE ON FUNCTION ${ORGANIZATION_MAPPING_FUNCTIONS.map(f=>'department_master.'+f).join(',')} TO ${service.role};COMMIT;`);
const key=planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{});
peer(receipt.name,identitySQL(receipt)+` DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM vnext_control.department_write_authority WHERE key_hex=${quote(key)}) THEN RAISE EXCEPTION 'KEY_RECEIPT_MISMATCH';END IF;END $$;`,{sensitive:true});
mkdirSync('.runtime/vnext/p2-03/http-requests',{recursive:true});
function saved(name,value){
 const path='.runtime/vnext/p2-03/http-requests/'+name+'.json';
 try{const prior=JSON.parse(readFileSync(path,'utf8'));assert.equal(prior.databaseOid,receipt.oid);assert.equal(prior.databaseRequestId,receipt.requestId);return prior.value;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 writeFileSync(path,JSON.stringify({databaseOid:receipt.oid,databaseRequestId:receipt.requestId,value}),{flag:'wx'});return value;
}
const requestId=name=>saved(name+'.request',randomUUID()),freeze=(name,value)=>saved(name+'.command',value);
const catalog=await openCatalog(connection,provider),owner=openOrganizationMappings(connection,provider);let app;
try{
 const statePath='.runtime/vnext/p2-03/http-state.json';let state;
 try{state=JSON.parse(readFileSync(statePath,'utf8'));assert.equal(state.databaseOid,receipt.oid);assert.equal(state.databaseRequestId,receipt.requestId);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!state){
  const f=await persistentOrganizationMappingFixture(receipt,catalog,provider,connection,requestId,freeze);
  const staged=await owner.stage('maker',f.input);
  await owner.verify('reviewer',{requestId:requestId('verify'),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'SYNTHETIC persistent mapping verification',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}]});
  const applyRequest=requestId('apply'),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId:applyRequest});
  state={databaseOid:receipt.oid,databaseRequestId:receipt.requestId,requestId:applyRequest,candidate,binding:f.binding,row:f.input.entries[0].row};writeFileSync(statePath,JSON.stringify(state,null,2),{flag:'wx'});
 }
 const provisionPath='.runtime/vnext/p2-03/provisioning.json';
 try{const prior=JSON.parse(readFileSync(provisionPath,'utf8'));assert.deepEqual(prior,state.binding);}catch(error){if(error.code!=='ENOENT')throw error;writeFileSync(provisionPath,JSON.stringify(state.binding,null,2),{flag:'wx'});}
 await assertOrganizationMappingsProvisioned(connection,provider,state.binding);
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 const url=await app.listen({host:'127.0.0.1',port:0}),maker=createOrganizationMappingClient(url,'maker'),reviewer=createOrganizationMappingClient(url,'reviewer'),command={candidateId:state.candidate.candidateId,requestId:state.requestId};
 const resumed=await maker.resume(command);assert.equal(resumed.response.status,200);
 if(!resumed.data){assert.equal((await reviewer.review({candidateId:state.candidate.candidateId})).response.status,200);assert.equal((await reviewer.approve(state.candidate)).response.status,200);}
 const applied=await maker.apply(command);assert.equal(applied.response.status,200);assert.equal(applied.data.status,'COMMITTED');
 const replay=await maker.apply(command);assert.equal(replay.response.status,200);assert.deepEqual(replay.data,applied.data);
 const id=applied.data.facts[0].id,history=await maker.history({id});assert.equal(history.response.status,200);assert.equal(history.data.versions.length,1);
 const resolved=await maker.resolve({fromSystemId:state.row.from_system_id,sourceEntityType:state.row.source_entity_type,sourceCode:state.row.source_code,sourceContext:state.row.source_context,campus:'NORTH',businessAt:'2026-03-01T00:00:00'});assert.equal(resolved.response.status,200);assert.equal(resolved.data.mappingId,id);
 assert.equal((await createOrganizationMappingClient(url,'outsider').list({campus:'NORTH'})).response.status,403);
 await deployment.complete();
 const output=evidence+'.http.json';writeFileSync(output,JSON.stringify({status:'PASS',gate:'P2-03-PERSISTENT-HTTP',databaseOid:receipt.oid,mappingId:id,candidateId:state.candidate.candidateId,independentApproval:true,atomicApply:true,replaySameFacts:true,history:true,exactResolution:true,outsiderDenied:true,authorization:'EXPLICIT_SYNTHETIC_ACTORS',hospitalPolicy:'NOT_ADOPTED',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});console.log(JSON.stringify({status:'PASS',gate:'P2-03-PERSISTENT-HTTP',evidence:output}));
}finally{await app?.close();await owner.close();await catalog.close();}
