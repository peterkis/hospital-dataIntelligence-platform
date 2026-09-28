import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {peer,identitySQL,quote} from './lineage.mjs';
import {openCatalog,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {openDepartment} from '../../apps/governance-api/src/modules/department-master/index.ts';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts';
import {createDepartmentClient} from '../../packages/generated-api-client/src/index.ts';
import {departmentFixture} from './p2-01-fixture.ts';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const deployment=await prepareWorkspaceDeployment({evidenceTask:'p2-01'});
const {receipt,connection,provider,evidence}=deployment;
const service=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));
// The shared deployment preparation verifies receipt/OID/role identity and retains keys.
// Only this synthetic development environment's named actors receive explicit grants.
const functions=['authorize(text,text,text)','input_read(text,uuid,text)','snapshot(text,uuid)','job_read(text,uuid)','list(text,uuid,integer,timestamp)','code_conflict(text,text,uuid)','evidence(text,uuid,uuid,uuid,text,timestamp,timestamp)','mutate(text,text)','committed_row(text,uuid,integer,text,uuid,bigint,text,timestamp,timestamp,jsonb)'];
peer(receipt.name,identitySQL(receipt)+` BEGIN; SELECT pg_advisory_xact_lock(901002);
 DO $$ BEGIN IF (SELECT oid::text FROM pg_roles WHERE rolname=${quote(service.role)}) IS DISTINCT FROM ${quote(service.roleOid)} THEN RAISE EXCEPTION 'OWNER_ROLE_IDENTITY_MISMATCH'; END IF; END $$;
 GRANT USAGE ON SCHEMA department_master TO ${service.role};
 GRANT EXECUTE ON FUNCTION ${functions.map(f=>'department_master.'+f).join(',')} TO ${service.role};
 GRANT EXECUTE ON FUNCTION governance_catalog.apply_record(text,text,jsonb),governance_catalog.registration_evidence(text,uuid,uuid,text) TO ${service.role};
 INSERT INTO department_master.access SELECT a,'NORTH',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','READ_RESTRICTED']) p ON CONFLICT DO NOTHING;
 INSERT INTO department_master.access SELECT a,'HOSPITAL','READ' FROM unnest(ARRAY['maker','reviewer']) a ON CONFLICT DO NOTHING;
 INSERT INTO department_master.access SELECT 'reviewer','HOSPITAL',p FROM unnest(ARRAY['REVIEW','VERIFY']) p ON CONFLICT DO NOTHING; COMMIT;`);
const authority=planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{});
peer(receipt.name,identitySQL(receipt)+` BEGIN; SELECT pg_advisory_xact_lock(901002);
 INSERT INTO vnext_control.department_write_authority(key_hex) VALUES(${quote(authority)}) ON CONFLICT DO NOTHING;
 DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM vnext_control.department_write_authority WHERE key_hex=${quote(authority)}) THEN RAISE EXCEPTION 'KEY_RECEIPT_MISMATCH'; END IF; END $$; COMMIT;`,{sensitive:true});
