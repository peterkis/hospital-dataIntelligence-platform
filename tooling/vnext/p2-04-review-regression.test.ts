import {test,expect,afterAll,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openCatalog,LocalSyntheticKeyProvider,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationIdentifiers,openDepartment} from '../../apps/governance-api/src/modules/department-master/index.js';
import {organizationIdentifierFixture} from './p2-04-fixture.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {peer,quote,migrate,migrationFiles,inspect} from './lineage.mjs';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {workspaceStartupPrefix} from './workspace-migrations.mjs';
const provider=new LocalSyntheticKeyProvider(),connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const catalog=await openCatalog(connection,provider);const department=openDepartment(connection,provider);let owner:ReturnType<typeof openOrganizationIdentifiers>,f:Awaited<ReturnType<typeof organizationIdentifierFixture>>,app:Awaited<ReturnType<typeof buildCatalogServer>>,url:string;
beforeAll(async()=>{owner=openOrganizationIdentifiers(connection,provider);f=await organizationIdentifierFixture(receipt,catalog,provider,connection);app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,{owner:department,actor:r=>actor(r.headers)},undefined,undefined,{owner,actor:r=>actor(r.headers)});url=await app.listen({host:'127.0.0.1',port:0});});
afterAll(async()=>{await app?.close();await owner?.close();await department.close();await catalog.close();});
async function prepare(entries:NonNullable<Parameters<typeof f.input>[0]>){const staged=await owner.stage('maker',await f.input(entries));await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:entries.map((_,i)=>({row:i+1,reason:'Independent regression',evidenceId:f.artifact.artifactId,policyApproved:true}))});const validation=await owner.validate('maker',{inputId:staged.inputId});expect(validation.decision).toBe('PASS');const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);return {candidate,requestId,staged};}
async function apply(entries:NonNullable<Parameters<typeof f.input>[0]>){const p=await prepare(entries);const result=await owner.applyUnit('maker',{candidateId:p.candidate.candidateId,requestId:p.requestId});expect(result.status).toBe('COMMITTED');if(result.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');return {...p,result};}
async function post(path:string,body:any){const response=await fetch(url+'/api/vnext/'+path,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
test.each(['END','RETRACT'] as const)('closure %s recovers missing or expired submitter and verifier material without losing sibling issues',async action=>{
 for(const side of ['submitter','verifier'] as const)for(const mode of ['missing','expired'] as const){
 const e=f.entry();e.row.identifier_value='closure '+randomUUID();const accepted=await apply([e]);e.action=action;e.identifier={owner:'department-master/organization-identifier',id:accepted.result.facts[0]!.id,expectedHead:'1'};if(action==='END')e.row.valid_to='2026-06-01T00:00:00';
 let unavailable:string;if(mode==='missing')unavailable=randomUUID();else{const j=await f.input();const material=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:j.jobId,revisionId:j.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:1},Buffer.from('expiring review evidence'));unavailable=material.artifactId;await new Promise(resolve=>setTimeout(resolve,1200));}
 if(side==='submitter')e.evidenceId=unavailable!;
 const sibling=f.entry();sibling.row.identifier_kind='SOURCE_CODE';const staged=await owner.stage('maker',await f.input([e,sibling]));await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'Closure material review',evidenceId:side==='verifier'?unavailable!:f.artifact.artifactId,policyApproved:true},{row:2,reason:'Sibling review',evidenceId:f.artifact.artifactId,policyApproved:true}]});const result=await post('organization-identifiers/validate',{inputId:staged.inputId});expect(result.status).toBe(200);expect(result.body.issues).toEqual(expect.arrayContaining([expect.objectContaining({row:1,field:'evidenceId',code:'BLOCKED_DEPENDENCY'}),expect.objectContaining({row:2,code:'SOURCE_MAPPING_REQUIRED'})]));
 const candidate=await owner.plan('maker',{inputId:staged.inputId,requestId:randomUUID()}),reviewed=await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});expect(reviewed.unit.basis['materials']).toEqual([]);
 }
});
test('closure evidence access denial remains a whole-request rejection',async()=>{
 const e=f.entry();e.row.identifier_value='restricted closure '+randomUUID();const first=await apply([e]);e.action='END';e.identifier={owner:'department-master/organization-identifier',id:first.result.facts[0]!.id,expectedHead:'1'};e.row.valid_to='2026-06-01T00:00:00';
 const staged=await owner.stage('maker',await f.input([e]));await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'Closure authority',evidenceId:f.artifact.artifactId,policyApproved:true}]});
 const predicate=`actor_code='reviewer' AND dataset_id=${quote(f.dataset.id)}::uuid AND permission='READ'`,grants=peer(receipt.name,`SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]')::text FROM vnext_control.protected_grant g WHERE ${predicate};`);peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE ${predicate};`);
 try{const denied=await post('organization-identifiers/validate',{inputId:staged.inputId});expect(denied.status).toBe(403);expect(denied.body.code).toBe('ACCESS_DENIED');}
 finally{peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.protected_grant,${quote(grants)}::jsonb) ON CONFLICT DO NOTHING;`);}
});
test.each(['nonpreferred-other','nonpreferred-same','preferred-other','preferred-disjoint'] as const)('unrelated alias %s changes must not stale a preferred alias approval',async scenario=>{
 const bucket='peer-'+randomUUID();
 const unrelated=f.entry();Object.assign(unrelated.row,{identifier_value:'nonpreferred old '+randomUUID(),language:scenario.endsWith('other')?bucket+'-other':bucket,is_preferred:scenario.startsWith('preferred')?'Y':'N',valid_to:scenario==='preferred-disjoint'?'2026-02-01T00:00:00':''});const created=await apply([unrelated]);
 const preferred=f.entry();Object.assign(preferred.row,{identifier_value:'preferred '+randomUUID(),language:bucket,is_preferred:'Y',valid_from:'2026-03-01T00:00:00'});const pending=await prepare([preferred]);
 unrelated.action='CORRECT';unrelated.identifier={owner:'department-master/organization-identifier',id:created.result.facts[0]!.id,expectedHead:'1'};unrelated.row.identifier_value='nonpreferred changed '+randomUUID();await apply([unrelated]);
 const outcome=await owner.applyUnit('maker',{candidateId:pending.candidate.candidateId,requestId:pending.requestId}).then((v:any)=>({status:v.status}), (e:Error)=>({error:e.message}));expect(outcome).toEqual({status:'COMMITTED'});
});
test('a previously unrelated alias becoming an overlapping preferred assertion invalidates approval',async()=>{
 const bucket='conflict-'+randomUUID(),other=f.entry();Object.assign(other.row,{identifier_value:'unrelated '+randomUUID(),language:bucket});const first=await apply([other]);
 const preferred=f.entry();Object.assign(preferred.row,{identifier_value:'pending '+randomUUID(),language:bucket,is_preferred:'Y'});const pending=await prepare([preferred]);
 other.action='CORRECT';other.identifier={owner:'department-master/organization-identifier',id:first.result.facts[0]!.id,expectedHead:'1'};other.row.is_preferred='Y';await apply([other]);
 await expect(owner.applyUnit('maker',{candidateId:pending.candidate.candidateId,requestId:pending.requestId})).rejects.toThrow(/STALE_VALIDATION|IDENTIFIER_CONFLICT/);
});
async function revisionPreview(id:string){
 const current=await department.history('maker',id),e=f.department.entry();e.intent='REVISE';e.target={owner:'department-master',id,expectedVersion:current.versions.at(-1)!.number};e.row.org_code=current.initialCode;
 const staged=await department.stage('maker',await f.department.input([e]));const direct=await department.preview('maker',{inputId:staged.inputId}),http=await post('departments/preview',{inputId:staged.inputId});expect(direct.heads).toHaveLength(1);expect(http.status).toBe(200);expect(http.body.heads[0].initialCode).toBe(current.initialCode);expect(http.body.heads[0]).not.toHaveProperty('code');
}
test('official identifier withdrawal of read access cannot be bypassed through Department query',async()=>{
 const target=await f.newDepartment();f.grantTarget(target);const code=(await owner.forTarget('maker',{type:'ORG',id:target,campus:'NORTH',businessAt:'2026-03-01T00:00:00'})).items.find(x=>x.kind==='HOSPITAL_CODE')!;
 const e=f.entry();e.action='CHANGE';e.identifier={owner:'department-master/organization-identifier',id:code.id,expectedHead:code.version.number};Object.assign(e.row,{target_id:target,identifier_kind:'HOSPITAL_CODE',identifier_system:'SYNTHETIC_DEPARTMENT_CODE',identifier_value:'REVIEW_'+randomUUID(),language:'',valid_from:'2026-06-01T00:00:00'});await apply([e]);
 const resolveBody={scheme:e.row.identifier_system,value:e.row.identifier_value,campus:'NORTH',businessAt:'2026-07-01T00:00:00'},query={id:target,campus:'NORTH' as const,businessAt:'2026-07-01T00:00:00'};const observations=[];await revisionPreview(target);await department.read('maker',query);expect((await post('departments/query',query)).status).toBe(200);expect((await post('departments/query',{id:target,businessAt:query.businessAt})).status).toBe(403);
 peer(receipt.name,"DELETE FROM department_master.identifier_access WHERE actor='maker' AND scheme='SYNTHETIC_DEPARTMENT_CODE' AND campus='NORTH' AND permission='READ';");
 try{observations.push({revoked:'scheme',resolve:await post('organization-identifiers/resolve',resolveBody),department:await post('departments/query',query)});}finally{f.grantScheme('SYNTHETIC_DEPARTMENT_CODE');}
 peer(receipt.name,`DELETE FROM department_master.mapping_target_access WHERE actor='maker' AND target_type='ORG' AND target_id=${quote(target)}::uuid AND campus='NORTH';`);
 try{observations.push({revoked:'target',resolve:await post('organization-identifiers/resolve',resolveBody),department:await post('departments/query',query)});}finally{f.grantTarget(target);}
 for(const o of observations){expect(o.resolve.status).toBe(403);expect(o.department.status).toBe(403);}
});
test('0087 storage requires the current release before workspace Owners can open',async()=>{
 const owned=createTemporary('P2-04');
 try{await migrate(owned.receipt,migrationFiles().slice(0,87));const view=await inspect(owned.receipt);expect(()=>workspaceStartupPrefix(migrationFiles(),view.ledger)).toThrow('WORKSPACE_MIGRATION_REQUIRED');}
 finally{dropTemporary(owned.receipt);}
});
test('existing Department revision preview serializes its previous head',async()=>{await revisionPreview(f.targetId);});

