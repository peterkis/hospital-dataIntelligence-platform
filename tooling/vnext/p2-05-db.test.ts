import {test,expect,beforeAll,afterAll} from 'vitest';
import {randomUUID,createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openCatalog,LocalSyntheticKeyProvider,canonicalPlan,planBinding,authenticateRegistrationEvidence} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationEvolutions,openDepartment,openHierarchy,openOrganizationMappings,openOrganizationIdentifiers,type HierarchyCandidateInput} from '../../apps/governance-api/src/modules/department-master/index.js';
import {evolutionFixture} from './p2-05-fixture.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
import {ORG26_FIELDS,ORG27_FIELDS} from '../../apps/governance-api/src/modules/department-master/index.js';
import {ORG04_FIELDS} from '../../apps/governance-api/src/modules/department-master/vnext/contracts.js';
import {peer,quote} from './lineage.mjs';
import {Pool} from 'pg';
import {createOrganizationEvolutionClient,createDepartmentClient} from '../../packages/generated-api-client/src/vnext-client.js';
import {persistentEvolutionFixture} from './p2-05-persistent-fixture.js';

const provider=new LocalSyntheticKeyProvider(),connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const catalog=await openCatalog(connection,provider);
let owner:ReturnType<typeof openOrganizationEvolutions>,f:Awaited<ReturnType<typeof evolutionFixture>>;
beforeAll(async()=>{owner=openOrganizationEvolutions(connection,provider);f=await evolutionFixture(receipt,catalog,provider,connection);});
afterAll(async()=>{await owner?.close();await catalog.close();});

async function prepare(input:Parameters<typeof owner.stage>[1]){
 const staged=await owner.stage('maker',input);
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST POLICY ONLY independent material review',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});
 expect(await owner.validate('maker',{inputId:staged.inputId})).toMatchObject({decision:'PASS',issues:[]});
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});
 await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 return {staged,candidate,requestId};
}

async function splitInput(){
 const source=await f.newDepartment();f.grantTarget(source);
 const input=await f.input();input.event.change_type='SPLIT';Object.assign(input.impacts.find(i=>i.domain==='IDENTIFIER')!,{determination:'AFFECTED',requiredAction:'TEST explicit Identifier Owner closure'});input.rename=null;input.predecessors=[{owner:'department-master',id:source,expectedVersion:'1'}];input.successors=[f.department.entry(),f.department.entry()];input.contextEvidenceId=f.material.artifactId;
 for(const next of input.successors){next.row.valid_from=input.event.effective_at;next.row.established_on='2026-06-01';}
 input.relations=input.successors.map((next,i)=>({succession_id:randomUUID(),org_event_id:input.event.org_event_id,from_target_type:'ORG',from_target_id:source,to_target_type:'ORG',to_target_id:next.row.org_id,transfer_scope:i?'INPATIENT':'OUTPATIENT',context_rule:'TEST POLICY ONLY explicit future destination',recorded_at:input.event.recorded_at}));
 return input;
}

async function renameInput(){
 const input=await f.input(),id=await f.newDepartment();f.grantTarget(id);input.predecessors=[{owner:'department-master',id,expectedVersion:'1'}];input.relations[0]!.from_target_id=id;input.relations[0]!.to_target_id=id;return input;
}

function formalFactsDigest(){
 const tables=['department_master.department','department_master.version','department_master.evolution_event','department_master.evolution_relation','department_master.replacement','department_master.organization_mapping','department_master.organization_mapping_version','department_master.organization_identifier','department_master.organization_identifier_version','governance_catalog.apply_commit'];
 return peer(receipt.name,`SELECT encode(sha256(convert_to(jsonb_build_array(${tables.map(table=>`(SELECT coalesce(jsonb_agg(to_jsonb(facts) ORDER BY to_jsonb(facts)::text),'[]') FROM ${table} facts)`).join(',')},(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM vnext_control.audit a WHERE action='EVOLUTION_APPLY'))::text,'UTF8')),'hex');`);
}

type ReviewedCommand=Awaited<ReturnType<ReturnType<typeof openOrganizationEvolutions>['readApplyCandidate']>>['unit']['commands'][number];
async function signedApprovedCommand(command:ReviewedCommand,approval:{candidateId:string;digest:string},name:'mutate'|'mapping_mutate'|'identifier_mutate'){
 const pool=new Pool({connectionString:connection,max:1}),client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(901002)');const transaction=(await client.query('SELECT pg_current_xact_id()::text id')).rows[0]!.id;
  const facts=JSON.parse(command.value['facts']!),domain=name==='mutate'?'DEPARTMENT_FACTS_V1':name==='mapping_mutate'?'ORG_MAPPING_FACTS_V1':'ORG_IDENTIFIER_FACTS_V1';
  const ticket=canonicalPlan({actor:'maker',operation:'APPLY',transaction,inputId:command.value['inputId'],row:command.row,sourceRow:Number(command.value['sourceRow']??command.row),...(command.value['step']?{step:command.value['step']}:{}),command:JSON.parse(command.value['command']!),facts,contentDigest:planBinding(provider,domain,facts),...approval});
  const key=Buffer.from(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}),'hex');try{return await client.query(`SELECT department_master.${name}($1,$2)`,[ticket,createHmac('sha256',key).update(ticket).digest('hex')]);}finally{key.fill(0);}
 }finally{await client.query('ROLLBACK');client.release();await pool.end();}
}

test('ordinary Department, source mapping and alias writes recheck replacement in the real SQL authority seam',async()=>{
 const input=await splitInput(),id=input.predecessors[0]!.id,department=openDepartment(connection,provider),mapping=openOrganizationMappings(connection,provider),identifier=openOrganizationIdentifiers(connection,provider);
 try{
  const original=await department.history('maker',id),revision=f.department.entry();revision.intent='REVISE';revision.target={owner:'department-master',id,expectedVersion:'1'};revision.row.org_code=original.initialCode;revision.row.valid_from=input.event.effective_at;
  const ds=await department.stage('maker',await f.department.input([revision]));await department.verify('reviewer',{requestId:randomUUID(),inputId:ds.inputId,inputDigest:ds.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'TEST POLICY ONLY independent ordinary revision',evidenceId:revision.evidenceId}]});
  const dp=await department.plan('maker',{inputId:ds.inputId,requestId:randomUUID()}),dr=await department.readApplyCandidate('reviewer',{candidateId:dp.candidateId});await department.approveApplyUnit('reviewer',dp);
  const mappingEntry=f.entry();mappingEntry.row.target_id=id;mappingEntry.row.valid_from=input.event.effective_at;
  const ms=await mapping.stage('maker',await f.mappingInput([mappingEntry]));await mapping.verify('reviewer',{requestId:randomUUID(),inputId:ms.inputId,inputDigest:ms.digest,rows:[{row:1,reason:'TEST POLICY ONLY independent mapping',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}]});
  const mp=await mapping.plan('maker',{inputId:ms.inputId,requestId:randomUUID()}),mr=await mapping.readApplyCandidate('reviewer',{candidateId:mp.candidateId});await mapping.approveApplyUnit('reviewer',mp);
  const aliasInput=await f.identifierInput(id,input.event.effective_at),is=await identifier.stage('maker',aliasInput);await identifier.verify('reviewer',{requestId:randomUUID(),inputId:is.inputId,inputDigest:is.digest,rows:[{row:1,reason:'TEST POLICY ONLY independent alias',evidenceId:aliasInput.entries[0]!.evidenceId,policyApproved:true}]});
  const ip=await identifier.plan('maker',{inputId:is.inputId,requestId:randomUUID()}),ir=await identifier.readApplyCandidate('reviewer',{candidateId:ip.candidateId});await identifier.approveApplyUnit('reviewer',ip);
  const evolution=await prepare(input);expect((await owner.applyUnit('maker',{candidateId:evolution.candidate.candidateId,requestId:evolution.requestId})).status).toBe('COMMITTED');
  const before=formalFactsDigest();for(const [command,approval,name] of [[dr.unit.commands[0]!,dp,'mutate'],[mr.unit.commands[0]!,mp,'mapping_mutate'],[ir.unit.commands[0]!,ip,'identifier_mutate']] as const)await expect(signedApprovedCommand(command,approval,name)).rejects.toThrow('UNSUPPORTED_STATE_TRANSITION');expect(formalFactsDigest()).toBe(before);
  expect((await mapping.validate('maker',{inputId:ms.inputId})).decision).toBe('BLOCKED');expect((await identifier.validate('maker',{inputId:is.inputId})).decision).toBe('BLOCKED');
 }finally{await department.close();await mapping.close();await identifier.close();}
});

