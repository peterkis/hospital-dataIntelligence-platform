import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {beforeAll,afterAll,test,expect} from 'vitest';
import {openCatalog,type Catalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import type {WardNursingEntry,WardNursingVerification,NursingHandoverConfirm} from '../../apps/governance-api/src/modules/care-organization/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {createNursingUnitClient,createWardNursingCoverageClient} from '../../packages/generated-api-client/src/index.js';
import {wardNursingFixture} from './p3-05-fixture.js';
import {coverageFile,coverageFileRequest,signedCoverageAttempt,type CoverageCandidate} from './p3-05-validation-helpers.js';
import {validationKeys} from './p3-05-validation-keys.mjs';
import {peer,quote} from './lineage.mjs';

const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Catalog,f:Awaited<ReturnType<typeof wardNursingFixture>>,app:Awaited<ReturnType<typeof buildCatalogServer>>,url:string;
beforeAll(async()=>{const provider=validationKeys(receipt),pool=new Pool({connectionString:connection,max:1});try{catalog=await openCatalog(connection,provider);const role=(await pool.query('select current_user r')).rows[0]!.r;f=await wardNursingFixture(receipt,role,catalog,provider,connection,false);const contexts:Parameters<typeof buildCatalogServer>=[catalog,'CONTROL_PLANE'];contexts[16]={owner:f.nursing.owner,actor:r=>actor(r.headers)};contexts[23]={owner:f.owner,actor:r=>actor(r.headers)};app=await buildCatalogServer(...contexts);url=await app.listen({host:'127.0.0.1',port:0});}finally{await pool.end();}});
afterAll(async()=>{await app?.close();await f?.close();await catalog?.close();});
const end=(entry:WardNursingEntry,id:string,at:string):WardNursingEntry=>({...entry,action:'END',target:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},endAt:at,row:{...entry.row,record_status:'RETIRED'}});

const stagedHandover=async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),entry=f.entry(a),first=await f.apply(await f.input([entry])),id=first.facts[0]!.id,T='2026-04-01T00:00:00.000001',incoming=f.entry(b);
 incoming.row={...incoming.row,valid_from:T,handover_rule_ref:'TEST_NURSING_OWNER_HANDOVER'};
 const value=await f.input([end(entry,id,T),incoming]),staged=await f.owner.stage('maker',value);
 const input:NursingHandoverConfirm={requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,row:2,handover:{kind:'CONFIRMED_HANDOVER',source:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},successorSourceAlias:incoming.row.ward_nursing_rel_id,successorNursing:b.nursing,coverage:incoming.coverage,cutover:T,ruleReference:'TEST_NURSING_OWNER_HANDOVER',ruleVersion:'TEST_POLICY_ONLY_1',evidenceId:f.artifact.artifactId,confirmed:true},reason:'TEST independent Nursing Owner responsibility confirmation'};
 const verification=f.verification(value,staged);verification.rows[1]!.handover=input.handover;
 return {a,b,entry,first,id,T,incoming,value,staged,input,verification};
};
const freeze=async(verification:WardNursingVerification)=>{
 await f.owner.verify('reviewer',verification);const preview=await f.owner.preview('maker',{inputId:verification.inputId});expect(preview.decision,preview.issues.map(issue=>issue.code).join(',')).toBe('PASS');
 const requestId=randomUUID(),planned=await f.owner.plan('maker',{inputId:verification.inputId,requestId}),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:planned.candidateId});await f.owner.approveApplyUnit('reviewer',planned);
 return {q:{candidateId:planned.candidateId,requestId},candidate};
};
const unchanged=async(h:Awaited<ReturnType<typeof stagedHandover>>)=>{
 expect((await f.owner.history('maker',{id:h.id})).versions).toHaveLength(1);expect((await f.owner.list('maker',{campus:'NORTH',wardId:h.a.ward.id})).items.map(item=>item.id)).toEqual([h.id]);
};
const withProof=(v:WardNursingVerification,p:{confirmationId:string;digest:string}):WardNursingVerification=>({...v,rows:v.rows.map(row=>row.row===2?{...row,handover:{...row.handover,nursingConfirmation:{id:p.confirmationId,digest:p.digest}}}:row)});
const nursingReview=(campusId:string,enabled:boolean)=>peer(receipt.name,enabled?`INSERT INTO care_organization.nursing_access VALUES('reviewer',${quote(campusId)}::uuid,'NORTH','REVIEW') ON CONFLICT DO NOTHING;`:`DELETE FROM care_organization.nursing_access WHERE actor='reviewer' AND campus_id=${quote(campusId)}::uuid AND scope='NORTH' AND permission='REVIEW';`);
const rewriteProof=(candidate:CoverageCandidate,change:(handover:Record<string,unknown>)=>void):CoverageCandidate=>{
 const commands=candidate.unit.commands.map((command,index)=>{if(index!==0)return command;const writes=JSON.parse(command.value['writes']!);change(writes[1].facts.handover);return {...command,value:{...command.value,writes:JSON.stringify(writes)}};});
 return {...candidate,unit:{...candidate.unit,commands}};
};