const roleProbe=new Pool({connectionString:connection,max:1});
try{
 const privileges=await roleProbe.query("SELECT has_table_privilege(current_user,'department_master.department','INSERT') AS direct_write,has_table_privilege(current_user,'vnext_control.department_write_authority','SELECT') AS key_read");
 assert.deepEqual(privileges.rows[0],{direct_write:false,key_read:false});
}finally{await roleProbe.end();}
const catalog=await openCatalog(connection,provider),owner=openDepartment(connection,provider);
const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
const statePath='.runtime/vnext/p2-01/http-state.json';
mkdirSync('.runtime/vnext/p2-01/http-requests',{recursive:true});
function requestId(name){
 const path='.runtime/vnext/p2-01/http-requests/'+name+'.json';
 try{const saved=JSON.parse(readFileSync(path,'utf8'));assert.equal(saved.databaseOid,receipt.oid);assert.equal(saved.databaseRequestId,receipt.requestId);return saved.id;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const id=randomUUID();writeFileSync(path,JSON.stringify({databaseOid:receipt.oid,databaseRequestId:receipt.requestId,id}),{flag:'wx'});return id;
}
function freezeCommand(name,input){
 const path='.runtime/vnext/p2-01/http-requests/'+name+'.command.json';
 try{const saved=JSON.parse(readFileSync(path,'utf8'));assert.equal(saved.databaseOid,receipt.oid);assert.equal(saved.databaseRequestId,receipt.requestId);return saved.input;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 writeFileSync(path,JSON.stringify({databaseOid:receipt.oid,databaseRequestId:receipt.requestId,input}),{flag:'wx'});return input;
}
try{
 const url=await app.listen({host:'127.0.0.1',port:0}),maker=createDepartmentClient(url,'maker'),reviewer=createDepartmentClient(url,'reviewer');
 const denied=await fetch(url+'/api/vnext/departments/list',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'outsider'},body:'{}'});assert.equal(denied.status,403);
 let state;
 try{state=JSON.parse(readFileSync(statePath,'utf8'));assert.equal(state.databaseOid,receipt.oid);assert.equal(state.databaseRequestId,receipt.requestId);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!state){
  let sequence=0;
  const f=await departmentFixture(receipt,catalog,provider,{persistentSmoke:true,requestId:()=>requestId('fixture-'+sequence++),freezeCommand});
  const staged=await maker.stage(await f.input());assert.equal(staged.response.status,200);const input=staged.data;
  const verified=await reviewer.verify({requestId:requestId('verify'),inputId:input.inputId,inputDigest:input.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'SYNTHETIC persistent HTTP smoke',evidenceId:f.artifact.artifactId}]});assert.equal(verified.response.status,200);
  const applyRequest=requestId('apply'),planned=await maker.plan({inputId:input.inputId,requestId:applyRequest});assert.equal(planned.response.status,200);
  state={databaseOid:receipt.oid,databaseRequestId:receipt.requestId,requestId:applyRequest,candidate:planned.data};
  writeFileSync(statePath,JSON.stringify(state,null,2),{flag:'wx'});
 }
 const command={candidateId:state.candidate.candidateId,requestId:state.requestId};
 const resumed=await maker.resume(command);assert.equal(resumed.response.status,200);
 if(!resumed.data){
  const reviewed=await reviewer.review({candidateId:state.candidate.candidateId});assert.equal(reviewed.response.status,200);
  const approved=await reviewer.approve(state.candidate);assert.equal(approved.response.status,200);
 }else assert.equal(resumed.data.status,'COMMITTED');
 const applied=await maker.apply(command);assert.equal(applied.response.status,200);
 const replay=await maker.apply(command);assert.equal(replay.response.status,200);assert.deepEqual(replay.data,applied.data);
 const id=applied.data.facts[0].id;
 const history=await maker.history({id});assert.equal(history.response.status,200);assert.equal(history.data.versions.length,1);
 const exact=await maker.exact({id,version:'1'});assert.equal(exact.response.status,200);assert.equal(exact.data.id,id);
 const changed=await maker.diff({id,fromVersion:'1',toVersion:'1'});assert.equal(changed.response.status,200);assert.deepEqual(changed.data,{changes:[]});
 await deployment.complete();
 writeFileSync(evidence+'.http.json',JSON.stringify({status:'PASS',gate:'P2-01-PERSISTENT-HTTP',databaseOid:receipt.oid,departmentId:id,candidateId:state.candidate.candidateId,outsiderDenied:true,approval:true,atomicApply:true,replaySameFacts:true,history:true,exact:true,diff:true,authorization:'EXPLICIT_SYNTHETIC_ACTORS',hospitalPolicy:'NOT_ADOPTED',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});
 console.log(JSON.stringify({status:'PASS',gate:'P2-01-PERSISTENT-HTTP',evidence:evidence+'.http.json'}));
}finally{await app.close();await owner.close();await catalog.close();}
