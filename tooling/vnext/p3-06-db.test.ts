import {test,expect,afterAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID,createHmac} from 'node:crypto';
import {openCatalog,LocalSyntheticKeyProvider,canonicalPlan,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {locationFixture} from './p3-06-fixture.js';
import {Pool,Client,type QueryConfig} from 'pg';
import {locationAt,type LocationHistory,type LocationEntry} from '../../apps/governance-api/src/modules/location-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {createLocationClient} from '../../packages/generated-api-client/src/index.js';
import {ORG12_FIELDS} from '../../apps/governance-api/src/modules/location-master/index.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
import {peer,quote} from './lineage.mjs';
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider(),catalog=await openCatalog(connection,provider);
const pool=new Pool({connectionString:connection,max:1}),role=(await pool.query('select current_user r')).rows[0].r;await pool.end();
const f=await locationFixture(receipt,role,catalog,provider,connection);
afterAll(async()=>{await f.owner.close();await f.campus.close();await catalog.close();});
test('P3-06-AC-04 a planning campus can maintain a physical tree without an address or clinical authority',async()=>{
 const campusId=await f.newCampus(),entries=f.tree(campusId),outcome=await f.apply(await f.input(campusId,entries));
 expect(outcome.facts).toHaveLength(4);expect(new Set(outcome.facts.map(v=>v.id)).size).toBe(4);expect(outcome.facts.map(v=>v.id)).not.toContain('R');
 const tree=await f.owner.tree('maker',{campusId,businessAt:'2026-03-01T00:00:00'});expect(tree.items).toHaveLength(4);
 const room=tree.items.find(v=>v.version.facts.locationType==='ROOM')!;expect(room.version.facts.addressDetail).toBeNull();expect(room.version.facts.roomNumber).toBe('001');
});

async function populated(){const campusId=await f.newCampus(),outcome=await f.apply(await f.input(campusId,f.tree(campusId)));const room=await f.owner.history('maker',{id:outcome.facts[3]!.id});return {campusId,outcome,room};}
function revision(h:LocationHistory,action:'REVISE'|'CLOSE'|'MOVE_CONTAINMENT',at='2026-03-01T00:00:00'):LocationEntry {
 const head=h.versions.at(-1)!,v=action==='CLOSE'?(locationAt(h,at)??head):head,row={...f.row(h.campusId,v.facts.locationType,v.facts.source.sourceAlias,v.facts.parentId??''),location_code:v.facts.locationCode,location_name:v.facts.locationName,floor_label:v.facts.floorLabel??'',room_number:v.facts.roomNumber??'',address_detail:v.facts.addressDetail??'',is_accessible:v.facts.isAccessible??'',valid_from:at,record_status:action==='CLOSE'?'RETIRED':'ACTIVE'};
 const common={target:{owner:'location-master' as const,id:h.id,expectedVersion:head.number},row,reason:'TEST POLICY ONLY explicit change',evidenceId:f.artifact.artifactId};
 return action==='MOVE_CONTAINMENT'?{...common,action,parent:v.facts.parentId?{kind:'EXISTING',reference:{owner:'location-master',id:v.facts.parentId}}:null}:{...common,action};
}
test('P3-06-AC-02 rename and room renumber preserve identity, exact history and old R',async()=>{
 const {campusId,room}=await populated(),entry=revision(room,'REVISE');entry.row.location_name='TEST renamed';entry.row.room_number='002';
 await f.apply(await f.input(campusId,[entry]));
 expect((await f.owner.history('maker',{id:room.id})).versions).toHaveLength(2);
 expect((await f.owner.read('maker',{id:room.id,businessAt:'2026-04-01T00:00:00'})).version!.facts.roomNumber).toBe('002');
 expect((await f.owner.read('maker',{id:room.id,businessAt:'2026-04-01T00:00:00',recordAsOf:room.versions[0]!.recordedAt})).version!.facts.roomNumber).toBe('001');
 expect((await f.owner.exact('maker',{id:room.id,version:'1'})).facts.locationName).toBe('TEST location');
});
test('P3-06-AC-05 a bad final row and a late cycle leave no physical locations',async()=>{
 const campusId=await f.newCampus(),entries=f.tree(campusId);entries[3]!.row.room_number='';
 await expect(f.prepare(await f.input(campusId,entries))).rejects.toThrow('ROOM_NUMBER_REQUIRED');expect((await f.owner.tree('maker',{campusId})).items).toHaveLength(0);
 entries[3]!.row.room_number='001';const root=entries[0]!;if(root.action!=='CREATE')throw new Error();root.parent={kind:'ALIAS',clientKey:'R'};root.row.parent_location_id='R';
 await expect(f.prepare(await f.input(campusId,entries))).rejects.toThrow('LOCATION_CYCLE');expect((await f.owner.tree('maker',{campusId})).items).toHaveLength(0);
});
test('P3-06-AC-03 a split terminates its predecessor and creates two new identities with frozen association evidence',async()=>{
 const {campusId,room}=await populated(),close=revision(room,'CLOSE');if(close.action!=='CLOSE')throw new Error();const parent=room.versions[0]!.facts.parentId!;
 const successors=['NEW_A','NEW_B'].map(alias=>({row:{...f.row(campusId,'ROOM',alias,parent),valid_from:close.row.valid_from},parent:{kind:'EXISTING' as const,reference:{owner:'location-master' as const,id:parent}},evidenceId:f.artifact.artifactId}));
 const result=await f.apply(await f.input(campusId,[{...close,action:'SPLIT',successors}]));expect(result.facts).toHaveLength(3);expect(new Set(result.facts.map(v=>v.id)).size).toBe(3);
 expect((await f.owner.read('maker',{id:room.id,businessAt:'2026-04-01T00:00:00'})).state).toBe('CLOSED');
 const changeId=(await f.owner.history('maker',{id:room.id})).versions.at(-1)!.changeId!;const change=await f.owner.readChange('maker',{id:changeId});expect(change.splits.map(s=>s.predecessorId)).toEqual([room.id,room.id]);expect(new Set(change.splits.map(s=>s.successorId)).size).toBe(2);expect(change.splits.map(s=>s.predecessorVersion)).toEqual(['1','1']);expect(change.splits.map(s=>s.predecessorVersionId)).toEqual([room.versions[0]!.id,room.versions[0]!.id]);
});
test('a non-leaf closure requires explicit disposition and cannot silently close descendants',async()=>{
 const {campusId,outcome}=await populated(),floor=await f.owner.history('maker',{id:outcome.facts[2]!.id});
 await expect(f.prepare(await f.input(campusId,[revision(floor,'CLOSE')]))).rejects.toThrow('PARENT_PERIOD_NOT_COVERED');expect((await f.owner.tree('maker',{campusId,businessAt:'2026-04-01T00:00:00'})).items).toHaveLength(4);
});
test('same request replay returns the exact committed identities and revoked reading authority cannot replay',async()=>{
 const campusId=await f.newCampus(),request=await f.prepare(await f.input(campusId,f.tree(campusId))),first=await f.owner.applyUnit('maker',request);expect(first.status).toBe('COMMITTED');expect(await f.owner.applyUnit('maker',request)).toEqual(first);expect((await f.owner.reconcileCommittedUnit('maker',request)).status).toBe('MATCHED');
 await expect(f.owner.resumeOutcome('outsider',request)).rejects.toThrow('ACCESS_DENIED');
});
test('real restricted SQL cannot read domain tables or forge a mutation',async()=>{
 const p=new Pool({connectionString:connection});try{await expect(p.query('select * from location_master.version')).rejects.toMatchObject({code:'42501'});await expect(p.query("select location_master.mutate('{}','bad')")).rejects.toMatchObject({message:'ACCESS_DENIED'});}finally{await p.end();}
});
test('generated-client real HTTP can execute, read and replay an approved Location unit',async()=>{
 const campusId=await f.newCampus(),value=await f.input(campusId,f.tree(campusId)),app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner:f.owner,actor:r=>actor(r.headers)});
 try{
  const url=await app.listen({host:'127.0.0.1',port:0}),maker=createLocationClient(url,'maker'),reviewer=createLocationClient(url,'reviewer');
  const staged=await maker.stage(value);expect(staged.response.status).toBe(200);if(!staged.data)throw new Error('NO_STAGE');
  expect((await reviewer.verify({requestId:randomUUID(),inputId:staged.data.inputId,inputDigest:staged.data.digest,evidenceId:f.artifact.artifactId,reason:'TEST POLICY ONLY HTTP verification',physicalFactsAccepted:true,policyVersion:'ORG12_CORE_V1'})).response.status).toBe(200);
  const requestId=randomUUID(),planned=await maker.plan({inputId:staged.data.inputId,requestId});expect(planned.response.status).toBe(200);if(!planned.data)throw new Error('NO_PLAN');
  expect((await reviewer.review({candidateId:planned.data.candidateId})).response.status).toBe(200);expect((await reviewer.approve(planned.data)).response.status).toBe(200);
  const request={candidateId:planned.data.candidateId,requestId},applied=await maker.apply(request);expect(applied.response.status).toBe(200);expect(applied.data?.status).toBe('COMMITTED');expect((await maker.apply(request)).data).toEqual(applied.data);
  expect((await maker.tree({campusId,businessAt:'2026-03-01T00:00:00'})).data?.items).toHaveLength(4);expect((await createLocationClient(url,'outsider').tree({campusId})).response.status).toBe(403);
 }finally{await app.close();}
});
test('a permanent closure can precede an already scheduled future revision',async()=>{
 const {campusId,room}=await populated(),scheduled=revision(room,'REVISE','2027-06-01T00:00:00');await f.apply(await f.input(campusId,[scheduled]));const current=await f.owner.history('maker',{id:room.id});
 await f.apply(await f.input(campusId,[revision(current,'CLOSE','2027-03-01T00:00:00')]));
 expect((await f.owner.read('maker',{id:room.id,businessAt:'2027-07-01T00:00:00'})).state).toBe('CLOSED');
});
test('concurrent approved trees cannot create two active roots in one campus',async()=>{
 const campusId=await f.newCampus(),first=await f.prepare(await f.input(campusId,f.tree(campusId))),second=await f.prepare(await f.input(campusId,f.tree(campusId)));
 const results=await Promise.allSettled([f.owner.applyUnit('maker',first),f.owner.applyUnit('maker',second)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);expect((await f.owner.tree('maker',{campusId})).items).toHaveLength(4);
});
test('FULL input cannot be downgraded and maker aliases cannot verify or approve',async()=>{
 const campusId=await f.newCampus(),value=await f.input(campusId,f.tree(campusId)),staged=await f.owner.stage('maker',{...value,profile:'FULL'});
 await expect(f.owner.verify('maker-alias',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,evidenceId:f.artifact.artifactId,reason:'TEST alias',physicalFactsAccepted:true,policyVersion:'ORG12_CORE_V1'})).rejects.toThrow('ACCESS_DENIED');
 await f.owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,evidenceId:f.artifact.artifactId,reason:'TEST FULL retention',physicalFactsAccepted:true,policyVersion:'ORG12_CORE_V1'});
 const candidate=await f.owner.plan('maker',{inputId:staged.inputId,requestId:randomUUID()});await f.owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await expect(f.owner.approveApplyUnit('reviewer',candidate)).rejects.toThrow('BLOCKED_DEPENDENCY');expect((await f.owner.tree('maker',{campusId})).items).toHaveLength(0);
});
test.each(['CSV','JSON','XLSX'] as const)('ORG12 %s keeps all 18 original fields, preserves leading zeros and applies through the same Owner',async format=>{
 const campusId=await f.newCampus(),entry=f.entry(campusId,'CAMPUS','0001',null);if(entry.action!=='CREATE')throw new Error();
 const {row,...operation}=entry,bytes=format==='JSON'?Buffer.from(JSON.stringify([row])):format==='CSV'?Buffer.from(ORG12_FIELDS.join(',')+'\r\n'+ORG12_FIELDS.map(field=>row[field]).join(',')+'\r\n'):organizationWorkbook({ORG12:[ORG12_FIELDS,ORG12_FIELDS.map(field=>row[field])]});
 const received=await f.owner.receiveFile('maker',{requestId:randomUUID(),fileRequestId:randomUUID(),job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_LOCATION',contractId:f.contract.id,contractVersionId:f.contract.versionId,profile:'CORE',input:{kind:'FILE',format,parserPolicy:'STRICT_LOCATION_V1'}},campus:'NORTH',campusId,timePolicy:'LOCAL',retentionSeconds:7200,operations:[operation]},bytes);
 expect(received.structuralStatus).toBe('PARSED');expect(received.issues).toEqual([]);expect(received.input).not.toBeNull();if(!received.input)throw new Error();
 expect((await f.owner.readInput('maker',{inputId:received.input.inputId})).entries[0]!.row).toEqual(row);
 await f.owner.verify('reviewer',{requestId:randomUUID(),inputId:received.input.inputId,inputDigest:received.input.digest,evidenceId:f.artifact.artifactId,reason:'TEST POLICY ONLY file verification',physicalFactsAccepted:true,policyVersion:'ORG12_CORE_V1'});
 const requestId=randomUUID(),candidate=await f.owner.plan('maker',{inputId:received.input.inputId,requestId});await f.owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await f.owner.approveApplyUnit('reviewer',candidate);const result=await f.owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(result.status).toBe('COMMITTED');
 if(result.status!=='COMMITTED')throw new Error();expect((await f.owner.history('maker',{id:result.facts[0]!.id})).versions[0]!.facts.source.sourceAlias).toBe('0001');
});
test('renaming a code preserves its original location claim permanently',async()=>{
 const {campusId,room}=await populated(),oldCode=room.versions[0]!.facts.locationCode,changed=revision(room,'REVISE');changed.row.location_code='TEST_CHANGED_'+randomUUID();await f.apply(await f.input(campusId,[changed]));
 const parent=room.versions[0]!.facts.parentId!,entry=f.entry(campusId,'ROOM','REUSE',null);if(entry.action!=='CREATE')throw new Error();entry.parent={kind:'EXISTING',reference:{owner:'location-master',id:parent}};entry.row.parent_location_id=parent;entry.row.location_code=oldCode;
 await expect(f.prepare(await f.input(campusId,[entry]))).rejects.toThrow('LOCATION_CODE_CONFLICT');
});
test('closure is possible after campus permanently retires, while a new location remains blocked',async()=>{
 const {campusId,room}=await populated();expect((await f.retireCampus(campusId,'2026-02-01T00:00:00')).status).toBe('COMMITTED');
 const revisionEntry=revision(room,'REVISE');await expect(f.prepare(await f.input(campusId,[revisionEntry]))).rejects.toThrow('BLOCKED_DEPENDENCY');
 await f.apply(await f.input(campusId,[revision(room,'CLOSE')]));expect((await f.owner.read('maker',{id:room.id,businessAt:'2026-04-01T00:00:00'})).state).toBe('CLOSED');
});
test('verification checks underlying identity even when the same person has a review grant',async()=>{
 const campusId=await f.newCampus(),staged=await f.owner.stage('maker',await f.input(campusId,f.tree(campusId)));
 peer(receipt.name,`INSERT INTO location_master.access SELECT 'maker-alias',${quote(campusId)}::uuid,'NORTH',p FROM unnest(ARRAY['VERIFY','REVIEW']) p;`);
 await expect(f.owner.verify('maker-alias',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,evidenceId:f.artifact.artifactId,reason:'TEST same human',physicalFactsAccepted:true,policyVersion:'ORG12_CORE_V1'})).rejects.toThrow('MAKER_CHECKER_REQUIRED');
});

test('same-campus containment move explicitly disposes a child when its old floor closes',async()=>{
 const {campusId,outcome,room}=await populated(),oldFloor=await f.owner.history('maker',{id:outcome.facts[2]!.id}),building=outcome.facts[1]!.id;
 const floor=f.entry(campusId,'FLOOR','NEW_FLOOR',null);if(floor.action!=='CREATE')throw new Error();floor.parent={kind:'EXISTING',reference:{owner:'location-master',id:building}};floor.row.parent_location_id=building;
 const created=await f.apply(await f.input(campusId,[floor])),newFloor=created.facts[0]!.id,move=revision(room,'MOVE_CONTAINMENT');if(move.action!=='MOVE_CONTAINMENT')throw new Error();move.parent={kind:'EXISTING',reference:{owner:'location-master',id:newFloor}};move.row.parent_location_id=newFloor;
 await f.apply(await f.input(campusId,[revision(oldFloor,'CLOSE'),move]));
 expect((await f.owner.read('maker',{id:oldFloor.id,businessAt:'2026-04-01T00:00:00'})).state).toBe('CLOSED');expect((await f.owner.read('maker',{id:room.id,businessAt:'2026-04-01T00:00:00'})).version!.facts.parentId).toBe(newFloor);
 expect((await f.owner.read('maker',{id:room.id,businessAt:'2026-04-01T00:00:00',recordAsOf:room.versions[0]!.recordedAt})).version!.facts.parentId).toBe(oldFloor.id);
});

test('a failed split successor leaves predecessor and every successor unchanged',async()=>{
 const {campusId,room}=await populated(),close=revision(room,'CLOSE');if(close.action!=='CLOSE')throw new Error();const parent=room.versions[0]!.facts.parentId!;
 const successors=['FAIL_A','FAIL_B'].map(alias=>({row:{...f.row(campusId,'ROOM',alias,parent),valid_from:close.row.valid_from},parent:{kind:'EXISTING' as const,reference:{owner:'location-master' as const,id:parent}},evidenceId:f.artifact.artifactId}));successors[1]!.row.room_number='';
 await expect(f.prepare(await f.input(campusId,[{...close,action:'SPLIT',successors}]))).rejects.toThrow('ROOM_NUMBER_REQUIRED');
 expect((await f.owner.history('maker',{id:room.id})).versions).toHaveLength(1);expect((await f.owner.tree('maker',{campusId,businessAt:'2026-04-01T00:00:00'})).items).toHaveLength(4);
});

test('reusing a stage request with changed content conflicts and revoked approval cannot apply',async()=>{
 const campusId=await f.newCampus(),value=await f.input(campusId,f.tree(campusId));await f.owner.stage('maker',value);await expect(f.owner.stage('maker',{...value,entries:value.entries.map(e=>({...e,reason:'changed reason'}))})).rejects.toThrow('REQUEST_CONFLICT');
 const request=await f.prepare(value);peer(receipt.name,`DELETE FROM location_master.access WHERE actor='reviewer' AND campus_id=${quote(campusId)}::uuid AND permission='REVIEW';`);
 await expect(f.owner.applyUnit('maker',request)).rejects.toThrow('ACCESS_DENIED');expect((await f.owner.tree('maker',{campusId})).items).toHaveLength(0);
});

test('SQL binds approved facts even when an altered request has a valid service signature',async()=>{
 const {campusId,room}=await populated(),parent=room.versions[0]!.facts.parentId!,entry=f.entry(campusId,'ROOM','SQL_SPLIT',null);if(entry.action!=='CREATE')throw new Error();entry.parent={kind:'EXISTING',reference:{owner:'location-master',id:parent}};entry.row.parent_location_id=parent;
 const request=await f.prepare(await f.input(campusId,[entry])),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:request.candidateId}),value=candidate.unit.commands[0]!.value,writes=JSON.parse(value['writes']!);writes[0].facts.locationName='UNAPPROVED_NAME';
 const p=new Pool({connectionString:connection,max:1}),client=await p.connect(),key=Buffer.from(planBinding(provider,'LOCATION_SQL_AUTHORITY_V1',{}),'hex');
 try{
  await client.query('BEGIN');const transaction=(await client.query('select pg_current_xact_id()::text v')).rows[0].v;
  const ticket=canonicalPlan({operation:'APPLY',actor:'maker',transaction,inputId:value['inputId'],writes,writeIndex:1,writesDigest:value['writesDigest'],candidateId:request.candidateId,digest:candidate.digest});
  await expect(client.query('select location_master.mutate($1,$2)',[ticket,createHmac('sha256',key).update(ticket).digest('hex')])).rejects.toMatchObject({message:'STALE_VALIDATION'});
 }finally{await client.query('ROLLBACK');client.release();await p.end();key.fill(0);}
 expect((await f.owner.tree('maker',{campusId})).items).toHaveLength(4);expect((await f.owner.applyUnit('maker',request)).status).toBe('COMMITTED');
});

