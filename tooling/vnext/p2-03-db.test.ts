import {test,expect,afterAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {organizationMappingFixture} from './p2-03-fixture.js';
import {openOrganizationMappings,ORG22_FIELDS} from '../../apps/governance-api/src/modules/department-master/index.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {peer,quote} from './lineage.mjs';
import {Pool} from 'pg';
import {openOrganization,openCampus} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {provisionCampusAuthority} from './campus-authority.mjs';
import {createOrganizationMappingClient} from '../../packages/generated-api-client/src/index.js';

const provider=new LocalSyntheticKeyProvider(),connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const catalog=await openCatalog(connection,provider),owner=openOrganizationMappings(connection,provider);
let f:Awaited<ReturnType<typeof organizationMappingFixture>>;
afterAll(async()=>{await owner.close();await catalog.close();});
async function apply(entries:Parameters<typeof f.input>[0]){
 const staged=await owner.stage('maker',await f.input(entries));
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:entries!.map((_,index)=>({row:index+1,reason:'DEMO approved exact context',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}))});
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 const result=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(result.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');return {result,candidate,requestId};
}
const key=(entry:ReturnType<typeof f.entry>,recordAsOf?:string)=>({fromSystemId:entry.row.from_system_id,sourceEntityType:entry.row.source_entity_type,sourceCode:entry.row.source_code,sourceContext:entry.row.source_context,campus:'NORTH' as const,businessAt:'2026-03-01T00:00:00',...(recordAsOf?{recordAsOf}:{})});

test('organization mapping Owner rejects unauthorized reads through its public boundary',async()=>{
 const owner=openOrganizationMappings(process.env['VNEXT_VALIDATION_OWNER_URL']!);
 try{await expect(owner.list('outsider',{campus:'NORTH',limit:10})).rejects.toThrow('ACCESS_DENIED');}finally{await owner.close();}
});

test('independent approval registers one immutable mapping and resolves its exact source key',async()=>{
  f=await organizationMappingFixture(receipt,catalog,provider,connection);const entry=f.entry(),staged=await owner.stage('maker',await f.input([entry]));
  expect((await owner.validate('maker',{inputId:staged.inputId})).decision).toBe('BLOCKED');
  await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'DEMO explicit source and target',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}]});
  expect((await owner.validate('maker',{inputId:staged.inputId})).decision).toBe('PASS');
  const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});
  await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
  const result=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(result.status).toBe('COMMITTED');if(result.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
  expect(result.facts[0]!.id).not.toBe(entry.row.org_map_id);
  expect(await owner.resolve('maker',{fromSystemId:entry.row.from_system_id,sourceEntityType:entry.row.source_entity_type,sourceCode:entry.row.source_code,sourceContext:'DEFAULT',campus:'NORTH',businessAt:'2026-03-01T00:00:00'})).toMatchObject({status:'RESOLVED',mappingId:result.facts[0]!.id,target:{owner:'department-master',id:f.targetId}});
});

test('staged request replay preserves the original input and rejects changed content',async()=>{
 const input=await f.input(),staged=await owner.stage('maker',input);
 expect(await owner.stage('maker',input)).toEqual(staged);
 const changed=structuredClone(input);changed.entries[0]!.row.source_name='DEMO changed replay payload';
 await expect(owner.stage('maker',changed)).rejects.toThrow('REQUEST_CONFLICT');
 expect((await owner.readInput('maker',{inputId:staged.inputId})).entries[0]!.row.source_name).toBe(input.entries[0]!.row.source_name);
});

test('granting a maker alias verification permissions cannot bypass the real-identity checker boundary',async()=>{
 const staged=await owner.stage('maker',await f.input());
 peer(receipt.name,`INSERT INTO vnext_control.actor_grant VALUES('maker-alias','SYNTHETIC','REVIEW') ON CONFLICT DO NOTHING;INSERT INTO department_master.mapping_access SELECT 'maker-alias',${quote(f.source.id)}::uuid,'DEPARTMENT','DEFAULT','NORTH',p FROM unnest(ARRAY['VERIFY','REVIEW']) p ON CONFLICT DO NOTHING;`);
 try{await expect(owner.verify('maker-alias',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'DEMO alias is same real person',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}]})).rejects.toThrow('MAKER_CHECKER_REQUIRED');}
 finally{peer(receipt.name,"DELETE FROM department_master.mapping_access WHERE actor='maker-alias' AND permission IN ('VERIFY','REVIEW');DELETE FROM vnext_control.actor_grant WHERE actor_code='maker-alias' AND scope='SYNTHETIC' AND permission='REVIEW';");}
});