test('accepted predecessor Department facts without a command digest remain readable over HTTP',async()=>{
 const original=await department.history('maker',f.targetId),{commandDigest:_digest,...legacyFacts}=original.versions[0]!.facts,id=randomUUID(),code='LEGACY_'+randomUUID().replaceAll('-','');
 const entry=f.department.entry();entry.row.org_code=code;const staged=await department.stage('maker',await f.department.input([entry]));
 // Representative predecessor storage, not a current registration/approval claim.
 peer(receipt.name,`INSERT INTO department_master.department(id,code) VALUES(${quote(id)}::uuid,${quote(code)}); INSERT INTO department_master.version(department_id,number,valid_from,valid_to,input_id,source_row,facts,content_digest) VALUES(${quote(id)}::uuid,1,'2026-01-01'::timestamp,NULL,${quote(staged.inputId)}::uuid,1,${quote(JSON.stringify(legacyFacts))}::jsonb,${quote(planBinding(provider,'DEPARTMENT_FACTS_V1',legacyFacts))});`);
 f.grantTarget(id);const before=await department.history('maker',id);expect(before.versions[0]!.facts).not.toHaveProperty('commandDigest');
 const history=await post('departments/history',{id}),query=await post('departments/query',{id,campus:'NORTH',businessAt:'2026-03-01T00:00:00'});
 expect(history.status).toBe(200);expect(query.status).toBe(200);expect(query.body.effectiveCode).toBe(code);expect(query.body.version.facts).not.toHaveProperty('commandDigest');
 await revisionPreview(id);expect(await department.history('maker',id)).toEqual(before);
});