test('P2-05-AC-04 frozen hierarchy snapshots remain intact and cannot be republished across the replacement boundary',async()=>{
 const input=await splitInput(),id=input.predecessors[0]!.id,hierarchy=openHierarchy(connection,provider),department=openDepartment(connection,provider),ownerId=await f.newDepartment();
 try{
  const exact=await department.exact('maker',{id,version:'1'}),header={requestId:randomUUID(),sourceClientKey:randomUUID(),viewCode:'TEST_'+randomUUID(),viewName:'TEST POLICY ONLY frozen identity view',viewType:'ADMINISTRATIVE' as const,purpose:'TEST_POLICY_ONLY',aggregationRule:'NONE',ownerDepartmentId:ownerId,sourceSystemId:f.source.id,sourceRecordId:'TEST/ORG05/2',sourceVersion:'1',validFrom:'2026-01-01T00:00:00',validTo:null,recordedAt:'2026-01-01T00:00:00',approvalRef:'TEST_APPROVAL'};
  const view=await hierarchy.createHierarchyView('maker',header);peer(receipt.name,`INSERT INTO department_master.hierarchy_grant(actor_code,object_id,permission) SELECT 'reviewer',${quote(view.viewId)}::uuid,p FROM unnest(ARRAY['READ','REVIEW']) p;`);
  const candidate:HierarchyCandidateInput={...header,requestId:randomUUID(),viewId:view.viewId,parentCardinality:'STRICT_TREE',recordStatus:'ACTIVE',nodes:[{nodeKey:'root',parentNodeKey:null,nodeKind:'DEPARTMENT',departmentId:id,departmentVersionId:exact.versionId,displayName:'Original frozen display',relationName:'TEST',sortOrder:0,isPrimaryPath:true,sourceEvidence:{sourceClientKey:randomUUID(),sourceVersion:'1',sourceSystemId:f.source.id,sourceRecordId:'TEST/ORG06/2',validFrom:header.validFrom,validTo:null,recordedAt:header.recordedAt,recordStatus:'ACTIVE',approvalRef:'TEST_APPROVAL'}}]};
  const approve=async(value:HierarchyCandidateInput)=>{const staged=await hierarchy.importHierarchyCandidate('maker',value);if(!staged.candidateId)throw new Error('HIERARCHY_NOT_STAGED');await hierarchy.approveHierarchyCandidate('reviewer',{candidateId:staged.candidateId,digest:staged.digest});return {candidateId:staged.candidateId,digest:staged.digest,requestId:value.requestId};};
  const old=await hierarchy.publishHierarchySnapshot('maker',await approve(candidate)),prepared=await approve({...candidate,requestId:randomUUID()});
  Object.assign(input.impacts.find(impact=>impact.domain==='HIERARCHY')!,{determination:'AFFECTED',requiredAction:'TEST POLICY ONLY preserve snapshot and explicitly bound the active hierarchy'});
  const evolution=await prepare(input);expect((await owner.applyUnit('maker',{candidateId:evolution.candidate.candidateId,requestId:evolution.requestId})).status).toBe('COMMITTED');
  await expect(hierarchy.publishHierarchySnapshot('maker',prepared)).rejects.toThrow('BLOCKED_DEPENDENCY');expect(await hierarchy.readHierarchySnapshot('maker',{viewId:view.viewId,version:old.view.version})).toEqual(old);
  const bounded={...candidate,requestId:randomUUID(),validTo:input.event.effective_at,nodes:candidate.nodes.map(node=>({...node,sourceEvidence:{...node.sourceEvidence,validTo:input.event.effective_at}}))};expect((await hierarchy.publishHierarchySnapshot('maker',await approve(bounded))).validTo).toBe('2026-06-01T00:00:00.000000');
 }finally{await hierarchy.close();await department.close();}
});

test('P2-05-AC-05 existing mappings and aliases remain unchanged while explicit safe withdrawal remains possible',async()=>{
 const input=await splitInput(),id=input.predecessors[0]!.id,mapping=openOrganizationMappings(connection,provider),identifier=openOrganizationIdentifiers(connection,provider);
 try{
  const mappingEntry=f.entry();mappingEntry.row.target_id=id;
  const applyMapping=async(entry:typeof mappingEntry)=>{
   const staged=await mapping.stage('maker',await f.mappingInput([entry]));await mapping.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'TEST POLICY ONLY explicit mapping disposition',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}]});
   expect((await mapping.validate('maker',{inputId:staged.inputId})).decision).toBe('PASS');const requestId=randomUUID(),candidate=await mapping.plan('maker',{inputId:staged.inputId,requestId});await mapping.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await mapping.approveApplyUnit('reviewer',candidate);const result=await mapping.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(result.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');return result.facts[0]!.id;
  };
  const aliasInput=await f.identifierInput(id,'2026-01-01T00:00:00');
  const applyAlias=async()=>{
   const next=await f.identifierInput(id,'2026-01-01T00:00:00');aliasInput.jobId=next.jobId;aliasInput.revisionId=next.revisionId;
   aliasInput.requestId=randomUUID();const staged=await identifier.stage('maker',aliasInput);await identifier.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'TEST POLICY ONLY explicit alias disposition',evidenceId:aliasInput.entries[0]!.evidenceId,policyApproved:true}]});
   expect((await identifier.validate('maker',{inputId:staged.inputId})).decision).toBe('PASS');const requestId=randomUUID(),candidate=await identifier.plan('maker',{inputId:staged.inputId,requestId});await identifier.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await identifier.approveApplyUnit('reviewer',candidate);const result=await identifier.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(result.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');return result.facts[0]!.id;
  };
  const mappingId=await applyMapping(mappingEntry),aliasId=await applyAlias(),priorMapping=await mapping.history('maker',mappingId),priorAlias=await identifier.history('maker',{id:aliasId,campus:'NORTH'});
  Object.assign(input.impacts.find(impact=>impact.domain==='SOURCE_MAPPING')!,{determination:'AFFECTED',requiredAction:'TEST POLICY ONLY explicit mapping shrink and withdrawal'});input.event.migration_plan_ref='TEST_EXPLICIT_MAPPING_DISPOSITION';input.migrationEvidenceId=f.material.artifactId;
  const evolution=await prepare(input);expect((await owner.applyUnit('maker',{candidateId:evolution.candidate.candidateId,requestId:evolution.requestId})).status).toBe('COMMITTED');
  expect(await mapping.history('maker',mappingId)).toEqual(priorMapping);expect(await identifier.history('maker',{id:aliasId,campus:'NORTH'})).toEqual(priorAlias);
  const shrinking={...mappingEntry,action:'CORRECT' as const,mapping:{owner:'department-master/organization-mapping' as const,id:mappingId,expectedHead:'1'},reason:'TEST POLICY ONLY reduce the original accepted interval',row:{...mappingEntry.row,valid_to:'2026-06-02T00:00:00'}};
  await applyMapping(shrinking);
  const changed=await mapping.stage('maker',await f.mappingInput([{...shrinking,mapping:{...shrinking.mapping,expectedHead:'2'},row:{...shrinking.row,source_name:'TEST POLICY ONLY new semantic assertion after exit'}}]));
  await mapping.verify('reviewer',{requestId:randomUUID(),inputId:changed.inputId,inputDigest:changed.digest,rows:[{row:1,reason:'TEST POLICY ONLY changed assertion is not closure',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}]});expect((await mapping.validate('maker',{inputId:changed.inputId})).decision).toBe('BLOCKED');
  await applyMapping({...mappingEntry,action:'RETRACT',mapping:{owner:'department-master/organization-mapping',id:mappingId,expectedHead:'2'},reason:'TEST POLICY ONLY explicitly withdraw predecessor mapping',row:shrinking.row});
  aliasInput.entries[0]!.action='END';aliasInput.entries[0]!.identifier={owner:'department-master/organization-identifier',id:aliasId,expectedHead:'1'};aliasInput.entries[0]!.row.valid_to=input.event.effective_at;await applyAlias();
  expect((await mapping.history('maker',mappingId)).versions[0]).toEqual(priorMapping.versions[0]);expect((await identifier.history('maker',{id:aliasId,campus:'NORTH'})).versions[0]).toEqual(priorAlias.versions[0]);
 }finally{await mapping.close();await identifier.close();}
});