test('offset conversion without a published conversion rule blocks the entire input',async()=>{
 const campusId=await f.newCampus(),value=await f.input(campusId,f.tree(campusId));value.timePolicy='SOURCE_PLUS08_TO_LOCAL';for(const entry of value.entries){entry.row.valid_from+='+08:00';entry.row.recorded_at+='+08:00';}
 await expect(f.prepare(value)).rejects.toThrow('BLOCKED_DEPENDENCY');expect((await f.owner.tree('maker',{campusId})).items).toHaveLength(0);
});
test.each(['DRAFT','REVIEW'] as const)('%s source rows can be frozen only as blocked candidates',async status=>{
 const campusId=await f.newCampus(),value=await f.input(campusId,f.tree(campusId));for(const entry of value.entries)entry.row.record_status=status;
 const staged=await f.owner.stage('maker',value);await f.owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,evidenceId:f.artifact.artifactId,reason:'TEST candidate retention',physicalFactsAccepted:true,policyVersion:'ORG12_CORE_V1'});
 const candidate=await f.owner.plan('maker',{inputId:staged.inputId,requestId:randomUUID()});await f.owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await expect(f.owner.approveApplyUnit('reviewer',candidate)).rejects.toThrow('BLOCKED_DEPENDENCY');expect((await f.owner.tree('maker',{campusId})).items).toHaveLength(0);
});