test('re-register with a new request cannot change the target or reuse the registered source identity',async()=>{
 const entry=f.entry();await apply([entry]);const duplicate={...entry,row:{...entry.row,org_map_id:randomUUID()}};
 const staged=await owner.stage('maker',await f.input([duplicate]));
 expect((await owner.validate('maker',{inputId:staged.inputId})).issues).toContainEqual({row:1,field:'org_map_id',code:'MAPPING_ALREADY_REGISTERED',status:'FAIL'});
 await expect(owner.plan('maker',{inputId:staged.inputId,requestId:randomUUID()})).rejects.toThrow('MAPPING_ALREADY_REGISTERED');
 expect((await owner.resolve('maker',key(entry))).status).toBe('RESOLVED');
});

test('corrected complete periods preserve old R and do not fall back to an old open version',async()=>{
 const entry=f.entry(),created=await apply([entry]),id=created.result.facts[0]!.id,h=await owner.history('maker',id),oldR=h.versions[0]!.recorded_at.replace(' ','T');
 const correction={...entry,action:'CORRECT' as const,mapping:{owner:'department-master/organization-mapping' as const,id,expectedHead:'1'},reason:'DEMO shorten previously open assertion',row:{...entry.row,valid_to:'2026-02-01T00:00:00'}};
 await apply([correction]);
 expect(await owner.resolve('maker',key(entry))).toEqual({status:'NOT_FOUND'});
 expect(await owner.resolve('maker',key(entry,oldR))).toMatchObject({status:'RESOLVED',version:'1'});
 expect((await owner.history('maker',id)).versions.map(v=>({version:v.number,end:v.valid_to}))).toEqual([{version:'1',end:null},{version:'2',end:'2026-02-01T00:00:00'}]);
});

test('whole revision rejects a blocked sibling without applying the valid row',async()=>{
 const good=f.entry(),bad=f.entry();bad.row.mapping_relation='RELATED';
 const staged=await owner.stage('maker',await f.input([good,bad]));
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[1,2].map(row=>({row,reason:'DEMO evidence',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}))});
 await expect(owner.plan('maker',{inputId:staged.inputId,requestId:randomUUID()})).rejects.toThrow('BLOCKED_DEPENDENCY');
 expect(await owner.resolve('maker',key(good))).toEqual({status:'NOT_FOUND'});
 expect((await owner.readInput('maker',{inputId:staged.inputId})).entries[1]!.row.mapping_relation).toBe('RELATED');
});

test('retraction removes the whole assertion at new R and retains the old assertion',async()=>{
 const entry=f.entry(),created=await apply([entry]),id=created.result.facts[0]!.id,oldR=(await owner.history('maker',id)).versions[0]!.recorded_at.replace(' ','T');
 await apply([{...entry,action:'RETRACT',mapping:{owner:'department-master/organization-mapping',id,expectedHead:'1'},reason:'DEMO retract incorrect assertion'}]);
 expect(await owner.resolve('maker',key(entry))).toEqual({status:'NOT_FOUND'});
 expect(await owner.resolve('maker',key(entry,oldR))).toMatchObject({status:'RESOLVED',version:'1'});
});

test('accepted correction history never prevents another correction or withdrawal',async()=>{
 const entry=f.entry();entry.reason='合'.repeat(2000);entry.row.source_name='名'.repeat(2000);entry.row.resolution_rule='规'.repeat(2000);
 const created=await apply([entry]),id=created.result.facts[0]!.id,oldR=(await owner.history('maker',id)).versions[0]!.recorded_at.replace(' ','T');
 for(let head=1;head<=30;head++)await apply([{...entry,action:'CORRECT',mapping:{owner:'department-master/organization-mapping',id,expectedHead:String(head)},row:{...entry.row,version_no:String(head+1)}}]);
 await apply([{...entry,action:'RETRACT',mapping:{owner:'department-master/organization-mapping',id,expectedHead:'31'},reason:'DEMO withdraw after accepted correction history',row:{...entry.row,version_no:'32'}}]);
 expect(await owner.resolve('maker',key(entry))).toEqual({status:'NOT_FOUND'});
 expect(await owner.resolve('maker',key(entry,oldR))).toMatchObject({status:'RESOLVED',version:'1'});
 expect((await owner.history('maker',id)).versions).toHaveLength(32);
});