test('a replaced Department cannot own a new hierarchy interval while bounded historical ownership remains publishable',async()=>{
 const input=await splitInput(),id=input.predecessors[0]!.id,active=await f.newDepartment(),hierarchy=openHierarchy(connection,provider),department=openDepartment(connection,provider);
 try{
  const evolution=await prepare(input);expect((await owner.applyUnit('maker',{candidateId:evolution.candidate.candidateId,requestId:evolution.requestId})).status).toBe('COMMITTED');
  const exact=await department.exact('maker',{id:active,version:'1'});
  const publish=async(from:string,to:string|null)=>{
   const header={requestId:randomUUID(),sourceClientKey:randomUUID(),viewCode:'TEST_'+randomUUID(),viewName:'TEST POLICY ONLY explicit hierarchy ownership',viewType:'ADMINISTRATIVE' as const,purpose:'TEST_POLICY_ONLY',aggregationRule:'NONE',ownerDepartmentId:id,sourceSystemId:f.source.id,sourceRecordId:'TEST/ORG05/OWNER',sourceVersion:'1',validFrom:from,validTo:to,recordedAt:'2026-01-01T00:00:00',approvalRef:'TEST_APPROVAL'};
   const view=await hierarchy.createHierarchyView('maker',header);peer(receipt.name,`INSERT INTO department_master.hierarchy_grant(actor_code,object_id,permission) SELECT 'reviewer',${quote(view.viewId)}::uuid,p FROM unnest(ARRAY['READ','REVIEW']) p;`);
   const candidate:HierarchyCandidateInput={...header,requestId:randomUUID(),viewId:view.viewId,parentCardinality:'STRICT_TREE',recordStatus:'ACTIVE',nodes:[{nodeKey:'root',parentNodeKey:null,nodeKind:'DEPARTMENT',departmentId:active,departmentVersionId:exact.versionId,displayName:'TEST POLICY ONLY active independent node',relationName:'TEST',sortOrder:0,isPrimaryPath:true,sourceEvidence:{sourceClientKey:randomUUID(),sourceVersion:'1',sourceSystemId:f.source.id,sourceRecordId:'TEST/ORG06/OWNER',validFrom:from,validTo:to,recordedAt:header.recordedAt,recordStatus:'ACTIVE',approvalRef:'TEST_APPROVAL'}}]};
   const staged=await hierarchy.importHierarchyCandidate('maker',candidate);if(!staged.candidateId)throw new Error('HIERARCHY_NOT_STAGED');await hierarchy.approveHierarchyCandidate('reviewer',{candidateId:staged.candidateId,digest:staged.digest});return hierarchy.publishHierarchySnapshot('maker',{candidateId:staged.candidateId,digest:staged.digest,requestId:candidate.requestId});
  };
  await expect(publish(input.event.effective_at,null)).rejects.toThrow('BLOCKED_DEPENDENCY');expect((await publish('2026-01-01T00:00:00',input.event.effective_at)).validTo).toBe('2026-06-01T00:00:00.000000');
 }finally{await hierarchy.close();await department.close();}
});

test.each([
 ['event','department_master.evolution_event','true'],
 ['second successor','department_master.version','NEW.evolution_event_id IS NOT NULL AND NEW.source_row=2'],
 ['second edge','department_master.evolution_relation','NEW.source_row=2'],
 ['exit','department_master.replacement','true'],
 ['audit','vnext_control.audit',"NEW.action='EVOLUTION_APPLY'"],
 ['root outcome','governance_catalog.apply_commit','true'],
] as const)('P2-05-AC-03 failure at %s rolls back every formal fact and permits a complete retry',async(_label,table,condition)=>{
 const input=await splitInput(),p=await prepare(input),before=formalFactsDigest(),command={candidateId:p.candidate.candidateId,requestId:p.requestId};
 peer(receipt.name,`CREATE FUNCTION department_master.p2_05_fault() RETURNS trigger LANGUAGE plpgsql AS $fault$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'P2_05_INJECTED_FAILURE';END IF;RETURN NEW;END $fault$;CREATE TRIGGER p2_05_fault BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION department_master.p2_05_fault();`);
 try{await expect(owner.applyUnit('maker',command)).rejects.toThrow('APPLY_FAILED');expect(formalFactsDigest()).toBe(before);expect(await owner.resumeOutcome('maker',command)).toBeNull();}
 finally{peer(receipt.name,`DROP TRIGGER p2_05_fault ON ${table};DROP FUNCTION department_master.p2_05_fault();`);}
 const committed=await owner.applyUnit('maker',command);expect(committed.status).toBe('COMMITTED');expect(formalFactsDigest()).not.toBe(before);
});

test('two approved events competing for one predecessor have exactly one committed result',async()=>{
 const first=await splitInput(),second=await splitInput(),id=first.predecessors[0]!.id;second.predecessors=[...first.predecessors];for(const relation of second.relations)relation.from_target_id=id;
 const a=await prepare(first),b=await prepare(second);
 const results=await Promise.allSettled([owner.applyUnit('maker',{candidateId:a.candidate.candidateId,requestId:a.requestId}),owner.applyUnit('maker',{candidateId:b.candidate.candidateId,requestId:b.requestId})]);
 expect(results.filter(result=>result.status==='fulfilled'&&result.value.status==='COMMITTED')).toHaveLength(1);expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
 const history=await owner.history('maker',{id,campus:'NORTH',businessAt:first.event.effective_at});expect(history.events).toHaveLength(1);
});

test('conflicting new codes cannot leave a partial second event',async()=>{
 const first=await splitInput(),second=await splitInput();second.successors[0]!.row.org_code=first.successors[0]!.row.org_code;
 const a=await prepare(first),b=await prepare(second),command={candidateId:b.candidate.candidateId,requestId:b.requestId};
 expect((await owner.applyUnit('maker',{candidateId:a.candidate.candidateId,requestId:a.requestId})).status).toBe('COMMITTED');const before=formalFactsDigest();
 await expect(owner.applyUnit('maker',command)).rejects.toThrow('STALE_VALIDATION');expect(formalFactsDigest()).toBe(before);expect(await owner.resumeOutcome('maker',command)).toBeNull();
});