test('a split before an already scheduled move uses its effective floor and records both predecessor versions',async()=>{
 const {campusId,outcome,room}=await populated(),building=outcome.facts[1]!.id,newFloor=f.entry(campusId,'FLOOR','FUTURE_FLOOR',null);if(newFloor.action!=='CREATE')throw new Error();newFloor.parent={kind:'EXISTING',reference:{owner:'location-master',id:building}};newFloor.row.parent_location_id=building;
 const created=await f.apply(await f.input(campusId,[newFloor])),move=revision(room,'MOVE_CONTAINMENT','2027-06-01T00:00:00');if(move.action!=='MOVE_CONTAINMENT')throw new Error();move.parent={kind:'EXISTING',reference:{owner:'location-master',id:created.facts[0]!.id}};move.row.parent_location_id=created.facts[0]!.id;await f.apply(await f.input(campusId,[move]));
 const current=await f.owner.history('maker',{id:room.id});await expect(f.prepare(await f.input(campusId,[revision(current,'REVISE','2027-03-01T00:00:00')]))).rejects.toThrow('LOCATION_PARENT_IMMUTABLE');
 const close=revision(current,'CLOSE','2027-03-01T00:00:00');if(close.action!=='CLOSE')throw new Error();const parent=room.versions[0]!.facts.parentId!;
 const successors=['BEFORE_A','BEFORE_B'].map(alias=>({row:{...f.row(campusId,'ROOM',alias,parent),valid_from:close.row.valid_from},parent:{kind:'EXISTING' as const,reference:{owner:'location-master' as const,id:parent}},evidenceId:f.artifact.artifactId}));
 await f.apply(await f.input(campusId,[{...close,action:'SPLIT',successors}]));const h=await f.owner.history('maker',{id:room.id}),change=await f.owner.readChange('maker',{id:h.versions.at(-1)!.changeId!});
 expect(change.splits.map(s=>s.predecessorVersion)).toEqual(['1','1']);expect(change.splits.map(s=>s.predecessorHeadVersion)).toEqual(['2','2']);expect((await f.owner.read('maker',{id:room.id,businessAt:'2027-07-01T00:00:00'})).state).toBe('CLOSED');
});