test('Department version diff supports optional predecessor facts in both directions',async()=>{
 const original=await department.history('maker',f.targetId),{commandDigest:_digest,...legacyFacts}=original.versions[0]!.facts;
 const id=randomUUID(),code='DIFF_LEGACY_'+randomUUID().replaceAll('-',''),entry=f.department.entry();entry.row.org_code=code;
 const staged=await department.stage('maker',await f.department.input([entry]));
 // Accepted predecessor fixture; the newer version still uses public approval and current write construction.
 peer(receipt.name,`INSERT INTO department_master.department(id,code) VALUES(${quote(id)}::uuid,${quote(code)}); INSERT INTO department_master.version(department_id,number,valid_from,valid_to,input_id,source_row,facts,content_digest) VALUES(${quote(id)}::uuid,1,'2026-01-01'::timestamp,NULL,${quote(staged.inputId)}::uuid,1,${quote(JSON.stringify(legacyFacts))}::jsonb,${quote(planBinding(provider,'DEPARTMENT_FACTS_V1',legacyFacts))});`);
 f.grantTarget(id);const before=await department.history('maker',id);
 entry.intent='REVISE';entry.target={owner:'department-master',id,expectedVersion:'1'};entry.row.org_name='DEMO revised predecessor Department';
 const revision=await department.stage('maker',await f.department.input([entry]));
 await department.verify('reviewer',{requestId:randomUUID(),inputId:revision.inputId,inputDigest:revision.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'Predecessor diff regression',evidenceId:f.department.artifact.artifactId}]});
 const requestId=randomUUID(),candidate=await department.plan('maker',{inputId:revision.inputId,requestId});
 await department.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await department.approveApplyUnit('reviewer',candidate);
 expect((await department.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status).toBe('COMMITTED');
 const after=await department.history('maker',id);expect(after.versions).toHaveLength(2);expect(after.versions[0]).toEqual(before.versions[0]);
 const digest=after.versions[1]!.facts.commandDigest;expect(digest).toMatch(/^[a-f0-9]{64}$/);
 const forward=await post('departments/diff',{id,fromVersion:'1',toVersion:'2'}),backward=await post('departments/diff',{id,fromVersion:'2',toVersion:'1'});
 expect(forward.status).toBe(200);expect(backward.status).toBe(200);
 expect(forward.body.changes).toContainEqual({field:'commandDigest',before:null,after:digest});
 expect(backward.body.changes).toContainEqual({field:'commandDigest',before:digest,after:null});
 const reversed=backward.body.changes.map((change:{field:string;before:unknown;after:unknown})=>({field:change.field,before:change.after,after:change.before}));
 expect(forward.body.changes).toEqual(expect.arrayContaining(reversed));expect(forward.body.changes).toHaveLength(reversed.length);
 const unchanged=await post('departments/diff',{id,fromVersion:'1',toVersion:'1'});expect(unchanged.status).toBe(200);expect(unchanged.body.changes).toEqual([]);
 expect((await department.history('maker',id)).versions[0]).toEqual(before.versions[0]);
});