test('P1: Ward coverage VERIFY and Nursing READ alone cannot confirm or publish an atomic handover',async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),entry=f.entry(a),first=await f.apply(await f.input([entry])),id=first.facts[0]!.id,T='2026-04-01T00:00:00.000001',incoming=f.entry(b);
 incoming.row={...incoming.row,valid_from:T,handover_rule_ref:'TEST_NURSING_OWNER_HANDOVER'};
 const confirm=(verification:WardNursingVerification):WardNursingVerification=>({...verification,rows:verification.rows.map(row=>row.row===2?{...row,handover:{kind:'CONFIRMED_HANDOVER',source:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},successorSourceAlias:incoming.row.ward_nursing_rel_id,successorNursing:b.nursing,coverage:incoming.coverage,cutover:T,ruleReference:'TEST_NURSING_OWNER_HANDOVER',ruleVersion:'TEST_POLICY_ONLY_1',evidenceId:f.artifact.artifactId,confirmed:true}}:row)});
 peer(receipt.name,`DELETE FROM care_organization.nursing_access WHERE actor='reviewer' AND campus_id=${quote(a.campus.id)}::uuid AND permission IN ('VERIFY','REVIEW');`);
 try{
  await expect(f.apply(await f.input([end(entry,id,T),incoming]),confirm)).rejects.toThrow('ACCESS_DENIED');
  expect((await f.owner.history('maker',{id})).versions).toHaveLength(1);
  expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items.map(item=>item.id)).toEqual([id]);
 }finally{peer(receipt.name,`INSERT INTO care_organization.nursing_access SELECT 'reviewer',${quote(a.campus.id)}::uuid,'NORTH',p FROM unnest(ARRAY['VERIFY','REVIEW']) p ON CONFLICT DO NOTHING;`);}
});

test('P1: a Ward verifier cannot replace Nursing confirmation with confirmed true',async()=>{
 const h=await stagedHandover();await expect(f.owner.verify('reviewer',h.verification)).rejects.toThrow('HANDOVER_NOT_CONFIRMED');
 const rejected=await createWardNursingCoverageClient(url,'reviewer').verify(h.verification);expect(rejected.response.status).toBe(503);expect(rejected.error?.code).toBe('HANDOVER_NOT_CONFIRMED');await unchanged(h);
 const proof=await f.nursing.owner.confirmCoverageHandover('reviewer',h.input),{q,candidate}=await freeze(withProof(h.verification,proof));expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('AUTHORIZED');
 const missing=rewriteProof(candidate,handover=>{delete handover['nursingConfirmation'];});expect(await signedCoverageAttempt(connection,receipt,missing,q)).toBe('NURSING_HANDOVER_CONFIRMATION_REQUIRED');expect(await f.owner.resumeOutcome('maker',q)).toBeNull();await unchanged(h);
});