test('complete blocked inputs retain FULL, unknown impacts and unsupported target fields in the frozen review',async()=>{
 const input=await renameInput();input.profile='FULL';input.impacts[0]!.determination='UNKNOWN';input.relations[0]!.to_target_type='CAMPUS';input.event.change_type='RELOCATE';input.event.migration_plan_ref='DEMO_PENDING_REAL_PLAN';
 const staged=await owner.stage('maker',input),validation=await owner.validate('maker',{inputId:staged.inputId});expect(validation.decision).toBe('BLOCKED');
 const candidate=await owner.plan('maker',{inputId:staged.inputId,requestId:randomUUID()}),review=await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});
 expect(review.unit.basis['entries']).toMatchObject(input);expect(review.unit.commands).toEqual([]);await expect(owner.approveApplyUnit('reviewer',candidate)).rejects.toThrow('BLOCKED_DEPENDENCY');
});

test('same human aliases cannot verify or approve their own evolution',async()=>{
 const input=await renameInput(),staged=await owner.stage('maker',input);
 peer(receipt.name,"INSERT INTO department_master.access VALUES('maker-alias','HOSPITAL','VERIFY'),('maker-alias','HOSPITAL','REVIEW') ON CONFLICT DO NOTHING;");
 try{
  await expect(owner.verify('maker-alias',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST POLICY ONLY self review attempt',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews})).rejects.toThrow('MAKER_CHECKER_REQUIRED');
  await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST POLICY ONLY independent material review',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});
  const candidate=await owner.plan('maker-alias',{inputId:staged.inputId,requestId:randomUUID()});await expect(owner.approveApplyUnit('maker-alias',candidate)).rejects.toThrow('MAKER_CHECKER_REQUIRED');
 }finally{peer(receipt.name,"DELETE FROM department_master.access WHERE actor='maker-alias' AND scope='HOSPITAL' AND permission IN ('VERIFY','REVIEW');");}
});

test('revoked material access blocks frozen reads, execution and recovery before any write',async()=>{
 const p=await prepare(await renameInput()),command={candidateId:p.candidate.candidateId,requestId:p.requestId},before=formalFactsDigest();
 peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND dataset_id=${quote(f.eventDataset.id)}::uuid AND campus='NORTH' AND purpose='IDENTITY_VERIFY' AND permission='READ';`);
 try{await expect(owner.readApplyCandidate('maker',{candidateId:p.candidate.candidateId})).rejects.toThrow('ACCESS_DENIED');await expect(owner.applyUnit('maker',command)).rejects.toThrow('ACCESS_DENIED');await expect(owner.resumeOutcome('maker',command)).rejects.toThrow('ACCESS_DENIED');expect(formalFactsDigest()).toBe(before);}
 finally{peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(f.eventDataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ');`);}
 expect((await owner.applyUnit('maker',command)).status).toBe('COMMITTED');
});

test('revoked source access blocks a frozen application and outcome recovery before any formal write',async()=>{
 const p=await prepare(await splitInput()),command={candidateId:p.candidate.candidateId,requestId:p.requestId},before=formalFactsDigest();
 const predicate=`actor_code='maker' AND object_id=${quote(f.source.id)}::uuid AND permission='READ' AND purpose='SYNTHETIC_REFERENCE'`,grants=peer(receipt.name,`SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]')::text FROM vnext_control.object_grant g WHERE ${predicate};`);expect(JSON.parse(grants).length).toBeGreaterThan(0);
 peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE ${predicate};`);
 try{await expect(owner.applyUnit('maker',command)).rejects.toThrow('ACCESS_DENIED');await expect(owner.resumeOutcome('maker',command)).rejects.toThrow('ACCESS_DENIED');expect(formalFactsDigest()).toBe(before);}
 finally{peer(receipt.name,`INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,${quote(grants)}::jsonb);`);}
 expect((await owner.applyUnit('maker',command)).status).toBe('COMMITTED');
});

test('raw evolution input and HTTP reads recheck each referenced successor source before disclosure',async()=>{
 const input=await splitInput(),source=await f.newSource();input.successors[0]!.row.source_system_id=source.id;
 const staged=await owner.stage('maker',input);expect((await owner.readInput('reviewer',{inputId:staged.inputId})).successors[0]!.row).toEqual(input.successors[0]!.row);
 const predicate=`actor_code='reviewer' AND object_id=${quote(source.id)}::uuid AND permission='READ' AND purpose='SYNTHETIC_REFERENCE'`,grants=peer(receipt.name,`SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]')::text FROM vnext_control.object_grant g WHERE ${predicate};`);expect(JSON.parse(grants).length).toBeGreaterThan(0);
 peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE ${predicate};`);
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 try{
  await expect(owner.readInput('reviewer',{inputId:staged.inputId})).rejects.toThrow('ACCESS_DENIED');
  const url=await app.listen({host:'127.0.0.1',port:0});expect((await createOrganizationEvolutionClient(url,'reviewer').readInput({inputId:staged.inputId})).response.status).toBe(403);
 }finally{await app.close();peer(receipt.name,`INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,${quote(grants)}::jsonb);`);}
});

test('staging checks every successor source before an input is persisted',async()=>{
 const input=await splitInput(),source=await f.newSource();input.successors[0]!.row.source_system_id=source.id;
 const predicate=`actor_code='maker' AND object_id=${quote(source.id)}::uuid AND permission='READ' AND purpose='SYNTHETIC_REFERENCE'`,grants=peer(receipt.name,`SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]')::text FROM vnext_control.object_grant g WHERE ${predicate};`);expect(JSON.parse(grants).length).toBeGreaterThan(0);
 peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE ${predicate};`);
 try{
 await expect(owner.stage('maker',input)).rejects.toThrow('ACCESS_DENIED');
 expect(Number(peer(receipt.name,`SELECT count(*) FROM department_master.evolution_input WHERE request_id=${quote(input.requestId)}::uuid;`))).toBe(0);
 }finally{peer(receipt.name,`INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,${quote(grants)}::jsonb);`);}
});

test('verification cannot attest a successor source after reviewer access is revoked',async()=>{
 const input=await splitInput(),source=await f.newSource();input.successors[0]!.row.source_system_id=source.id;
 const staged=await owner.stage('maker',input),predicate=`actor_code='reviewer' AND object_id=${quote(source.id)}::uuid AND permission='READ' AND purpose='SYNTHETIC_REFERENCE'`,grants=peer(receipt.name,`SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]')::text FROM vnext_control.object_grant g WHERE ${predicate};`);expect(JSON.parse(grants).length).toBeGreaterThan(0);
 peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE ${predicate};`);
 try{
 await expect(owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST POLICY ONLY revoked successor source review',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews})).rejects.toThrow('ACCESS_DENIED');
 expect(Number(peer(receipt.name,`SELECT count(*) FROM department_master.evolution_verification WHERE input_id=${quote(staged.inputId)}::uuid;`))).toBe(0);
 }finally{peer(receipt.name,`INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,${quote(grants)}::jsonb);`);}
});

test('event listing applies the same current material access predicate as exact reads',async()=>{
 const input=await renameInput(),prepared=await prepare(input),accepted=await owner.applyUnit('maker',{candidateId:prepared.candidate.candidateId,requestId:prepared.requestId});
 expect(accepted.status).toBe('COMMITTED');if(accepted.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');const eventId=accepted.facts[0]!.id;
 peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND dataset_id=${quote(f.eventDataset.id)}::uuid AND campus='NORTH' AND purpose='IDENTITY_VERIFY' AND permission='READ';`);
 try{
 await expect(owner.query('maker',{id:eventId,campus:'NORTH',businessAt:input.event.effective_at})).rejects.toThrow('ACCESS_DENIED');
 expect(await owner.list('maker',{campus:'NORTH',limit:100})).not.toContain(eventId);
 }finally{peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(f.eventDataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ');`);}
});