test('file intake snapshots caller bytes before any asynchronous work',async()=>{
 const campusId=await f.newCampus(),entry=f.entry(campusId,'CAMPUS','SNAPSHOT',null);if(entry.action!=='CREATE')throw new Error();const {row,...operation}=entry,bytes=Buffer.from(JSON.stringify([row]));
 const pending=f.owner.receiveFile('maker',{requestId:randomUUID(),fileRequestId:randomUUID(),job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_LOCATION',contractId:f.contract.id,contractVersionId:f.contract.versionId,profile:'CORE',input:{kind:'FILE',format:'JSON',parserPolicy:'STRICT_LOCATION_V1'}},campus:'NORTH',campusId,timePolicy:'LOCAL',retentionSeconds:7200,operations:[operation]},bytes);bytes.fill(0);
 const received=await pending;expect(received.structuralStatus).toBe('PARSED');expect(received.issues).toEqual([]);if(!received.input)throw new Error();expect((await f.owner.readInput('maker',{inputId:received.input.inputId})).entries[0]!.row).toEqual(row);
});

test('a later attribute revision is allowed when an old floor period does not intersect it',async()=>{
 const {campusId,outcome,room}=await populated(),building=outcome.facts[1]!.id,newFloor=f.entry(campusId,'FLOOR','PAST_FLOOR',null);if(newFloor.action!=='CREATE')throw new Error();newFloor.parent={kind:'EXISTING',reference:{owner:'location-master',id:building}};newFloor.row.parent_location_id=building;
 const created=await f.apply(await f.input(campusId,[newFloor])),move=revision(room,'MOVE_CONTAINMENT');if(move.action!=='MOVE_CONTAINMENT')throw new Error();move.parent={kind:'EXISTING',reference:{owner:'location-master',id:created.facts[0]!.id}};move.row.parent_location_id=created.facts[0]!.id;await f.apply(await f.input(campusId,[move]));
 const current=await f.owner.history('maker',{id:room.id}),revise=revision(current,'REVISE','2026-04-01T00:00:00');revise.row.location_name='TEST later rename';await f.apply(await f.input(campusId,[revise]));
 expect((await f.owner.read('maker',{id:room.id,businessAt:'2026-05-01T00:00:00'})).version!.facts.locationName).toBe('TEST later rename');expect((await f.owner.read('maker',{id:room.id,businessAt:'2026-05-01T00:00:00'})).version!.facts.parentId).toBe(created.facts[0]!.id);
});

test('review regression: attribute revision after a bounded move uses the resumed parent',async()=>{
 const {campusId,outcome,room}=await populated(),building=outcome.facts[1]!.id,newFloor=f.entry(campusId,'FLOOR','BOUNDED_FLOOR',null);if(newFloor.action!=='CREATE')throw new Error();newFloor.parent={kind:'EXISTING',reference:{owner:'location-master',id:building}};newFloor.row.parent_location_id=building;
 const created=await f.apply(await f.input(campusId,[newFloor])),move=revision(room,'MOVE_CONTAINMENT','2027-01-01T00:00:00');if(move.action!=='MOVE_CONTAINMENT')throw new Error();move.parent={kind:'EXISTING',reference:{owner:'location-master',id:created.facts[0]!.id}};move.row.parent_location_id=created.facts[0]!.id;move.row.valid_to='2027-06-01T00:00:00';await f.apply(await f.input(campusId,[move]));
 const current=await f.owner.history('maker',{id:room.id}),revise=revision(current,'REVISE','2028-01-01T00:00:00');revise.row.parent_location_id=room.versions[0]!.facts.parentId!;revise.row.location_name='TEST resumed floor rename';
 const result=await f.apply(await f.input(campusId,[revise]));expect(result.status).toBe('COMMITTED');expect((await f.owner.read('maker',{id:room.id,businessAt:'2028-02-01T00:00:00'})).version!.facts.parentId).toBe(room.versions[0]!.facts.parentId);
 expect((await f.owner.read('maker',{id:room.id,businessAt:'2027-03-01T00:00:00'})).version!.facts.parentId).toBe(created.facts[0]!.id);
});

test('review regression: protected grant revocation blocks input and frozen candidate release',async()=>{
 const campusId=await f.newCampus(),value=await f.input(campusId,f.tree(campusId)),staged=await f.owner.stage('maker',value),request=await f.prepare(value);
 const grants=peer(receipt.name,`SELECT coalesce(jsonb_agg(g),'[]')::text FROM vnext_control.protected_grant g WHERE actor_code IN ('maker','reviewer') AND dataset_id=${quote(f.dataset.id)}::uuid AND permission='READ';`);
 peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code IN ('maker','reviewer') AND dataset_id=${quote(f.dataset.id)}::uuid AND permission='READ';`);
 try{await expect(f.owner.readInput('maker',{inputId:staged.inputId})).rejects.toThrow('ACCESS_DENIED');await expect(f.owner.readApplyCandidate('reviewer',{candidateId:request.candidateId})).rejects.toThrow('ACCESS_DENIED');}
 finally{peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.protected_grant,${quote(grants)}::jsonb);`);}
});