test('ORG22 file intake preserves physical provenance and rejects a whole file with an invalid sibling',async()=>{
 const entry=f.entry(),job={action:'CREATE' as const,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'SYNTHETIC_ORGANIZATION_MAPPING',contractId:f.contract.id,contractVersionId:f.contract.versionId,profile:'CORE' as const,input:{kind:'FILE' as const,format:'XLSX' as const,parserPolicy:'STRICT_ORGANIZATION_MAPPING_V1' as const}};
 const meta={requestId:randomUUID(),fileRequestId:randomUUID(),job,campus:'NORTH' as const,retentionSeconds:3600,entries:[{action:entry.action,mapping:entry.mapping,reason:entry.reason,evidenceId:entry.evidenceId}]};
 const accepted=await owner.receiveFile('maker',meta,organizationWorkbook({ORG22:[ORG22_FIELDS,ORG22_FIELDS.map(k=>entry.row[k])]}));
 expect(accepted.input).not.toBeNull();expect((await owner.readInput('maker',{inputId:accepted.input!.inputId})).entries[0]!.sourceRow).toBe(2);
 const bad=f.entry();bad.row.source_context='';const failed=await owner.receiveFile('maker',{...meta,requestId:randomUUID(),fileRequestId:randomUUID(),job:{...job,requestId:randomUUID()},entries:[...meta.entries,...meta.entries]},organizationWorkbook({ORG22:[ORG22_FIELDS,ORG22_FIELDS.map(k=>entry.row[k]),ORG22_FIELDS.map(k=>bad.row[k])]}));
 expect(failed.input).toBeNull();expect(failed.issues.some(i=>i.row===3)).toBe(true);
 expect(await owner.resolve('maker',key(entry))).toEqual({status:'NOT_FOUND'});
});

test('real HTTP exposes mapping history and rejects outsiders and open command shapes',async()=>{
 const entry=f.entry(),created=await apply([entry]),id=created.result.facts[0]!.id;
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 try{
  const url=await app.listen({host:'127.0.0.1',port:0}),post=(path:string,body:unknown,who='maker')=>fetch(url+'/api/vnext/organization-mappings/'+path,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':who},body:JSON.stringify(body)});
  const history=await post('history',{id});expect(history.status).toBe(200);expect(await history.json()).toMatchObject({id,versions:[{number:'1',target_id:f.targetId}]});
  expect((await post('list',{campus:'NORTH'},'outsider')).status).toBe(403);
  expect((await post('resolve',{...key(entry),extra:'IGNORED'})).status).toBe(400);
 }finally{await app.close();}
});

test('HTTP reviewers receive frozen reuse evidence and the correction before and after',async()=>{
 const entry=f.entry();entry.row.source_context='DEMO_HTTP_REUSE';entry.row.resolution_rule='DEMO separately approved source key reuse';f.grantNamespace(entry.row.from_system_id,entry.row.source_context);
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 try{
  const url=await app.listen({host:'127.0.0.1',port:0}),reviewer=createOrganizationMappingClient(url,'reviewer'),maker=createOrganizationMappingClient(url,'maker');
  const staged=await owner.stage('maker',await f.input([entry])),verification={requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'DEMO independent reused-context decision',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:true}]};
  await owner.verify('reviewer',verification);
  const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId}),review=await reviewer.review({candidateId:candidate.candidateId});
  expect(review.response.status).toBe(200);
  expect(review.data).toHaveProperty('basis.verification.rows.0.sourceKeyReuse',true);
  expect(review.data).toMatchObject({input:{jobId:staged.inputId,revisionId:staged.revisionId},basis:{inputDigest:staged.digest,verification,contract:{versionId:f.contract.versionId}},commandFacts:[{row:1,facts:{contractVersionId:f.contract.versionId,target:{id:f.targetId,parts:[{version:'1'}]},sourcePins:[{sourceId:f.source.id,versionId:f.source.versionId}]}}],diff:[{row:1,action:'REGISTER',mapping:null,targetId:f.targetId}]});
  expect((await reviewer.approve(candidate)).response.status).toBe(200);
  const applied=await maker.apply({candidateId:candidate.candidateId,requestId});expect(applied.data?.status).toBe('COMMITTED');
  const id=applied.data!.facts![0]!.id;
  const correction={...entry,action:'CORRECT' as const,mapping:{owner:'department-master/organization-mapping' as const,id,expectedHead:'1'},reason:'DEMO explicit period correction',row:{...entry.row,valid_to:'2026-02-01T00:00:00'}};
  const corrected=await owner.stage('maker',await f.input([correction])),checked={...verification,requestId:randomUUID(),inputId:corrected.inputId,inputDigest:corrected.digest,rows:[{...verification.rows[0]!,reason:'DEMO frozen correction decision',sourceKeyReuse:false}]};
  await owner.verify('reviewer',checked);
  const frozen=await owner.plan('maker',{inputId:corrected.inputId,requestId:randomUUID()});
  await owner.verify('reviewer',{...checked,requestId:randomUUID(),rows:[{...checked.rows[0]!,reason:'DEMO later verification must not replace frozen review'}]});
  const correctionReview=await reviewer.review({candidateId:frozen.candidateId});expect(correctionReview.response.status).toBe(200);
  expect(correctionReview.data).toMatchObject({basis:{verification:checked,heads:[{id,versions:[{number:'1',action:'REGISTER',valid_to:null,target_id:f.targetId}]}]},diff:[{row:1,action:'CORRECT',mapping:{id,expectedHead:'1'},targetId:f.targetId,validTo:'2026-02-01T00:00:00.000000'}]});
  expect((await reviewer.approve(frozen)).response.status).toBe(409);
 }finally{await app.close();}
});