test.each(['uppercase','braced','unhyphenated'] as const)('closed source references reject %s UUID spellings before staging or HTTP application',async(format)=>{
 const input=await splitInput();input.successors[0]!.row.source_system_id=format==='uppercase'?f.source.id.toUpperCase():format==='braced'?'{'+f.source.id+'}':f.source.id.replaceAll('-','');
 const before=formalFactsDigest();await expect(owner.stage('maker',input)).rejects.toThrow('CLOSED_INPUT_REQUIRED');
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 try{const url=await app.listen({host:'127.0.0.1',port:0});expect((await createOrganizationEvolutionClient(url,'maker').stage(input)).response.status).toBe(400);expect(formalFactsDigest()).toBe(before);}finally{await app.close();}
});

test('a changed independent Owner attestation invalidates approval instead of treating it as no impact',async()=>{
 const p=await prepare(await renameInput()),impactReviews=structuredClone(f.impactReviews);impactReviews[0]!.ownerAttestationAccepted=false;
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:p.staged.inputId,inputDigest:p.staged.digest,reason:'TEST POLICY ONLY withdrawn external Owner attestation',policyApproved:true,materialsAccepted:true,impactReviews});
 const before=formalFactsDigest();await expect(owner.applyUnit('maker',{candidateId:p.candidate.candidateId,requestId:p.requestId})).rejects.toThrow('STALE_VALIDATION');expect(formalFactsDigest()).toBe(before);
});

test('the whole-event budget includes generated permanent code facts and cannot silently partition a split',async()=>{
 const input=await splitInput();input.successors=Array.from({length:20},()=>f.department.entry());
 for(const successor of input.successors){successor.row.valid_from=input.event.effective_at;successor.row.established_on='2026-06-01';}
 input.relations=input.successors.map(successor=>({...input.relations[0]!,succession_id:randomUUID(),to_target_id:successor.row.org_id}));
 const staged=await owner.stage('maker',input);await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST POLICY ONLY complete bounded event',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});
 expect(await owner.validate('maker',{inputId:staged.inputId})).toMatchObject({decision:'FAIL',expandedCount:102,issues:expect.arrayContaining([expect.objectContaining({code:'PLAN_INPUT_LIMIT'})])});
 const candidate=await owner.plan('maker',{inputId:staged.inputId,requestId:randomUUID()}),before=formalFactsDigest();await expect(owner.approveApplyUnit('reviewer',candidate)).rejects.toThrow('PLAN_INPUT_LIMIT');expect(formalFactsDigest()).toBe(before);
});

test('an existing future revision blocks historical identity replacement and a later input revision invalidates approval',async()=>{
 const input=await renameInput(),id=input.predecessors[0]!.id,department=openDepartment(connection,provider);
 try{
  const original=await department.history('maker',id),entry=f.department.entry();entry.intent='REVISE';entry.target={owner:'department-master',id,expectedVersion:'1'};entry.row.org_code=original.initialCode;entry.row.valid_from='2026-12-01T00:00:00';
  const s=await department.stage('maker',await f.department.input([entry]));await department.verify('reviewer',{requestId:randomUUID(),inputId:s.inputId,inputDigest:s.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'TEST POLICY ONLY accepted future arrangement',evidenceId:entry.evidenceId}]});
  const requestId=randomUUID(),candidate=await department.plan('maker',{inputId:s.inputId,requestId});await department.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await department.approveApplyUnit('reviewer',candidate);expect((await department.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status).toBe('COMMITTED');
  input.predecessors[0]!.expectedVersion='2';const staged=await owner.stage('maker',input);expect((await owner.validate('maker',{inputId:staged.inputId})).issues).toEqual(expect.arrayContaining([expect.objectContaining({field:'predecessors',code:'STALE_VALIDATION'})]));
 }finally{await department.close();}
 const current=await renameInput(),p=await prepare(current);await catalog.importJobCommand('maker',{action:'REVISE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_EVOLUTION_REVISION',jobId:current.jobId,expectedCurrentRevision:current.revisionId,input:{kind:'METADATA_ONLY',declaredSha256:'b'.repeat(64)}});
 const before=formalFactsDigest();await expect(owner.applyUnit('maker',{candidateId:p.candidate.candidateId,requestId:p.requestId})).rejects.toThrow('STALE_REVISION');expect(formalFactsDigest()).toBe(before);
});

test('a past bounded attribute revision leaves the effective predecessor at T available for rename',async()=>{
 const input=await renameInput(),id=input.predecessors[0]!.id,department=openDepartment(connection,provider);
 try{
  const original=await department.history('maker',id),entry=f.department.entry();entry.intent='REVISE';entry.target={owner:'department-master',id,expectedVersion:'1'};entry.row.org_code=original.initialCode;entry.row.org_name='TEST POLICY ONLY bounded past label';entry.row.valid_to='2026-02-01T00:00:00';
  const staged=await department.stage('maker',await f.department.input([entry]));await department.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'TEST POLICY ONLY bounded past evidence',evidenceId:entry.evidenceId}]});
  const requestId=randomUUID(),candidate=await department.plan('maker',{inputId:staged.inputId,requestId});await department.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await department.approveApplyUnit('reviewer',candidate);expect((await department.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status).toBe('COMMITTED');
  expect((await department.read('maker',{id,campus:'NORTH',businessAt:input.event.effective_at})).version?.number).toBe('1');input.predecessors[0]!.expectedVersion='2';
  const p=await prepare(input),accepted=await owner.applyUnit('maker',{candidateId:p.candidate.candidateId,requestId:p.requestId});expect(accepted.status).toBe('COMMITTED');if(accepted.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
  const event=await owner.query('maker',{id:accepted.facts[0]!.id,campus:'NORTH',businessAt:input.event.effective_at});expect(event).toMatchObject({predecessors:[{id,version:'1'}],successors:[{id,version:'3'}]});expect((await department.history('maker',id)).versions[0]!.facts).toEqual(original.versions[0]!.facts);
 }finally{await department.close();}
});

test('the real service role cannot write evolution tables, read signing authority or forge an apply',async()=>{
 const pool=new Pool({connectionString:connection,max:1});try{
  for(const table of ['evolution_input','evolution_verification','evolution_event','evolution_relation','replacement'])await expect(pool.query(`INSERT INTO department_master.${table} DEFAULT VALUES`)).rejects.toMatchObject({code:'42501'});
  await expect(pool.query('SELECT key_hex FROM vnext_control.department_write_authority')).rejects.toMatchObject({code:'42501'});
  await expect(pool.query('SELECT department_master.evolution_mutate($1,$2)',[JSON.stringify({actor:'maker',operation:'APPLY',transaction:'0'}),'0'.repeat(64)])).rejects.toThrow('ACCESS_DENIED');
 }finally{await pool.end();}
});

