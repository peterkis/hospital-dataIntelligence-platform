import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,test,expect} from 'vitest';
import {openCatalog,type Catalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {wardNursingFixture} from './p3-05-fixture.js';
import {validationKeys} from './p3-05-validation-keys.mjs';
import {peer,quote} from './lineage.mjs';
import type {WardNursingEntry,WardNursingVerification,WardNursingStage} from '../../apps/governance-api/src/modules/care-organization/index.js';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Catalog,f:Awaited<ReturnType<typeof wardNursingFixture>>;
beforeAll(async()=>{const provider=validationKeys(receipt),pool=new Pool({connectionString:connection,max:1});try{catalog=await openCatalog(connection,provider);const role=(await pool.query('select current_user r')).rows[0]!.r;f=await wardNursingFixture(receipt,role,catalog,provider,connection,process.env['VNEXT_P3_05_UPGRADED']==='1');}finally{await pool.end();}});
afterAll(async()=>{await f?.close();await catalog?.close();});

test('AC01: independently approved disjoint partitions have separate primary Nursing coverage',async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),set=await f.register(a),left=f.entry(a,f.partition(set,[0])),right=f.entry(b,f.partition(set,[1]));
 expect(set.partitions.map(p=>p.sourceAlias)).toEqual(['A','B']);expect(new Set(set.partitions.map(p=>p.id)).size).toBe(2);
 const out=await f.apply(await f.input([left,right]));expect(out.facts).toHaveLength(2);
 const evaluation=await f.owner.evaluateWindow('maker',{applicability:{ward:a.ward,campus:a.campus,purpose:a.purpose},coverage:{kind:'WHOLE_WARD'},validFrom:'2026-01-01T00:00:00',validTo:'2026-04-01T00:00:00',mode:'CURRENT_ADMISSION'});
 expect(evaluation).toMatchObject({declaredCovered:true,primaryCovered:true,currentAdmissionCovered:true,status:'SATISFIED',clinicalReadiness:'NOT_READY'});
});
const end=(e:WardNursingEntry,id:string,head:string,at:string):WardNursingEntry=>({...e,action:'END',target:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:head},endAt:at,row:{...e.row,record_status:'RETIRED'}});
test('AC02: same, partially intersecting and whole-Ward primary coverage are blocked',async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),set=await f.register(a),left=f.entry(a,f.partition(set,[0]));await f.apply(await f.input([left]));
 for(const scope of [f.partition(set,[0]),f.partition(set,[0,1]),{kind:'WHOLE_WARD'} as const])await expect(f.apply(await f.input([f.entry(b,scope)]))).rejects.toThrow('WARD_NURSING_PRIMARY_CONFLICT');
});
test('AC03: unknown, foreign and wrong-version partitions are not guessed or published',async()=>{
 const a=await f.endpoint(),set=await f.register(a),other=await f.endpoint(),foreign=await f.register(other),scopes=[{kind:'PARTITIONS' as const,scopeSetId:set.id,version:'1',partitionIds:[randomUUID()]},f.partition(foreign,[0]),{...f.partition(set,[0]),version:'2'}];
 for(const coverage of scopes){const entry=f.entry(a,coverage),value=await f.input([entry]),staged=await f.owner.stage('maker',value);await f.owner.verify('reviewer',f.verification(value,staged));const preview=await f.owner.preview('maker',{inputId:staged.inputId});expect(preview.decision).toBe('BLOCKED');expect(preview.issues.some(i=>['UNKNOWN_COVERAGE_SCOPE','SCOPE_BASIS_MISMATCH'].includes(i.code))).toBe(true);expect(await f.owner.readInput('maker',{inputId:staged.inputId})).toEqual(value);}
});
test('AC04: END has exact microsecond boundaries and preserves original B/R and terminal cancellation',async()=>{
 const a=await f.endpoint(),entry=f.entry(a),out=await f.apply(await f.input([entry])),id=out.facts[0]!.id,original=await f.owner.exact('maker',{id,version:'1'}),at='2026-03-01T00:00:00.000001';
 await f.apply(await f.input([end(entry,id,'1',at)]));expect((await f.owner.read('maker',{id,businessAt:'2026-03-01T00:00:00.000000'})).state).toBe('ACTIVE');expect((await f.owner.read('maker',{id,businessAt:at})).state).toBe('ENDED');expect((await f.owner.read('maker',{id,businessAt:at,recordAsOf:out.recordedAt})).state).toBe('ACTIVE');expect(await f.owner.exact('maker',{id,version:'1'})).toEqual(original);
 await f.apply(await f.input([end(entry,id,'2',entry.row.valid_from)]));expect((await f.owner.read('maker',{id,businessAt:entry.row.valid_from})).state).toBe('ENDED');await expect(f.apply(await f.input([end(entry,id,'3',at)]))).rejects.toThrow('WARD_NURSING_ENDED');
});
test('AC05: unconfirmed handover rejects the entire revision; exact confirmed handover is atomic',async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),entry=f.entry(a),first=await f.apply(await f.input([entry])),id=first.facts[0]!.id,T='2026-04-01T00:00:00',successor=f.entry(b),incoming={...successor,row:{...successor.row,valid_from:T,handover_rule_ref:'TEST_NURSING_HANDOVER'}},value=await f.input([end(entry,id,'1',T),incoming]);
 await expect(f.apply(value)).rejects.toThrow('HANDOVER_CONFIRMATION_REQUIRED');expect((await f.owner.history('maker',{id})).versions).toHaveLength(1);
 const confirm=(v:WardNursingVerification):WardNursingVerification=>({...v,rows:v.rows.map(row=>row.row===2?{...row,handover:{kind:'CONFIRMED_HANDOVER',source:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},successorSourceAlias:incoming.row.ward_nursing_rel_id,successorNursing:b.nursing,coverage:incoming.coverage,cutover:T,ruleReference:'TEST_NURSING_HANDOVER',ruleVersion:'TEST_POLICY_ONLY_1',evidenceId:f.artifact.artifactId,confirmed:true}}:row)});
 const out=await f.apply(await f.input([end(entry,id,'1',T),incoming]),confirm);expect(out.facts).toHaveLength(2);const next=out.facts[1]!.id;expect((await f.owner.read('maker',{id,businessAt:T})).state).toBe('ENDED');expect((await f.owner.read('maker',{id:next,businessAt:T})).state).toBe('ACTIVE');expect((await f.owner.read('maker',{id,businessAt:T,recordAsOf:first.recordedAt})).state).toBe('ACTIVE');
 const assessed=await f.owner.evaluateWindow('maker',{applicability:{ward:a.ward,campus:a.campus,purpose:a.purpose},coverage:{kind:'WHOLE_WARD'},validFrom:'2026-03-01T00:00:00',validTo:'2026-05-01T00:00:00',mode:'CURRENT_ADMISSION'});expect(assessed).toMatchObject({declaredCovered:true,primaryCovered:true,currentAdmissionCovered:true});expect(assessed.handovers).toEqual(expect.arrayContaining([expect.objectContaining({relationId:next,status:'CONFIRMED_SCHEDULED'}),expect.objectContaining({relationId:id,status:'CONFIRMED_SCHEDULED'})]));expect((await f.owner.read('maker',{id,businessAt:T})).handoverStatus).toBe('CONFIRMED_EFFECTIVE');
});
test('ending first cannot bypass independent confirmation for a later replacement primary',async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),entry=f.entry(a),out=await f.apply(await f.input([entry])),id=out.facts[0]!.id,T='2026-04-01T00:00:00';await f.apply(await f.input([end(entry,id,'1',T)]));const incoming=f.entry(b);await expect(f.apply(await f.input([{...incoming,row:{...incoming.row,valid_from:T}}]))).rejects.toThrow('HANDOVER_CONFIRMATION_REQUIRED');
});
test('latest finite declarations do not fall back to the original unbounded version',async()=>{
 const a=await f.endpoint(),entry=f.entry(a),out=await f.apply(await f.input([entry])),id=out.facts[0]!.id;await f.apply(await f.input([{...entry,action:'REVISE',target:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},row:{...entry.row,valid_to:'2026-03-01T00:00:00'}}]));expect((await f.owner.read('maker',{id,businessAt:'2026-04-01T00:00:00'})).state).toBe('NOT_EFFECTIVE');expect((await f.owner.read('maker',{id,businessAt:'2026-04-01T00:00:00',recordAsOf:out.recordedAt})).state).toBe('ACTIVE');
});
test('current underlying identity, source aliases and exact durable replay govern the public Owner',async()=>{
 const granted=await f.endpoint();peer(receipt.name,`INSERT INTO care_organization.ward_nursing_access SELECT 'maker-alias',${quote(granted.campus.id)}::uuid,'NORTH',p FROM unnest(ARRAY['VERIFY','REVIEW']) p ON CONFLICT DO NOTHING;`);
 const a=granted,value=await f.input([f.entry(a)]),i=await f.owner.stage('maker',value);await expect(f.owner.verify('maker-alias',f.verification(value,i))).rejects.toThrow('MAKER_CHECKER_REQUIRED');await f.owner.verify('reviewer',f.verification(value,i));const requestId=randomUUID(),q=await f.owner.plan('maker',{inputId:i.inputId,requestId});await expect(f.owner.approveApplyUnit('maker-alias',q)).rejects.toThrow('MAKER_CHECKER_REQUIRED');
 // The seed has no SERVICE reviewer with this complete grant matrix. Change
 // only the actual authority-fixture registry kind; requests remain unchanged.
 const originalKind=peer(receipt.name,"SELECT principal_kind FROM vnext_control.actor WHERE code='reviewer';");expect(originalKind).toBe('HUMAN');const pool=new Pool({connectionString:connection,max:1});
 try{
  peer(receipt.name,"UPDATE vnext_control.actor SET principal_kind='SERVICE' WHERE code='reviewer' AND principal_kind='HUMAN';");expect(peer(receipt.name,"SELECT principal_kind FROM vnext_control.actor WHERE code='reviewer';")).toBe('SERVICE');
  await expect(f.owner.verify('reviewer',f.verification(value,i))).rejects.toThrow('ACCESS_DENIED');await expect(f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId})).rejects.toThrow('ACCESS_DENIED');await expect(f.owner.approveApplyUnit('reviewer',q)).rejects.toThrow('ACCESS_DENIED');
  expect((await pool.query('select current_user r')).rows[0]!.r).toMatch(/^hdi_(validation|owner)_[a-f0-9]{16}$/);
  for(const permission of ['VERIFY','REVIEW'])await expect(pool.query('select care_organization.ward_nursing_authorize($1,$2::uuid,$3)',['reviewer',a.campus.id,permission])).rejects.toMatchObject({message:'ACCESS_DENIED'});
 }finally{
  try{peer(receipt.name,`UPDATE vnext_control.actor SET principal_kind=${quote(originalKind)} WHERE code='reviewer' AND principal_kind='SERVICE';`);expect(peer(receipt.name,"SELECT principal_kind FROM vnext_control.actor WHERE code='reviewer';")).toBe(originalKind);}finally{await pool.end();}
 }
 await f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId});await f.owner.approveApplyUnit('reviewer',q);const request={candidateId:q.candidateId,requestId},out=await f.owner.applyUnit('maker',request);expect(out.status).toBe('COMMITTED');expect(await f.owner.applyUnit('maker',request)).toEqual(out);if(out.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');const {responseStatus,...durable}=out;expect(await f.owner.resumeOutcome('maker',request)).toEqual(durable);expect((await f.owner.reconcileCommittedUnit('maker',request)).status).toBe('MATCHED');await expect(f.owner.read('outsider',{id:out.facts[0]!.id})).rejects.toThrow('ACCESS_DENIED');
});