test('AC01: identical codes from two explicitly registered source systems coexist',async()=>{
 const a=f.entry(),source=await f.newSource();f.grantNamespace(source.id);
 const b={...f.entry(),row:{...a.row,org_map_id:randomUUID(),from_system_id:source.id}};
 await apply([a,b]);expect(await owner.resolve('maker',key(a))).toMatchObject({status:'RESOLVED',target:{id:f.targetId}});expect(await owner.resolve('maker',key(b))).toMatchObject({status:'RESOLVED',target:{id:f.targetId}});
});

test('AC02/03: same context cannot have two targets; an explicit correction preserves the original target at old R',async()=>{
 const entry=f.entry(),created=await apply([entry]),id=created.result.facts[0]!.id,oldR=(await owner.history('maker',id)).versions[0]!.recorded_at.replace(' ','T'),other=await f.newDepartment();f.grantTarget(other);
 const duplicate={...entry,row:{...entry.row,org_map_id:randomUUID(),target_id:other}},staged=await owner.stage('maker',await f.input([duplicate]));
 expect((await owner.validate('maker',{inputId:staged.inputId})).issues).toContainEqual({row:1,field:'org_map_id',code:'MAPPING_ALREADY_REGISTERED',status:'FAIL'});
 await apply([{...duplicate,action:'CORRECT',mapping:{owner:'department-master/organization-mapping',id,expectedHead:'1'},reason:'DEMO correct wrong target'}]);
 expect(await owner.resolve('maker',key(entry))).toMatchObject({status:'RESOLVED',version:'2',target:{id:other}});
 expect(await owner.resolve('maker',key(entry,oldR))).toMatchObject({status:'RESOLVED',version:'1',target:{id:f.targetId}});
});

test('AC04: explicit namespace scope and target tuple grants cannot be enlarged by client context',async()=>{
 const entry=f.entry(),ungranted=await f.newDepartment(),bad={...entry,row:{...entry.row,target_id:ungranted}};
 const staged=await owner.stage('maker',await f.input([bad]));await expect(owner.validate('maker',{inputId:staged.inputId})).rejects.toThrow('ACCESS_DENIED');
 const input=await f.input([entry]);await expect(owner.stage('maker',{...input,campus:'SOUTH'})).rejects.toThrow('ACCESS_DENIED');
 await expect(owner.stage('maker',{...input,entries:[{...entry,row:{...entry.row,source_context:'OTHER_CAMPUS'}}]})).rejects.toThrow('ACCESS_DENIED');
});

test('same code in different approved contexts requires executable context evidence',async()=>{
 const a=f.entry(),other=await f.newDepartment();f.grantTarget(other);f.grantNamespace(f.source.id,'ACCOUNT_B');
 const b={...f.entry(),row:{...a.row,org_map_id:randomUUID(),target_id:other,source_context:'ACCOUNT_B'}};
 const staged=await owner.stage('maker',await f.input([a,b]));
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[1,2].map(row=>({row,reason:'DEMO distinct approved account contexts',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}))});
 expect((await owner.validate('maker',{inputId:staged.inputId})).issues).toContainEqual({row:1,field:'resolution_rule',code:'LEGAL_REVIEW_REQUIRED',status:'BLOCKED'});
});