test('materials and their contract source version cannot be paired with another logical source',async()=>{
 const input=await renameInput(),source=await f.newSource();input.sourceSystemId=source.id;
 const staged=await owner.stage('maker',input),verification={requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST POLICY ONLY verify original source material',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews};
 await expect(owner.verify('reviewer',verification)).rejects.toThrow('BLOCKED_DEPENDENCY');
 expect(Number(peer(receipt.name,`SELECT count(*) FROM department_master.evolution_verification WHERE input_id=${quote(staged.inputId)}::uuid;`))).toBe(0);
 expect(await owner.validate('maker',{inputId:staged.inputId})).toMatchObject({decision:'BLOCKED',issues:expect.arrayContaining([expect.objectContaining({field:'sourceSystemId',code:'BLOCKED_DEPENDENCY'})])});
});

test('a committed request remains recoverable after raw material expires while a new apply stays blocked',async()=>{
 const input=await renameInput(),proofJob=await f.newJob(),proof=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:proofJob.id,revisionId:proofJob.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:5},Buffer.from('TEST POLICY ONLY independently signed external Owner material with controlled expiry'));
 input.decisionEvidenceId=proof.artifactId;for(const impact of input.impacts)impact.evidenceId=proof.artifactId;
 const p=await prepare(input),command={candidateId:p.candidate.candidateId,requestId:p.requestId},accepted=await owner.applyUnit('maker',command);expect(accepted.status).toBe('COMMITTED');if(accepted.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
 await new Promise(resolve=>setTimeout(resolve,5100));
 expect((await owner.resumeOutcome('maker',command))?.facts).toEqual(accepted.facts);const replay=await owner.applyUnit('maker',command);expect(replay.status).toBe('COMMITTED');if(replay.status==='COMMITTED')expect(replay.facts).toEqual(accepted.facts);
 const next=await renameInput();next.decisionEvidenceId=proof.artifactId;for(const impact of next.impacts)impact.evidenceId=proof.artifactId;
 const staged=await owner.stage('maker',next);expect((await owner.validate('maker',{inputId:staged.inputId})).decision).toBe('BLOCKED');
});

test('generated HTTP clients execute a complete split and expose exact history, graph, template and source facts',async()=>{
 const department=openDepartment(connection,provider),app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,{owner:department,actor:r=>actor(r.headers)},undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 try{
  const url=await app.listen({host:'127.0.0.1',port:0}),maker=createOrganizationEvolutionClient(url,'maker'),reviewer=createOrganizationEvolutionClient(url,'reviewer'),input=await splitInput();
  const template=await maker.template({campus:'NORTH',contractId:f.eventContract.id,contractVersionId:f.eventContract.versionId,contracts:input.contracts});expect(template.response.status).toBe(200);expect(template.data?.contractVersions.map(item=>item.dataset)).toEqual(['ORG26','ORG27','ORG04']);
  const staged=await maker.stage(input);expect(staged.response.status).toBe(200);if(!staged.data)throw new Error('STAGE_FAILED');
  expect((await reviewer.verify({requestId:randomUUID(),inputId:staged.data.inputId,inputDigest:staged.data.digest,reason:'TEST POLICY ONLY current independent Owner material review',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews})).response.status).toBe(200);
  expect((await maker.validate({inputId:staged.data.inputId})).data).toMatchObject({decision:'PASS',validationRunId:null});
  const requestId=randomUUID(),candidate=await maker.plan({inputId:staged.data.inputId,requestId});expect(candidate.response.status).toBe(200);if(!candidate.data)throw new Error('PLAN_FAILED');
  const review=await reviewer.review({candidateId:candidate.data.candidateId});expect(review.response.status).toBe(200);expect(review.data).toMatchObject({inputCoverage:'COMPLETE',entries:{event:input.event,relations:input.relations},commandFacts:[{event:input.event,sourceArtifact:null}]});
  expect((await reviewer.approve(candidate.data)).response.status).toBe(200);const applied=await maker.apply({candidateId:candidate.data.candidateId,requestId});expect(applied.response.status).toBe(200);expect(applied.data?.status).toBe('COMMITTED');
  const id=applied.data?.facts?.[0]?.id;if(!id)throw new Error('COMMIT_UNKNOWN');const query={id,campus:'NORTH' as const,businessAt:input.event.effective_at};
  const departmentClient=createDepartmentClient(url,'maker'),source=input.predecessors[0]!.id;
  const before=await departmentClient.read({id:source,campus:'NORTH',businessAt:'2026-05-31T23:59:59.999999'});expect(before.response.status).toBe(200);expect(before.data?.businessState).toBe('ACTIVE');
  const at=await departmentClient.read({id:source,campus:'NORTH',businessAt:input.event.effective_at});expect(at.response.status).toBe(200);expect(at.data?.businessState).toBe('SUPERSEDED');
  const event=await maker.query(query);expect(event.response.status).toBe(200);expect(event.data?.relations).toHaveLength(2);expect(event.data?.handoff).toBe('NOT_EXECUTED');
  for(const successor of event.data!.successors){f.grantTarget(successor.id);const next=await departmentClient.read({id:successor.id,campus:'NORTH',businessAt:input.event.effective_at});expect(next.response.status).toBe(200);expect(next.data?.version?.evolution_event_id).toBe(id);expect(next.data?.version?.facts.sourcePin?.sourceId).toBe(f.source.id);}
  const graph=await maker.graph(query);expect(graph.response.status).toBe(200);expect(graph.data?.edges).toHaveLength(2);expect(graph.data?.nodes).toHaveLength(3);
  const history=await maker.history({...query,id:input.predecessors[0]!.id});expect(history.response.status).toBe(200);expect(history.data?.events.map(event=>event.id)).toEqual([id]);
  expect((await createOrganizationEvolutionClient(url,'outsider').query(query)).response.status).toBe(403);
  const malformed=await fetch(url+'/api/vnext/organization-evolutions/inputs',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify({...input,sourceRows:{event:100,relations:[100],successors:[]}})});expect(malformed.status).toBe(400);
 }finally{await app.close();await department.close();}
});

test('persistent fixture preparation reuses published policies and recovers the same synthetic predecessor',async()=>{
 const requests=new Map<string,string>(),commands=new Map<string,Record<string,unknown>>();
 const requestId=(name:string)=>{const existing=requests.get(name);if(existing)return existing;const id=randomUUID();requests.set(name,id);return id;};
 const freeze=<T extends Record<string,unknown>>(name:string,value:T):T=>{const existing=commands.get(name);if(existing)return existing as T;commands.set(name,structuredClone(value));return value;};
 const policies=await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'}),first=await persistentEvolutionFixture(receipt,catalog,provider,connection,requestId,freeze),second=await persistentEvolutionFixture(receipt,catalog,provider,connection,requestId,freeze);
 expect(second.input).toEqual(first.input);expect(second.predecessorId).toBe(first.predecessorId);expect(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).toEqual(policies);
 const p=await prepare(first.input);expect((await owner.applyUnit('maker',{candidateId:p.candidate.candidateId,requestId:p.requestId})).status).toBe('COMMITTED');
});