test('approved room class includes physical WAREHOUSE splitting without inventory operations',async()=>{
 const campusId=await f.newCampus(),entries=f.tree(campusId);entries[3]!.row.location_type='WAREHOUSE';entries[3]!.row.room_number='';const original=await f.apply(await f.input(campusId,entries)),warehouse=await f.owner.history('maker',{id:original.facts[3]!.id}),close=revision(warehouse,'CLOSE');if(close.action!=='CLOSE')throw new Error();const parent=warehouse.versions[0]!.facts.parentId!;
 const successors=['WARE_A','WARE_B'].map(alias=>({row:{...f.row(campusId,'WAREHOUSE',alias,parent),valid_from:close.row.valid_from},parent:{kind:'EXISTING' as const,reference:{owner:'location-master' as const,id:parent}},evidenceId:f.artifact.artifactId}));
 const result=await f.apply(await f.input(campusId,[{...close,action:'SPLIT',successors}]));expect(result.facts).toHaveLength(3);expect(result.facts.every(fact=>fact.owner==='location-master')).toBe(true);expect((await f.owner.tree('maker',{campusId,businessAt:'2026-04-01T00:00:00'})).items.filter(item=>item.version.facts.locationType==='WAREHOUSE')).toHaveLength(2);
});

test('restricted input and frozen candidate reads check currently retained exact source permissions',async()=>{
 const campusId=await f.newCampus(),value=await f.input(campusId,f.tree(campusId)),staged=await f.owner.stage('maker',value),request=await f.prepare(value);
 const grants=peer(receipt.name,`SELECT coalesce(jsonb_agg(g),'[]')::text FROM vnext_control.object_grant g WHERE actor_code IN ('maker','reviewer') AND object_id=${quote(f.source.id)}::uuid AND permission='READ';`);
 peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code IN ('maker','reviewer') AND object_id=${quote(f.source.id)}::uuid AND permission='READ';`);
 try{await expect(f.owner.readInput('maker',{inputId:staged.inputId})).rejects.toThrow('ACCESS_DENIED');await expect(f.owner.readApplyCandidate('reviewer',{candidateId:request.candidateId})).rejects.toThrow('ACCESS_DENIED');}
 finally{peer(receipt.name,`INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,${quote(grants)}::jsonb);`);}
});

test('one unordered 31-command unit stays within the existing candidate budget and applies atomically',async()=>{
 const campusId=await f.newCampus(),entries=[...f.tree(campusId),...Array.from({length:27},(_,i)=>f.entry(campusId,'ROOM','BULK_'+i,'F'))];entries.reverse();
 const result=await f.apply(await f.input(campusId,entries));expect(result.facts).toHaveLength(31);expect((await f.owner.tree('maker',{campusId})).items).toHaveLength(31);
});

test('a lost completion acknowledgement recovers the original durable Location facts',async()=>{
 const campusId=await f.newCampus(),request=await f.prepare(await f.input(campusId,f.tree(campusId))),original=Client.prototype.query;let loseAck=true,injected=false;
 // The actual PostgreSQL COMMIT succeeds; only its transport acknowledgement fails.
 Client.prototype.query=(function(this:Client,config:string|QueryConfig,...args:unknown[]){const text=typeof config==='string'?config:config.text,result=Reflect.apply(original,this,[config,...args]);if(loseAck&&text.trim().toLowerCase()==='commit'){loseAck=false;injected=true;return Promise.resolve(result).then(()=>{throw Object.assign(new Error('ACK_LOST'),{code:'ECONNRESET'});});}return result;}) as typeof Client.prototype.query;
 try{
  const uncertain=await f.owner.applyUnit('maker',request);expect(injected).toBe(true);expect(uncertain.status).toBe('COMMIT_UNKNOWN');
 }finally{Client.prototype.query=original;}
 const recovered=await f.owner.resumeOutcome('maker',request),replay=await f.owner.applyUnit('maker',request);expect(recovered?.status).toBe('COMMITTED');expect(replay.status).toBe('COMMITTED');if(replay.status==='COMMITTED'&&recovered?.status==='COMMITTED')expect(replay.facts).toEqual(recovered.facts);expect((await f.owner.tree('maker',{campusId})).items).toHaveLength(4);
});