test('service SQL cannot mutate mapping tables or use an unsigned approval ticket',async()=>{
 const pool=new Pool({connectionString:connection,max:1});
 try{
  await expect(pool.query("INSERT INTO department_master.organization_mapping(from_system_id,entity_type,source_code,context,campus) VALUES($1,'DEPARTMENT','BAD','DEFAULT','NORTH')",[f.source.id])).rejects.toThrow(/permission denied/);
  await expect(pool.query("UPDATE department_master.organization_mapping_version SET reason='OVERWRITE'")).rejects.toThrow(/permission denied/);
  await expect(pool.query("SELECT key_hex FROM vnext_control.department_write_authority")).rejects.toThrow(/permission denied/);
  await expect(pool.query('SELECT department_master.mapping_mutate($1,$2)',[JSON.stringify({actor:'maker',operation:'APPLY'}),'0'.repeat(64)])).rejects.toThrow('ACCESS_DENIED');
 }finally{await pool.end();}
});

test('unimplemented target Owners retain staging and report BLOCKED_DEPENDENCY',async()=>{
 const entry=f.entry();entry.row.target_type='UNIT';const staged=await owner.stage('maker',await f.input([entry]));
 expect((await owner.readInput('maker',{inputId:staged.inputId})).entries[0]!.row.target_id).toBe(f.targetId);
 expect((await owner.validate('maker',{inputId:staged.inputId})).issues).toContainEqual({row:1,field:'target_type',code:'BLOCKED_DEPENDENCY',status:'BLOCKED'});
});

test('unknown target codes fail the adopted field contract while preserving the candidate',async()=>{
 const entry=f.entry();entry.row.target_type='UNKNOWN_OWNER';const staged=await owner.stage('maker',await f.input([entry]));
 expect((await owner.readInput('maker',{inputId:staged.inputId})).entries[0]!.row.target_type).toBe('UNKNOWN_OWNER');
 expect(await owner.validate('maker',{inputId:staged.inputId})).toMatchObject({decision:'FAIL',issues:expect.arrayContaining([{row:1,field:'target_type',code:'ENUM_INVALID',status:'FAIL'}])});
});

test('source-key reuse uses a separately approved context and remains visible in the frozen review basis',async()=>{
 const entry=f.entry();entry.row.source_context='DEMO_REUSED_KEY';entry.row.resolution_rule='DEMO source key reused under explicitly approved new context';f.grantNamespace(entry.row.from_system_id,entry.row.source_context);
 const staged=await owner.stage('maker',await f.input([entry]));
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'DEMO verified source-key reuse',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:true}]});
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId}),review=await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});
 expect(review.unit.basis).toMatchObject({verification:{rows:[{sourceKeyReuse:true,contextApproved:true}]}});
 await owner.approveApplyUnit('reviewer',candidate);expect((await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status).toBe('COMMITTED');
 expect((await owner.resolve('maker',key(entry))).status).toBe('RESOLVED');
 expect(await owner.resolve('maker',{...key(entry),sourceContext:'DEFAULT'})).toEqual({status:'NOT_FOUND'});
});

test('business periods retain microseconds and exclude their upper boundary',async()=>{
 const entry=f.entry();entry.row.valid_from='2026-03-01T00:00:00.123456';entry.row.valid_to='2026-03-01T00:00:00.123457';await apply([entry]);
 expect((await owner.resolve('maker',{...key(entry),businessAt:entry.row.valid_from})).status).toBe('RESOLVED');
 expect(await owner.resolve('maker',{...key(entry),businessAt:entry.row.valid_to})).toEqual({status:'NOT_FOUND'});
});

test('two corrections approved against the same head append only one replacement version',async()=>{
 const entry=f.entry(),created=await apply([entry]),id=created.result.facts[0]!.id;
 const prepare=async(end:string)=>{
  const correction={...entry,action:'CORRECT' as const,mapping:{owner:'department-master/organization-mapping' as const,id,expectedHead:'1'},reason:'DEMO concurrent correction',row:{...entry.row,valid_to:end}};
  const staged=await owner.stage('maker',await f.input([correction]));await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'DEMO concurrent correction',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}]});
  const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);return {candidateId:candidate.candidateId,requestId};
 };
 const a=await prepare('2026-02-01T00:00:00'),b=await prepare('2026-02-02T00:00:00'),results=await Promise.allSettled([owner.applyUnit('maker',a),owner.applyUnit('maker',b)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
 expect((await owner.history('maker',id)).versions.map(v=>v.number)).toEqual(['1','2']);
});