test('P1: real Nursing HTTP confirms the exact handover and the same independent reviewer may verify Ward coverage',async()=>{
 const h=await stagedHandover(),nurse=createNursingUnitClient(url,'reviewer'),coverageReviewer=createWardNursingCoverageClient(url,'reviewer'),maker=createWardNursingCoverageClient(url,'maker');
 const confirmed=await nurse.confirmCoverageHandover(h.input);expect(confirmed.response.status,JSON.stringify(confirmed.error)).toBe(200);if(!confirmed.data)throw new Error('TEST_CONFIRMATION_MISSING');
 expect(confirmed.data).toMatchObject({confirmationId:expect.any(String),digest:expect.stringMatching(/^[a-f0-9]{64}$/u),recordedAt:expect.stringMatching(/\.\d{6}$/u)});expect((await nurse.confirmCoverageHandover(h.input)).data).toEqual(confirmed.data);expect(await f.nursing.owner.confirmCoverageHandover('reviewer',h.input)).toEqual(confirmed.data);
 expect((await coverageReviewer.verify(withProof(h.verification,confirmed.data))).response.status).toBe(200);const requestId=randomUUID(),planned=await maker.plan({inputId:h.staged.inputId,requestId});expect(planned.response.status,JSON.stringify(planned.error)).toBe(200);if(!planned.data)throw new Error('TEST_CANDIDATE_MISSING');
 expect((await coverageReviewer.review({candidateId:planned.data.candidateId})).response.status).toBe(200);expect((await coverageReviewer.approve(planned.data)).response.status).toBe(200);const q={candidateId:planned.data.candidateId,requestId},published=await maker.apply(q);expect(published.response.status,JSON.stringify(published.error)).toBe(200);if(published.data?.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
 const out=published.data,next=out.facts[1]!.id,ended=await f.owner.exact('maker',{id:h.id,version:'2'}),created=await f.owner.exact('maker',{id:next,version:'1'});expect(ended.changeId).toBe(created.changeId);expect(ended.recordedAt).toBe(created.recordedAt);expect(created.facts.handover).toMatchObject({nursingConfirmation:{id:confirmed.data.confirmationId,digest:confirmed.data.digest}});expect((await maker.query({id:h.id,businessAt:h.T})).data?.state).toBe('ENDED');expect((await maker.query({id:next,businessAt:h.T})).data?.state).toBe('ACTIVE');
 nursingReview(h.a.campus.id,false);
 try{
  expect((await maker.apply(q)).data).toEqual(out);const {responseStatus:_status,...durable}=out;expect((await maker.resume(q)).data).toEqual(durable);expect((await maker.reconcile(q)).data).toMatchObject({status:'MATCHED'});
  const safe=await f.apply(await f.input([end(h.incoming,next,'2026-05-01T00:00:00.000001')]));expect(safe.facts).toHaveLength(1);expect((await f.owner.read('maker',{id:next,businessAt:'2026-05-01T00:00:00.000001'})).state).toBe('ENDED');expect((await maker.apply(q)).data).toEqual(out);
 }finally{nursingReview(h.a.campus.id,true);}
});

test('P1: same-person aliases and real SERVICE principals cannot sign Nursing confirmation',async()=>{
 const h=await stagedHandover(),pool=new Pool({connectionString:connection,max:1}),originalKind=peer(receipt.name,"SELECT principal_kind FROM vnext_control.actor WHERE code='reviewer';");expect(originalKind).toBe('HUMAN');
 const originalAliasReview=peer(receipt.name,`SELECT count(*) FROM care_organization.nursing_access WHERE actor='maker-alias' AND campus_id=${quote(h.a.campus.id)}::uuid AND scope='NORTH' AND permission='REVIEW';`);expect(originalAliasReview).toBe('0');
 peer(receipt.name,`INSERT INTO care_organization.nursing_access VALUES('maker-alias',${quote(h.a.campus.id)}::uuid,'NORTH','REVIEW');`);
 try{
  await expect(f.nursing.owner.confirmCoverageHandover('maker-alias',h.input)).rejects.toThrow('MAKER_CHECKER_REQUIRED');const alias=await createNursingUnitClient(url,'maker-alias').confirmCoverageHandover(h.input);expect(alias.error?.code).toBe('MAKER_CHECKER_REQUIRED');
  peer(receipt.name,"UPDATE vnext_control.actor SET principal_kind='SERVICE' WHERE code='reviewer' AND principal_kind='HUMAN';");expect(peer(receipt.name,"SELECT principal_kind FROM vnext_control.actor WHERE code='reviewer';")).toBe('SERVICE');await expect(f.nursing.owner.confirmCoverageHandover('reviewer',h.input)).rejects.toThrow('ACCESS_DENIED');const service=await createNursingUnitClient(url,'reviewer').confirmCoverageHandover(h.input);expect(service.response.status).toBe(403);expect(service.error?.code).toBe('ACCESS_DENIED');
  expect((await pool.query('select current_user r')).rows[0]!.r).toMatch(/^hdi_(validation|owner)_[a-f0-9]{16}$/u);await expect(pool.query('select care_organization.nursing_authorize($1,$2::uuid,$3)',['reviewer',h.a.campus.id,'REVIEW'])).rejects.toMatchObject({message:'ACCESS_DENIED'});await unchanged(h);
 }finally{
  try{peer(receipt.name,`UPDATE vnext_control.actor SET principal_kind=${quote(originalKind)} WHERE code='reviewer' AND principal_kind='SERVICE';DELETE FROM care_organization.nursing_access WHERE actor='maker-alias' AND campus_id=${quote(h.a.campus.id)}::uuid AND scope='NORTH' AND permission='REVIEW';`);expect(peer(receipt.name,"SELECT principal_kind FROM vnext_control.actor WHERE code='reviewer';")).toBe(originalKind);}finally{await pool.end();}
 }
 const proof=await f.nursing.owner.confirmCoverageHandover('reviewer',h.input);expect(proof.confirmationId).toEqual(expect.any(String));
});

test('P1: Nursing REVIEW revoked after approved freeze blocks Owner and restricted signed SQL atomically',async()=>{
 const h=await stagedHandover(),proof=await f.nursing.owner.confirmCoverageHandover('reviewer',h.input),{q,candidate}=await freeze(withProof(h.verification,proof));expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('AUTHORIZED');
 nursingReview(h.a.campus.id,false);
 try{
  await expect(f.owner.applyUnit('maker',q)).rejects.toThrow('ACCESS_DENIED');expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('ACCESS_DENIED');expect(await f.owner.resumeOutcome('maker',q)).toBeNull();await unchanged(h);
 }finally{nursingReview(h.a.campus.id,true);}
 expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('AUTHORIZED');expect((await f.owner.applyUnit('maker',q)).status).toBe('COMMITTED');
});

test('P1: only the independent Nursing confirmer becoming SERVICE invalidates an approved handover',async()=>{
 const h=await stagedHandover(),confirmer='nursing-confirm-'+randomUUID(),identity='TEST_NURSING_CONFIRM_'+randomUUID();
 // This actual registry principal has Nursing REVIEW and scoped reads, including
 // the Ward's published manager and operating references. The existing HUMAN
 // reviewer retains every Ward verification/approval grant.
 peer(receipt.name,`INSERT INTO vnext_control.actor(code,identity_code,active,principal_kind) SELECT ${quote(confirmer)},${quote(identity)},true,'HUMAN' FROM vnext_control.actor WHERE code='reviewer' AND active AND principal_kind='HUMAN';INSERT INTO vnext_control.actor_grant SELECT ${quote(confirmer)},'SYNTHETIC',p FROM unnest(ARRAY['READ','REVIEW']) p;INSERT INTO organization_master.access VALUES(${quote(confirmer)},${quote(h.a.campus.id)}::uuid,'NORTH','READ');INSERT INTO care_organization.ward_nursing_access SELECT ${quote(confirmer)},${quote(h.a.campus.id)}::uuid,'NORTH',p FROM unnest(ARRAY['READ','READ_RESTRICTED']) p;INSERT INTO care_organization.nursing_access SELECT ${quote(confirmer)},${quote(h.a.campus.id)}::uuid,'NORTH',p FROM unnest(ARRAY['READ','READ_RESTRICTED','REVIEW']) p;INSERT INTO vnext_control.protected_grant VALUES(${quote(confirmer)},${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ');`);
 peer(receipt.name,`INSERT INTO vnext_control.object_grant SELECT ${quote(confirmer)},object_id,scope,object_kind,campus,purpose,field_group,permission FROM vnext_control.object_grant WHERE actor_code='reviewer' AND scope='SYNTHETIC' AND permission='READ' AND object_id IN (${quote(f.dataset.id)}::uuid,${quote(h.entry.row.source_system_id)}::uuid);`);
 // Nursing snapshot uses the canonical Department HOSPITAL READ port for its
 // accepted managing Department references; no Department signing grant is given.
 peer(receipt.name,`INSERT INTO department_master.access VALUES(${quote(confirmer)},'HOSPITAL','READ');`);
 const wardHistory=await f.wards.owner.history('maker',{id:h.a.ward.id});
 for(const binding of wardHistory.bindings){
  peer(receipt.name,`INSERT INTO care_organization.ward_access VALUES(${quote(confirmer)},${quote(binding.campusId)}::uuid,${quote(binding.scope)},'READ') ON CONFLICT DO NOTHING;`);
  const manager=await f.base.owner.history('maker',{id:binding.managingUnitId});
  for(const pair of manager.bindings)peer(receipt.name,`INSERT INTO care_organization.access VALUES(${quote(confirmer)},${quote(pair.campusId)}::uuid,${quote(pair.scope)},'READ') ON CONFLICT DO NOTHING;INSERT INTO organization_master.access SELECT ${quote(confirmer)},id,campus,'READ' FROM organization_master.subject WHERE id=${quote(pair.subjectId)}::uuid ON CONFLICT DO NOTHING;INSERT INTO organization_master.access VALUES(${quote(confirmer)},${quote(pair.campusId)}::uuid,${quote(pair.scope)},'READ') ON CONFLICT DO NOTHING;INSERT INTO organization_master.operating_access VALUES(${quote(confirmer)},${quote(pair.subjectId)}::uuid,${quote(pair.campusId)}::uuid,'READ') ON CONFLICT DO NOTHING;`);
 }
 expect(peer(receipt.name,`SELECT principal_kind FROM vnext_control.actor WHERE code=${quote(confirmer)};`)).toBe('HUMAN');expect(peer(receipt.name,`SELECT count(*) FROM care_organization.ward_nursing_access WHERE actor=${quote(confirmer)} AND permission IN ('WRITE','VERIFY','REVIEW');`)).toBe('0');
 const proof=await f.nursing.owner.confirmCoverageHandover(confirmer,h.input),{q,candidate}=await freeze(withProof(h.verification,proof));expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('AUTHORIZED');
 try{
  peer(receipt.name,`UPDATE vnext_control.actor SET principal_kind='SERVICE' WHERE code=${quote(confirmer)} AND principal_kind='HUMAN';`);expect(peer(receipt.name,"SELECT principal_kind FROM vnext_control.actor WHERE code='reviewer';")).toBe('HUMAN');await expect(f.owner.applyUnit('maker',q)).rejects.toThrow('ACCESS_DENIED');expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('ACCESS_DENIED');expect(await f.owner.resumeOutcome('maker',q)).toBeNull();await unchanged(h);
 }finally{peer(receipt.name,`UPDATE vnext_control.actor SET principal_kind='HUMAN' WHERE code=${quote(confirmer)} AND principal_kind='SERVICE';`);expect(peer(receipt.name,`SELECT principal_kind FROM vnext_control.actor WHERE code=${quote(confirmer)};`)).toBe('HUMAN');}
 expect((await f.owner.applyUnit('maker',q)).status).toBe('COMMITTED');
});

test('P1: wrong staged row, successor, input and tampered confirmation cannot authorize a handover',async()=>{
 const h=await stagedHandover();await expect(f.nursing.owner.confirmCoverageHandover('reviewer',{...h.input,requestId:randomUUID(),row:1})).rejects.toThrow('HANDOVER_NOT_CONFIRMED');await expect(f.nursing.owner.confirmCoverageHandover('reviewer',{...h.input,requestId:randomUUID(),handover:{...h.input.handover,successorSourceAlias:randomUUID()}})).rejects.toThrow('HANDOVER_NOT_CONFIRMED');await expect(f.nursing.owner.confirmCoverageHandover('reviewer',{...h.input,requestId:randomUUID(),inputDigest:'f'.repeat(64)})).rejects.toThrow('STALE_VALIDATION');
 const proof=await f.nursing.owner.confirmCoverageHandover('reviewer',h.input),verified=withProof(h.verification,proof),wrong=withProof(h.verification,{...proof,digest:proof.digest==='f'.repeat(64)?'e'.repeat(64):'f'.repeat(64)});await expect(f.owner.verify('reviewer',wrong)).rejects.toThrow('NURSING_HANDOVER_CONFIRMATION_REQUIRED');
 const otherValue=await f.input([end(h.entry,h.id,h.T),h.incoming]),other=await f.owner.stage('maker',otherValue);await expect(f.owner.verify('reviewer',{...verified,requestId:randomUUID(),inputId:other.inputId,inputDigest:other.digest})).rejects.toThrow('NURSING_HANDOVER_CONFIRMATION_REQUIRED');
 const wrongRow={...verified,requestId:randomUUID(),rows:verified.rows.map(row=>row.row===1?{...row,handover:verified.rows[1]!.handover}:row)};await expect(f.owner.verify('reviewer',wrongRow)).rejects.toThrow('NURSING_HANDOVER_CONFIRMATION_REQUIRED');await unchanged(h);
 const {q,candidate}=await freeze(verified),tampered=rewriteProof(candidate,handover=>{handover['nursingConfirmation']={id:proof.confirmationId,digest:'0'.repeat(64)};});expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('AUTHORIZED');expect(await signedCoverageAttempt(connection,receipt,tampered,q)).toBe('NURSING_HANDOVER_CONFIRMATION_REQUIRED');expect(await f.owner.resumeOutcome('maker',q)).toBeNull();await unchanged(h);expect((await f.owner.applyUnit('maker',q)).status).toBe('COMMITTED');
});

test('P1: incoming-first XLSX binds Nursing confirmation to original row rather than sorted writes or physical source rows',async()=>{
 const pool=new Pool({connectionString:connection,max:1});
 try{
  expect((await pool.query('select current_user r')).rows[0]!.r).toMatch(/^hdi_(validation|owner)_[a-f0-9]{16}$/u);
  const internal=['care_organization.nursing_handover_binding(jsonb)','care_organization.nursing_handover_context(text,jsonb)','care_organization.ward_nursing_mutate_0199(text,text)'];
  const permissions=await pool.query('select signature,has_function_privilege(current_user,signature,\'EXECUTE\') allowed from unnest($1::text[]) guarded(signature)',[internal]);expect(permissions.rows).toHaveLength(3);for(const p of permissions.rows)expect(p.allowed,p.signature).toBe(false);
  const functions=[...internal,'care_organization.nursing_handover_confirm(text,text)','care_organization.nursing_handover_confirmation_read(text,uuid,text,jsonb)'];
  const publicFunctions=await pool.query('select signature,exists(select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault(\'f\',p.proowner))) a where p.oid=signature::regprocedure and a.grantee=0 and a.privilege_type=\'EXECUTE\') allowed from unnest($1::text[]) guarded(signature)',[functions]);expect(publicFunctions.rows).toHaveLength(5);for(const p of publicFunctions.rows)expect(p.allowed,p.signature).toBe(false);
  expect((await pool.query('select has_table_privilege(current_user,\'care_organization.nursing_handover_confirmation\',\'SELECT\') can_read,has_table_privilege(current_user,\'care_organization.nursing_handover_confirmation\',\'INSERT\') can_insert')).rows[0]).toEqual({can_read:false,can_insert:false});
  expect((await pool.query('select exists(select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault(\'r\',c.relowner))) a where c.oid=\'care_organization.nursing_handover_confirmation\'::regclass and a.grantee=0 and a.privilege_type in (\'SELECT\',\'INSERT\')) allowed')).rows[0]!.allowed).toBe(false);
  const client=await pool.connect();
  try{
   for(const query of ["select care_organization.nursing_handover_binding('{}'::jsonb)","select care_organization.nursing_handover_context('reviewer','{}'::jsonb)","select care_organization.ward_nursing_mutate_0199('{}','')",'select id from care_organization.nursing_handover_confirmation limit 0','insert into care_organization.nursing_handover_confirmation default values']){
    await client.query('BEGIN');try{await expect(client.query(query)).rejects.toMatchObject({code:'42501'});}finally{await client.query('ROLLBACK');}
   }
  }finally{client.release();}
 }finally{await pool.end();}
 const h=await stagedHandover(),entries=[h.incoming,end(h.entry,h.id,h.T)],bytes=coverageFile(entries.map(e=>e.row),'XLSX'),maker=createWardNursingCoverageClient(url,'maker');
 const received=await maker.file({input:coverageFileRequest(f,entries,'XLSX'),contentBase64:bytes.toString('base64')});expect(received.response.status,JSON.stringify(received.error)).toBe(200);if(!received.data?.input)throw new Error('TEST_FILE_INPUT_MISSING');expect(received.data.issues).toEqual([]);
 const staged=received.data.input,retained=await f.owner.readInput('maker',{inputId:staged.inputId});if(retained.kind!=='COVERAGE')throw new Error('TEST_COVERAGE_INPUT_REQUIRED');expect(retained.entries.map(e=>e.action)).toEqual(['CREATE','END']);expect(retained.sourceRows).toEqual([2,3]);expect(retained.entries[1]!.row.handover_rule_ref).toBe('');expect((await f.owner.exact('maker',{id:h.id,version:'1'})).facts.handoverRuleReference).toBeNull();
 const input:NursingHandoverConfirm={...h.input,requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,row:1},confirmed=await createNursingUnitClient(url,'reviewer').confirmCoverageHandover(input);expect(confirmed.response.status,JSON.stringify(confirmed.error)).toBe(200);if(!confirmed.data)throw new Error('TEST_CONFIRMATION_MISSING');
 const verification=f.verification(retained,staged);verification.rows[0]!.handover={...input.handover,nursingConfirmation:{id:confirmed.data.confirmationId,digest:confirmed.data.digest}};
 const alteredEnd=end(h.entry,h.id,h.T);alteredEnd.row={...alteredEnd.row,handover_rule_ref:'TEST_OTHER_RULE'};
 const alteredValue=await f.input([alteredEnd]),altered=await f.owner.stage('maker',alteredValue);await f.owner.verify('reviewer',f.verification(alteredValue,altered));expect((await f.owner.preview('maker',{inputId:altered.inputId})).issues.some(issue=>issue.code==='WARD_NURSING_CONTENT_CHANGED')).toBe(true);await unchanged(h);
 const {q,candidate}=await freeze(verification);expect(candidate.unit.commands.map(c=>c.intent)).toEqual(['REVISE','CREATE']);
 const writes=JSON.parse(candidate.unit.commands[0]!.value['writes']!);expect(writes.map((w:{action:string})=>w.action)).toEqual(['END','CREATE']);expect(writes.map((w:{sourceRow:number})=>w.sourceRow)).toEqual([3,2]);expect(writes[1].facts.handover.nursingConfirmation).toEqual({id:confirmed.data.confirmationId,digest:confirmed.data.digest});
 expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('AUTHORIZED');await unchanged(h);expect(await f.owner.resumeOutcome('maker',q)).toBeNull();
 const out=await f.owner.applyUnit('maker',q);if(out.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');expect(out.facts).toHaveLength(2);const ended=await f.owner.exact('maker',{id:h.id,version:'2'}),created=await f.owner.exact('maker',{id:out.facts[1]!.id,version:'1'});expect(ended.changeId).toBe(created.changeId);expect(ended.recordedAt).toBe(created.recordedAt);expect(ended.facts.handoverRuleReference).toBeNull();expect(await f.owner.readInput('maker',{inputId:staged.inputId})).toEqual(retained);expect(created.facts.source.recordLocatorEvidence).toEqual({inputId:staged.inputId,row:2});expect(created.facts.handover).toMatchObject({nursingConfirmation:{id:confirmed.data.confirmationId,digest:confirmed.data.digest}});expect((await maker.query({id:h.id,businessAt:h.T})).data?.state).toBe('ENDED');expect((await maker.query({id:out.facts[1]!.id,businessAt:h.T})).data?.state).toBe('ACTIVE');
});

test('P1: an independently ended source can confirm an exact current-head handover without reopening its responsibility',async()=>{
 const h=await stagedHandover(),original=await f.owner.exact('maker',{id:h.id,version:'1'});await f.apply(await f.input([end(h.entry,h.id,h.T)]));const safeEnd=await f.owner.exact('maker',{id:h.id,version:'2'});expect((await f.owner.read('maker',{id:h.id,businessAt:h.T})).state).toBe('ENDED');
 const repeatEnd:WardNursingEntry={...end(h.entry,h.id,h.T),action:'END',endAt:h.T,target:{owner:'care-organization/ward-nursing-coverage',id:h.id,expectedHead:'2'}};
 const laterT='2026-05-01T00:00:00.000001',laterIncoming={...h.incoming,row:{...h.incoming.row,valid_from:laterT}},laterEnd:WardNursingEntry={...repeatEnd,endAt:laterT},laterValue=await f.input([laterEnd,laterIncoming]),laterStaged=await f.owner.stage('maker',laterValue);
 const laterInput:NursingHandoverConfirm={...h.input,requestId:randomUUID(),inputId:laterStaged.inputId,inputDigest:laterStaged.digest,handover:{...h.input.handover,source:{...h.input.handover.source,expectedHead:'2'},cutover:laterT}};
 await expect(f.nursing.owner.confirmCoverageHandover('reviewer',laterInput)).rejects.toThrow();expect((await f.owner.history('maker',{id:h.id})).versions).toHaveLength(2);
 const value=await f.input([repeatEnd,h.incoming]),staged=await f.owner.stage('maker',value),input:NursingHandoverConfirm={...h.input,requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,handover:{...h.input.handover,source:{...h.input.handover.source,expectedHead:'2'}}};
 // A reviewed same-cutover successor consumes a new exact confirmation. The
 // already accepted END remains immutable and the source is never reopened.
 const proof=await f.nursing.owner.confirmCoverageHandover('reviewer',input),verification=f.verification(value,staged);verification.rows[1]!.handover={...input.handover,nursingConfirmation:{id:proof.confirmationId,digest:proof.digest}};
 const {q,candidate}=await freeze(verification);expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('AUTHORIZED');const out=await f.owner.applyUnit('maker',q);if(out.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');expect(out.facts).toHaveLength(2);
 const ended=await f.owner.exact('maker',{id:h.id,version:'3'}),created=await f.owner.exact('maker',{id:out.facts[1]!.id,version:'1'});expect(ended.action).toBe('END');expect(ended.validFrom).toBe(h.T);expect(ended.changeId).toBe(created.changeId);expect(ended.recordedAt).toBe(created.recordedAt);expect(await f.owner.exact('maker',{id:h.id,version:'1'})).toEqual(original);expect(await f.owner.exact('maker',{id:h.id,version:'2'})).toEqual(safeEnd);expect((await f.owner.read('maker',{id:h.id,businessAt:h.T})).state).toBe('ENDED');expect((await f.owner.read('maker',{id:out.facts[1]!.id,businessAt:h.T})).state).toBe('ACTIVE');
});