test('current selected-version query should not require access to a superseded independent source',async()=>{
 const originalSource=await f.newSource(),latestSource=f.source;
 const {organizationIdentifierContractDefinition}=await import('./p2-04-contract-fixture.js');
 const fields=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find((x:any)=>x.id===f.dataset.id)!.payload.fields!.map((x:any)=>x.original),definition={...organizationIdentifierContractDefinition(fields,originalSource.versionId),ruleVersion:'ORG23_INDEPENDENT_REVIEW_V2'};
 const cmd=(action:string,values:any)=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'INDEPENDENT_SOURCE_REVIEW',...values});
 const draft=await catalog.contractCommand('maker',cmd('REVISE',{target:f.contract.id,expectedHead:f.contract.head,datasetVersionId:f.dataset.versionId,definition,validFrom:'2026-01-01T00:00:00',validTo:null}));
 const approved=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest})),impact=await catalog.contractImpact('reviewer','SYNTHETIC',draft.id,'PUBLISH');
 const contract=await catalog.contractCommand('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest,impactDigest:impact.impactDigest}));
 const job=()=>catalog.importJobCommand('maker',cmd('CREATE',{contractId:contract.id,contractVersionId:contract.versionId,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}}));
 const proofJob=await job(),proof=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:proofJob.id,revisionId:proofJob.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:7200},Buffer.from('independent child source evidence'));
 const commit=async(e:any)=>{const j=await job(),staged=await owner.stage('maker',{requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',profile:'CORE',entries:[e]});await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'Independent source review',evidenceId:proof.artifactId,policyApproved:true}]});expect((await owner.validate('maker',{inputId:staged.inputId})).decision).toBe('PASS');const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);const result=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(result.status).toBe('COMMITTED');if(result.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');return result;};
 const e=f.entry();e.evidenceId=proof.artifactId;Object.assign(e.row,{source_system_id:originalSource.id,identifier_value:'source boundary '+randomUUID(),language:'selected-source',is_preferred:'Y'});const first=await commit(e),id=first.facts[0]!.id;
 e.action='END';e.identifier={owner:'department-master/organization-identifier',id,expectedHead:'1'};e.row.valid_to='2026-07-01T00:00:00';e.row.source_system_id=latestSource.id;await commit(e);const firstRecorded=(await owner.history('maker',{id,campus:'NORTH'})).versions[0]!.recorded_at;
 const target=await f.newDepartment();f.grantTarget(target);const originalCode=(await owner.forTarget('maker',{type:'ORG',id:target,campus:'NORTH',businessAt:'2026-03-01T00:00:00'})).items.find(x=>x.kind==='HOSPITAL_CODE')!,codeEntry=f.entry();codeEntry.evidenceId=proof.artifactId;codeEntry.action='CHANGE';codeEntry.identifier={owner:'department-master/organization-identifier',id:originalCode.id,expectedHead:originalCode.version.number};Object.assign(codeEntry.row,{target_id:target,identifier_kind:'HOSPITAL_CODE',identifier_system:'SYNTHETIC_DEPARTMENT_CODE',identifier_value:'SELECTED_'+randomUUID(),language:'',source_system_id:originalSource.id,valid_from:'2026-06-01T00:00:00'});const recoded=await commit(codeEntry),codeId=recoded.facts[1]!.id;
 codeEntry.action='END';codeEntry.identifier={owner:'department-master/organization-identifier',id:codeId,expectedHead:'1'};codeEntry.row.source_system_id=latestSource.id;codeEntry.row.valid_to='2026-08-01T00:00:00';await commit(codeEntry);
 const predicate=`actor_code='maker' AND object_id=${quote(originalSource.id)}::uuid AND permission='READ' AND purpose='SYNTHETIC_REFERENCE'`,grants=peer(receipt.name,`SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]')::text FROM vnext_control.object_grant g WHERE ${predicate};`);peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE ${predicate};`);
 try{const selected=await post('organization-identifiers/query',{id,campus:'NORTH',businessAt:'2026-03-01T00:00:00'}),preferred=await post('organization-identifiers/preferred',{type:'ORG',id:f.targetId,campus:'NORTH',scheme:'SYNTHETIC_ALIAS',kind:'ALIAS',language:'selected-source',businessAt:'2026-03-01T00:00:00'});expect(preferred.status).toBe(200);expect(preferred.body.alias.version.facts.sourceSystemId).toBe(latestSource.id);expect(selected.status).toBe(200);expect(selected.body.version.number).toBe('2');
 const collection=await post('organization-identifiers/targets',{type:'ORG',id:f.targetId,campus:'NORTH',businessAt:'2026-03-01T00:00:00'});expect(collection.status).toBe(200);expect(collection.body.items).toEqual(expect.arrayContaining([expect.objectContaining({id,version:expect.objectContaining({number:'2'})})]));
 expect((await post('organization-identifiers/query',{id,campus:'NORTH',businessAt:'2026-03-01T00:00:00',recordAsOf:firstRecorded})).status).toBe(403);expect((await post('organization-identifiers/history',{id,campus:'NORTH'})).status).toBe(403);expect((await post('organization-identifiers/diff',{id,campus:'NORTH',fromVersion:'1',toVersion:'2'})).status).toBe(403);
 const resolve=await post('organization-identifiers/resolve',{scheme:codeEntry.row.identifier_system,value:codeEntry.row.identifier_value,campus:'NORTH',businessAt:'2026-07-01T00:00:00'});expect(resolve.status).toBe(200);expect(resolve.body.status).toBe('RESOLVED');expect(resolve.body.version).toBe('2');expect((await post('departments/query',{id:target,campus:'NORTH',businessAt:'2026-07-01T00:00:00'})).status).toBe(200);
 }
 finally{peer(receipt.name,`INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,${quote(grants)}::jsonb) ON CONFLICT DO NOTHING;`);}
 e.action='RETRACT';e.identifier={owner:'department-master/organization-identifier',id,expectedHead:'2'};await commit(e);peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE ${predicate};`);
 try{const compared=await post('organization-identifiers/diff',{id,campus:'NORTH',fromVersion:'2',toVersion:'3'});expect(compared.status).toBe(200);expect(compared.body.before.facts.sourceSystemId).toBe(latestSource.id);expect(compared.body.after.facts.sourceSystemId).toBe(latestSource.id);expect((await post('organization-identifiers/history',{id,campus:'NORTH'})).status).toBe(403);}
 finally{peer(receipt.name,`INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,${quote(grants)}::jsonb) ON CONFLICT DO NOTHING;`);}

});