test('historical resolution rechecks the target Owner current read permission',async()=>{
 const entry=f.entry();await apply([entry]);
 peer(receipt.name,"DELETE FROM department_master.access WHERE actor='maker' AND scope='HOSPITAL' AND permission='READ';");
 try{await expect(owner.resolve('maker',key(entry))).rejects.toThrow('ACCESS_DENIED');}
 finally{peer(receipt.name,"INSERT INTO department_master.access VALUES('maker','HOSPITAL','READ') ON CONFLICT DO NOTHING;");}
});

test('two approved candidates for the same source identity serialize to one committed mapping',async()=>{
 const entry=f.entry();
 const prepare=async()=>{const staged=await owner.stage('maker',await f.input([entry]));await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'DEMO concurrent create',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}]});const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);return {candidateId:candidate.candidateId,requestId};};
 const a=await prepare(),b=await prepare(),results=await Promise.allSettled([owner.applyUnit('maker',a),owner.applyUnit('maker',b)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
 const resolved=await owner.resolve('maker',key(entry));expect(resolved.status).toBe('RESOLVED');if(resolved.status==='RESOLVED')expect((await owner.history('maker',resolved.mappingId)).versions).toHaveLength(1);
});

test('second-row SQL failure rolls back both facts and the root outcome',async()=>{
 const good=f.entry(),bad=f.entry();bad.reason='DEMO_SECOND_ROW_SQL_FAILURE';
 const staged=await owner.stage('maker',await f.input([good,bad]));await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[1,2].map(row=>({row,reason:'DEMO actual transaction failure',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}))});
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 peer(receipt.name,"CREATE FUNCTION department_master.mapping_test_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason='DEMO_SECOND_ROW_SQL_FAILURE' THEN RAISE EXCEPTION 'BATCH_REJECTED';END IF;RETURN NEW;END $$; CREATE TRIGGER mapping_test_failure BEFORE INSERT ON department_master.organization_mapping_version FOR EACH ROW EXECUTE FUNCTION department_master.mapping_test_commit_failure();");
 try{
  await expect(owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).rejects.toThrow('BATCH_REJECTED');
  expect(await owner.resolve('maker',key(good))).toEqual({status:'NOT_FOUND'});expect(await owner.resolve('maker',key(bad))).toEqual({status:'NOT_FOUND'});
  expect(await owner.resumeOutcome('maker',{candidateId:candidate.candidateId,requestId})).toBeNull();
 }finally{peer(receipt.name,"DROP TRIGGER mapping_test_failure ON department_master.organization_mapping_version; DROP FUNCTION department_master.mapping_test_commit_failure();");}
 const result=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(result.status).toBe('COMMITTED');
});

test('retry after a post-commit response failure returns original facts and current permission is rechecked',async()=>{
 const entry=f.entry(),created=await apply([entry]),command={candidateId:created.candidate.candidateId,requestId:created.requestId};
 const response=await owner.applyUnit('maker',command,async()=>{throw new Error('DEMO_RESPONSE_LOST');});expect(response).toMatchObject({status:'COMMITTED',responseStatus:'POST_COMMIT_FAILED',facts:created.result.facts});
 expect((await owner.resumeOutcome('maker',command))?.facts).toEqual(created.result.facts);
 peer(receipt.name,"DELETE FROM department_master.mapping_access WHERE actor='maker' AND permission='READ_RESTRICTED';");
 try{await expect(owner.applyUnit('maker',command)).rejects.toThrow('ACCESS_DENIED');}
 finally{peer(receipt.name,`INSERT INTO department_master.mapping_access SELECT 'maker',from_system_id,entity_type,context,campus,'READ_RESTRICTED' FROM department_master.mapping_access WHERE actor='maker' AND permission='READ' ON CONFLICT DO NOTHING;`);}
});