test('Department HTTP comparison preserves structured evolution provenance and does not report identical pins as changed',async()=>{
 const input=await splitInput(),split=await prepare(input),accepted=await owner.applyUnit('maker',{candidateId:split.candidate.candidateId,requestId:split.requestId});if(accepted.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
 const event=await owner.query('maker',{id:accepted.facts[0]!.id,campus:'NORTH',businessAt:input.event.effective_at}),id=event.successors[0]!.id;f.grantTarget(id);
 const renamed=await f.input();renamed.event.effective_at='2026-07-01T00:00:00';renamed.predecessors=[{owner:'department-master',id,expectedVersion:'1'}];renamed.relations[0]!.from_target_id=id;renamed.relations[0]!.to_target_id=id;
 const rename=await prepare(renamed);expect((await owner.applyUnit('maker',{candidateId:rename.candidate.candidateId,requestId:rename.requestId})).status).toBe('COMMITTED');
 const department=openDepartment(connection,provider),app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,{owner:department,actor:r=>actor(r.headers)});
 try{
  const url=await app.listen({host:'127.0.0.1',port:0}),client=createDepartmentClient(url,'maker'),first=await client.diff({id,fromVersion:'1',toVersion:'2'});expect(first.response.status).toBe(200);expect(first.data?.changes.map(change=>change.field)).not.toContain('sourcePin');
  const entry=f.department.entry();entry.intent='REVISE';entry.target={owner:'department-master',id,expectedVersion:'2'};entry.row.org_code=(await department.history('maker',id)).initialCode;entry.row.valid_from='2026-08-01T00:00:00';
  const staged=await department.stage('maker',await f.department.input([entry]));await department.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'TEST POLICY ONLY explicit ordinary revision after evolution',evidenceId:entry.evidenceId}]});
  const requestId=randomUUID(),candidate=await department.plan('maker',{inputId:staged.inputId,requestId});await department.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await department.approveApplyUnit('reviewer',candidate);expect((await department.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status).toBe('COMMITTED');
  const last=await client.diff({id,fromVersion:'1',toVersion:'3'});expect(last.response.status).toBe(200);expect(last.data?.changes).toEqual(expect.arrayContaining([expect.objectContaining({field:'sourcePin',before:expect.objectContaining({sourceId:f.source.id}),after:null})]));
 }finally{await app.close();await department.close();}
});

test('a replaced Department cannot be revived through the ordinary ORG04 public Owner',async()=>{
 const input=await splitInput(),p=await prepare(input);
 expect((await owner.applyUnit('maker',{candidateId:p.candidate.candidateId,requestId:p.requestId})).status).toBe('COMMITTED');
 const department=openDepartment(connection,provider);
 try{
  const id=input.predecessors[0]!.id,history=await department.history('maker',id),entry=f.department.entry();
  entry.intent='REVISE';entry.target={owner:'department-master',id,expectedVersion:'1'};entry.row.org_code=history.initialCode;entry.row.valid_from=input.event.effective_at;
  const staged=await department.stage('maker',await f.department.input([entry]));
  await department.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'TEST POLICY ONLY attempted revival',evidenceId:entry.evidenceId}]});
  expect(await department.validate('maker',{inputId:staged.inputId})).toMatchObject({decision:'BLOCKED',issues:expect.arrayContaining([{row:1,field:'target',code:'UNSUPPORTED_STATE_TRANSITION',status:'BLOCKED'}])});
 }finally{await department.close();}
});

test('RENAME preserves stable identity and the original business and record-time assertions',async()=>{
 const departments=openDepartment(connection,provider);
 try{
  const original=await departments.history('maker',f.targetId),oldR=original.versions[0]!.recorded_at;
  const input=await f.input(),staged=await owner.stage('maker',input);
  await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST POLICY ONLY independent material review',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});
  expect(await owner.validate('maker',{inputId:staged.inputId})).toMatchObject({decision:'PASS',issues:[]});
  const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});
  await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
  const accepted=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(accepted.status).toBe('COMMITTED');
  if(accepted.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
  const event=await owner.query('maker',{id:accepted.facts[0]!.id,campus:'NORTH',businessAt:input.event.effective_at});
  expect(event).toMatchObject({changeType:'RENAME',predecessors:[{id:f.targetId,version:'1'}],successors:[{id:f.targetId,version:'2'}],edges:[]});
  await expect(owner.query('maker',{id:accepted.facts[0]!.id,campus:'NORTH',businessAt:input.event.effective_at,recordAsOf:oldR.replace(' ','T')})).rejects.toThrow('NOT_FOUND');
  expect((await departments.read('maker',{id:f.targetId,campus:'NORTH',businessAt:'2026-05-31T23:59:59.999999'})).version?.facts.name).toBe(original.versions[0]!.facts.name);
  expect((await departments.read('maker',{id:f.targetId,campus:'NORTH',businessAt:input.event.effective_at})).version?.facts.name).toBe('DEMO renamed Department');
  expect((await departments.read('maker',{id:f.targetId,campus:'NORTH',businessAt:input.event.effective_at,recordAsOf:oldR.replace(' ','T')})).version?.facts.name).toBe(original.versions[0]!.facts.name);
  expect((await owner.resumeOutcome('maker',{candidateId:candidate.candidateId,requestId}))?.facts).toEqual(accepted.facts);
 }finally{await departments.close();}
});

test('P2-05-AC-01 a split creates both new successors and retires its predecessor at exactly T without historical fallback',async()=>{
 const source=await f.newDepartment();f.grantTarget(source);
 const input=await f.input(),a=f.department.entry(),b=f.department.entry();
 input.event.change_type='SPLIT';Object.assign(input.impacts.find(i=>i.domain==='IDENTIFIER')!,{determination:'AFFECTED',requiredAction:'TEST explicit Identifier Owner closure'});input.event.reason='TEST POLICY ONLY explicit split';input.predecessors=[{owner:'department-master',id:source,expectedVersion:'1'}];input.rename=null;input.successors=[a,b];input.contextEvidenceId=f.material.artifactId;
 for(const e of input.successors){e.row.valid_from=input.event.effective_at;e.row.established_on='2026-06-01';}
 input.relations=input.successors.map((e,i)=>({succession_id:randomUUID(),org_event_id:input.event.org_event_id,from_target_type:'ORG',from_target_id:source,to_target_type:'ORG',to_target_id:e.row.org_id,transfer_scope:i?'INPATIENT':'OUTPATIENT',context_rule:i?'Inpatient future business to C':'Outpatient future business to B',recorded_at:input.event.recorded_at}));
 const department=openDepartment(connection,provider);
 try{
  const old=(await department.history('maker',source)).versions[0]!;
  const p=await prepare(input),accepted=await owner.applyUnit('maker',{candidateId:p.candidate.candidateId,requestId:p.requestId});expect(accepted.status).toBe('COMMITTED');if(accepted.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
  const event=await owner.query('maker',{id:accepted.facts[0]!.id,campus:'NORTH',businessAt:input.event.effective_at});
  expect(event.edges).toHaveLength(2);expect(event.successors).toHaveLength(2);expect(new Set(event.successors.map(x=>x.id)).size).toBe(2);
  expect(event.successors.map(x=>x.id)).not.toContain(source);expect(event.successors.map(x=>x.id)).not.toContain(a.row.org_id);
  for(const successor of event.successors){f.grantTarget(successor.id);const h=await department.history('maker',successor.id);expect(h.versions).toHaveLength(1);expect((await department.exact('maker',{id:successor.id,version:'1'})).recordedAt).toBe(event.recordedAt);}
  expect(await department.read('maker',{id:source,campus:'NORTH',businessAt:'2026-05-31T23:59:59.999999'})).toMatchObject({businessState:'ACTIVE',version:{number:'1'}});
  expect(await department.read('maker',{id:source,campus:'NORTH',businessAt:input.event.effective_at})).toMatchObject({businessState:'SUPERSEDED',version:null});
  expect(await department.coverage('maker',{id:source,validFrom:input.event.effective_at,validTo:null})).toMatchObject({covered:false,parts:[{to:'2026-06-01T00:00:00.000000'}]});
  expect(await department.read('maker',{id:source,campus:'NORTH',businessAt:input.event.effective_at,recordAsOf:old.recorded_at.replace(' ','T')})).toMatchObject({businessState:'ACTIVE',version:{number:'1'}});
  expect((await department.history('maker',source)).versions).toEqual([old]);
 }finally{await department.close();}
});

test('P2-05-AC-02 a merge preserves both original sources and records one new successor',async()=>{
 const first=await f.newDepartment(),second=await f.newDepartment();f.grantTarget(first);f.grantTarget(second);
 const input=await f.input(),next=f.department.entry();input.event.change_type='MERGE';Object.assign(input.impacts.find(i=>i.domain==='IDENTIFIER')!,{determination:'AFFECTED',requiredAction:'TEST explicit Identifier Owner closure'});input.predecessors=[first,second].map(id=>({owner:'department-master',id,expectedVersion:'1'}));input.rename=null;input.successors=[next];next.row.valid_from=input.event.effective_at;next.row.established_on='2026-06-01';
 input.relations=[first,second].map(id=>({succession_id:randomUUID(),org_event_id:input.event.org_event_id,from_target_type:'ORG',from_target_id:id,to_target_type:'ORG',to_target_id:next.row.org_id,transfer_scope:'BUSINESS',context_rule:'',recorded_at:input.event.recorded_at}));
 const p=await prepare(input),accepted=await owner.applyUnit('maker',{candidateId:p.candidate.candidateId,requestId:p.requestId});expect(accepted.status).toBe('COMMITTED');if(accepted.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
 const event=await owner.query('maker',{id:accepted.facts[0]!.id,campus:'NORTH',businessAt:input.event.effective_at});expect(event.successors).toHaveLength(1);expect(event.predecessors.map(x=>x.id)).toEqual([first,second]);expect(event.edges.map(x=>x.from)).toEqual([first,second]);expect([first,second]).not.toContain(event.successors[0]!.id);
 const departments=openDepartment(connection,provider);try{for(const id of [first,second]){expect((await departments.history('maker',id)).versions).toHaveLength(1);expect(await departments.read('maker',{id,campus:'NORTH',businessAt:input.event.effective_at})).toMatchObject({businessState:'SUPERSEDED',version:null});}}finally{await departments.close();}
});

test('the real HTTP evolution endpoint accepts a complete candidate and preserves all original event and relation fields',async()=>{
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 try{
  const url=await app.listen({host:'127.0.0.1',port:0}),input=await f.input();
  const response=await fetch(url+'/api/vnext/organization-evolutions/inputs',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify(input)});
  expect(response.status).toBe(200);const staged=await response.json() as {inputId:string};
  const recovered=await fetch(url+'/api/vnext/organization-evolutions/inputs/read',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify({inputId:staged.inputId})});
  expect(recovered.status).toBe(200);const body=await recovered.json() as {event:unknown;relations:unknown};expect(body.event).toEqual(input.event);expect(body.relations).toEqual(input.relations);
 }finally{await app.close();}
});