test('non-expansion still requires current target permissions from maker and approver',async()=>{
 const entry=f.entry(),created=await apply([entry]),id=created.result.facts[0]!.id;
 const closing={...entry,action:'RETRACT' as const,mapping:{owner:'department-master/organization-mapping' as const,id,expectedHead:'1'},reason:'DEMO explicit withdrawal'};
 const staged=await owner.stage('maker',await f.input([closing]));await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'DEMO independently verified withdrawal',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}]});
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 for(const who of ['maker','reviewer']){
  peer(receipt.name,`DELETE FROM department_master.mapping_target_access WHERE actor=${quote(who)} AND target_type='ORG' AND target_id=${quote(f.targetId)}::uuid AND campus='NORTH';`);
  try{await expect(owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).rejects.toThrow('ACCESS_DENIED');}
  finally{f.grantTarget();}
  peer(receipt.name,`DELETE FROM department_master.access WHERE actor=${quote(who)} AND scope='HOSPITAL' AND permission='READ';`);
  try{await expect(owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).rejects.toThrow('ACCESS_DENIED');}
  finally{peer(receipt.name,`INSERT INTO department_master.access VALUES(${quote(who)},'HOSPITAL','READ') ON CONFLICT DO NOTHING;`);}
 }
 expect((await owner.history('maker',id)).versions).toHaveLength(1);
 expect((await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status).toBe('COMMITTED');
});

test('frozen candidate reads and committed recovery recheck current target permission without new admission',async()=>{
 const entry=f.entry(),created=await apply([entry]),command={candidateId:created.candidate.candidateId,requestId:created.requestId};
 for(const who of ['maker','reviewer']){
  peer(receipt.name,`DELETE FROM department_master.access WHERE actor=${quote(who)} AND scope='HOSPITAL' AND permission='READ';`);
  try{
   if(who==='reviewer')await expect(owner.readApplyCandidate('reviewer',{candidateId:command.candidateId})).rejects.toThrow('ACCESS_DENIED');
   else{await expect(owner.applyUnit('maker',command)).rejects.toThrow('ACCESS_DENIED');await expect(owner.resumeOutcome('maker',command)).rejects.toThrow('ACCESS_DENIED');}
  }finally{peer(receipt.name,`INSERT INTO department_master.access VALUES(${quote(who)},'HOSPITAL','READ') ON CONFLICT DO NOTHING;`);}
 }
 expect((await owner.applyUnit('maker',command))).toMatchObject({status:'COMMITTED',facts:created.result.facts});
});

test('closing and committed recovery require the current accepted-source read grant',async()=>{
 const entry=f.entry(),created=await apply([entry]),id=created.result.facts[0]!.id,closing={...entry,action:'RETRACT' as const,mapping:{owner:'department-master/organization-mapping' as const,id,expectedHead:'1'},reason:'DEMO source-authorized withdrawal'};
 const staged=await owner.stage('maker',await f.input([closing]));await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'DEMO source-authorized withdrawal',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}]});
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 for(const who of ['maker','reviewer']){
  const predicate=`actor_code=${quote(who)} AND object_id=${quote(f.source.id)}::uuid AND permission='READ' AND purpose='SYNTHETIC_REFERENCE'`,grants=peer(receipt.name,`SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]')::text FROM vnext_control.object_grant g WHERE ${predicate};`);
  expect(JSON.parse(grants).length).toBeGreaterThan(0);peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE ${predicate};`);
  try{
   await expect(owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).rejects.toThrow('ACCESS_DENIED');
   if(who==='maker')await expect(owner.resumeOutcome('maker',{candidateId:created.candidate.candidateId,requestId:created.requestId})).rejects.toThrow('ACCESS_DENIED');
   else await expect(owner.readApplyCandidate('reviewer',{candidateId:created.candidate.candidateId})).rejects.toThrow('ACCESS_DENIED');
  }finally{peer(receipt.name,`INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,${quote(grants)}::jsonb) ON CONFLICT DO NOTHING;`);}
 }
 expect((await owner.history('maker',id)).versions).toHaveLength(1);
});

test('a retired upstream source blocks expansion while pure period reduction and retraction remain possible',async()=>{
 const source=await f.newSource();f.grantNamespace(source.id);const entry=f.entry();entry.row.from_system_id=source.id;const created=await apply([entry]),id=created.result.facts[0]!.id;
 const impact=await catalog.sourceImpact('reviewer','SYNTHETIC',source.id,'RETIRE');
 await catalog.command('reviewer',{action:'RETIRE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_UPSTREAM_RETIRE',target:source.id,expectedHead:source.head,reviewDigest:source.reviewDigest,impactDigest:impact.impactDigest});
 expect(await owner.applyUnit('maker',{candidateId:created.candidate.candidateId,requestId:created.requestId})).toMatchObject({status:'COMMITTED',facts:created.result.facts});
 expect((await owner.readApplyCandidate('reviewer',{candidateId:created.candidate.candidateId})).candidateId).toBe(created.candidate.candidateId);
 const changed={...entry,action:'CORRECT' as const,mapping:{owner:'department-master/organization-mapping' as const,id,expectedHead:'1'},reason:'DEMO mixed correction',row:{...entry.row,source_name:'Changed claim',valid_to:'2026-02-01T00:00:00'}};
 const staged=await owner.stage('maker',await f.input([changed]));expect((await owner.validate('maker',{inputId:staged.inputId})).issues).toContainEqual({row:1,field:'from_system_id',code:'BLOCKED_DEPENDENCY',status:'BLOCKED'});
 const shrink={...changed,row:{...entry.row,valid_to:'2026-02-01T00:00:00'}};await apply([shrink]);
 await apply([{...shrink,action:'RETRACT',mapping:{...shrink.mapping,expectedHead:'2'},reason:'DEMO withdraw after source retirement'}]);
 expect(await owner.resolve('maker',key(entry))).toEqual({status:'NOT_FOUND'});
});

test('LEGAL and CAMPUS adapters read actual Owner versions without inferring operating permission',async()=>{
 const organization=openOrganization(connection,provider);provisionCampusAuthority(receipt,provider);const campus=openCampus(connection,provider);
 const common={validFrom:'2026-01-01T00:00:00',validTo:null,source:{systemId:f.source.id,versionId:f.source.versionId,alias:'DEMO_MAPPING_TARGET',versionNo:1,recordLocator:'DEMO_ORGANIZATION_ROW',recordedAt:'2026-01-02T00:00:00',recordStatus:'PUBLISHED' as const,approvalRef:'DEMO_APPROVAL'}};
 try{
  const job=await f.department.newJob();
  const staged=await organization.stage('maker',{requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',command:{...common,action:'CREATE',facts:{legalName:'DEMO independent legal subject',entityNature:'DEMO',authority:null,legalAddress:null,registrationEvidence:f.department.artifact.artifactId},identifiers:[]}});
  const requestId=randomUUID(),candidate=await organization.plan('maker',{inputId:staged.inputId,requestId});await organization.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await organization.approveApplyUnit('reviewer',candidate);
  const committed=await organization.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(committed.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');const legalId=committed.facts[0]!.id;
  const campusJob=await f.department.newJob(),campusInput=await campus.stage('maker',{requestId:randomUUID(),jobId:campusJob.id,revisionId:campusJob.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',command:{...common,action:'CREATE',evidence:f.department.artifact.artifactId,sourceOperationStatus:'PLANNING',facts:{campusCode:'DEMO_'+randomUUID(),campusName:'DEMO mapping campus',nodeRole:'HEADQUARTERS',nodeKind:'PHYSICAL',campusAddress:null,adminDivision:null,publicPhone:null,openingDate:null}}});
  const campusRequest=randomUUID(),campusCandidate=await campus.plan('maker',{inputId:campusInput.inputId,requestId:campusRequest});await campus.readApplyCandidate('reviewer',{candidateId:campusCandidate.candidateId});await campus.approveApplyUnit('reviewer',campusCandidate);
  const campusCommitted=await campus.applyUnit('maker',{candidateId:campusCandidate.candidateId,requestId:campusRequest});if(campusCommitted.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');const campusId=campusCommitted.facts[0]!.id;
  f.grantTarget(legalId,'LEGAL');f.grantTarget(campusId,'CAMPUS');
  const legal=f.entry(),node=f.entry();legal.row.target_type='LEGAL';legal.row.target_id=legalId;node.row.target_type='CAMPUS';node.row.target_id=campusId;
  await apply([legal,node]);expect(await owner.resolve('maker',key(legal))).toMatchObject({status:'RESOLVED',target:{owner:'organization-master',id:legalId}});expect(await owner.resolve('maker',key(node))).toMatchObject({status:'RESOLVED',target:{owner:'organization-master/campus',id:campusId}});
 }finally{await organization.close();await campus.close();}
});