test('a protected XLSX split preserves all three sheets and source rows through verification, approval and apply',async()=>{
 const input=await splitInput(),{requestId,jobId:_,revisionId:__,profile:___,event,relations,successors,...control}=input;
 const bytes=organizationWorkbook({ORG26:[ORG26_FIELDS,ORG26_FIELDS.map(field=>event[field])],ORG27:[ORG27_FIELDS,...relations.map(row=>ORG27_FIELDS.map(field=>row[field]))],ORG04:[ORG04_FIELDS,...successors.map(entry=>ORG04_FIELDS.map(field=>entry.row[field]))]});
 const received=await owner.receiveFile('maker',{requestId,fileRequestId:randomUUID(),job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_EVOLUTION_FILE',contractId:f.eventContract.id,contractVersionId:f.eventContract.versionId,profile:'CORE',input:{kind:'FILE',format:'XLSX',parserPolicy:'STRICT_ORGANIZATION_EVOLUTION_V1'}},retentionSeconds:3600,...control,successors:successors.map(({row:_,...entry})=>entry)},bytes);
 expect(received).toMatchObject({structuralStatus:'PARSED',input:{inputId:expect.any(String)}});if(!received.input)throw new Error('FILE_NOT_STAGED');
 const read=await owner.readInput('maker',{inputId:received.input.inputId});expect(read.event).toEqual(event);expect(read.relations).toEqual(relations);expect(read.successors).toEqual(successors);expect(read.sourceRows).toEqual({event:2,relations:[2,3],successors:[2,3]});
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:received.input.inputId,inputDigest:received.input.digest,reason:'TEST POLICY ONLY independently inspect XLSX material',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});
 expect(await owner.validate('maker',{inputId:received.input.inputId})).toMatchObject({decision:'PASS',validationRunId:expect.any(String)});
 const executeId=randomUUID(),candidate=await owner.plan('maker',{inputId:received.input.inputId,requestId:executeId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 const accepted=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId:executeId});expect(accepted.status).toBe('COMMITTED');if(accepted.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
 const committed=await owner.query('maker',{id:accepted.facts[0]!.id,campus:'NORTH',businessAt:event.effective_at});expect(committed.relations.map(row=>row.source_row)).toEqual([2,3]);
 expect(committed.aliasMap.filter(binding=>binding.dataset==='ORG04').map(binding=>({sourceClientKey:binding.sourceClientKey,sourceRow:binding.sourceRow}))).toEqual(successors.map((successor,index)=>({sourceClientKey:successor.row.org_id,sourceRow:index+2})));
});

test('an invalid file row blocks the complete event while the protected original bytes remain unchanged',async()=>{
 const input=await splitInput(),{requestId,jobId:_,revisionId:__,profile:___,event,relations,successors,...control}=input;
 const bytes=organizationWorkbook({ORG26:[ORG26_FIELDS,ORG26_FIELDS.map(field=>event[field])],ORG27:[ORG27_FIELDS,...relations.map(row=>ORG27_FIELDS.map(field=>row[field]))],ORG04:[[...ORG04_FIELDS,'unapproved_field'],...successors.map(entry=>[...ORG04_FIELDS.map(field=>entry.row[field]),'FORBIDDEN'])]});
 const before=formalFactsDigest(),received=await owner.receiveFile('maker',{requestId,fileRequestId:randomUUID(),job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_BAD_EVOLUTION_FILE',contractId:f.eventContract.id,contractVersionId:f.eventContract.versionId,profile:'CORE',input:{kind:'FILE',format:'XLSX',parserPolicy:'STRICT_ORGANIZATION_EVOLUTION_V1'}},retentionSeconds:3600,...control,successors:successors.map(({row:_,...entry})=>entry)},bytes);
 expect(received).toMatchObject({structuralStatus:'REJECTED',input:null,issues:[expect.objectContaining({code:'FIELD_CONTRACT',sheet:'ORG04',status:'FAIL'})]});expect(formalFactsDigest()).toBe(before);
 await expect(catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:received.sourceArtifactId})).rejects.toThrow('ACCESS_DENIED');
 // Test-administrator inspection proves quarantine preserves the exact bytes;
 // it does not grant the public Catalog a bypass around unresolved references.
 const proofText=peer(receipt.name,`SELECT jsonb_build_object('binding',jsonb_build_array(a.job_id,a.revision_id,a.kind,a.campus,a.purpose,a.request_id),'envelope',jsonb_build_object('keyId',p.key_id,'nonce',encode(p.nonce,'hex'),'tag',encode(p.tag,'hex'),'ciphertext',encode(p.ciphertext,'hex')))::text FROM governance_catalog.protected_artifact a JOIN governance_catalog.protected_payload p ON p.artifact_id=a.id WHERE a.id=${quote(received.sourceArtifactId)}::uuid;`,{sensitive:true});
 const proof=JSON.parse(proofText.split(/\r?\n/).find(line=>line.startsWith('{'))!);
 const retained=authenticateRegistrationEvidence(proof,provider);try{expect(Buffer.from(retained)).toEqual(bytes);}finally{retained.fill(0);}
});
