import {test,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,unlinkSync,existsSync} from 'node:fs';
import {organizationKeys} from './organization-keys.mjs';
// Redirect only the external secret-file boundary to this receipt's temporary
// file. All cryptography, Owner calls and PostgreSQL behavior remain real.
vi.mock('node:fs',async importOriginal=>{
 const fs=await importOriginal<typeof import('node:fs')>();
 const r=JSON.parse(fs.readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
 const redirect=<T>(p:T):T|string=>typeof p==='string'&&p.replaceAll('\\','/').endsWith('/.runtime/vnext/p1-01/keys.secret.json')?`${process.cwd()}/.runtime/vnext/fresh/${r.name}.keys.secret.json`:p;
 return {...fs,
  existsSync:(p:Parameters<typeof fs.existsSync>[0])=>fs.existsSync(redirect(p)),
  readFileSync:(...a:Parameters<typeof fs.readFileSync>)=>fs.readFileSync(redirect(a[0]),a[1]),
  writeFileSync:(...a:Parameters<typeof fs.writeFileSync>)=>fs.writeFileSync(redirect(a[0]),a[1],a[2]),
 };
});
import {openOrganization,type StageInput,type OrganizationCommand} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {fixture} from './protected-fixture.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {Pool} from 'pg';
import {peer,quote} from './lineage.mjs';
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const exec=(s:string)=>peer(receipt.name,s);
const provider=new LocalSyntheticKeyProvider();
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!;
const org=openOrganization(connection,provider);
const catalog=await openCatalog(connection,provider);
const f=await fixture(catalog,{textField:true,ruleVersion:'ORG01_MANUAL_CORE_V1'});
const job=await catalog.importJobCommand('maker',{...f.create,requestId:randomUUID(),contractId:f.contract.id,contractVersionId:f.contract.versionId});
exec(`INSERT INTO vnext_control.protected_grant SELECT a,${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
const artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO_REGISTRATION_EVIDENCE'));
const source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(v=>v.kind==='SOURCE'&&v.status==='PUBLISHED')!;
const common={validFrom:'2026-01-01T00:00:00',validTo:null,source:{systemId:source.id,versionId:source.versionId,alias:'DEMO_ORG',versionNo:1,recordLocator:'DEMO_SHEET_ROW_1',recordedAt:'2026-01-01T00:00:00',recordStatus:'PUBLISHED' as const,approvalRef:'DEMO_OFFICE_APPROVAL'}};
const create=():OrganizationCommand=>({...structuredClone(common),action:'CREATE',facts:{legalName:'DEMO 同名医院',entityNature:'DEMO 登记主体',authority:'DEMO 院办',legalAddress:'DEMO 地址',registrationEvidence:artifact.artifactId},identifiers:[]});
const input=(command:OrganizationCommand):StageInput=>({requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',command});
async function prepare(command:OrganizationCommand){const i=await org.stage('maker',input(command));const requestId=randomUUID();const c=await org.plan('maker',{inputId:i.inputId,requestId});await org.readApplyCandidate('reviewer',{candidateId:c.candidateId});await org.approveApplyUnit('reviewer',c);return {candidateId:c.candidateId,requestId};}
async function apply(command:OrganizationCommand){const request=await prepare(command);const result=await org.applyUnit('maker',request);expect(result.status).toBe('COMMITTED');if(result.status!=='COMMITTED')throw new Error('NOT_COMMITTED');return result.facts[0]!;}
test('TDD R1: redeploy after losing a provisioned key fails closed and restoring it preserves input readability',async()=>{
 const keyPath=`${process.cwd()}/.runtime/vnext/fresh/${receipt.name}.keys.secret.json`;
 const initial=organizationKeys(receipt,{create:true}),service=openOrganization(connection,initial);
 let original:Buffer|undefined;
 try{
  const staged=await service.stage('maker',input(create()));original=readFileSync(keyPath);unlinkSync(keyPath);
  expect(()=>organizationKeys(receipt,{create:true})).toThrow('KEY_UNAVAILABLE');
  expect(existsSync(keyPath)).toBe(false);
  writeFileSync(keyPath,original,{flag:'wx'});
  const restored=openOrganization(connection,organizationKeys(receipt));try{expect((await restored.readRestrictedInput('maker',staged.inputId)).command.source.alias).toBe('DEMO_ORG');}finally{await restored.close();}
 }finally{await service.close();if(existsSync(keyPath))unlinkSync(keyPath);}
});
test('AC01 same names remain separate identities; rename appends immutable history',async()=>{
 const a=await apply(create()),b=await apply(create());expect(a.id).not.toBe(b.id);
 const revised=create();if(revised.action!=='CREATE')throw new Error();
 const r=await apply({...revised,action:'REVISE',target:{id:a.id,version:a.version},facts:{...revised.facts,legalName:'DEMO 新名称'}});
 expect(r.id).toBe(a.id);expect(r.version).toBe('2');
 const history=await org.read('maker',{id:a.id,mode:'HISTORY'});expect(history.map(v=>v.legalName)).toEqual(['DEMO 同名医院','DEMO 新名称']);
 const prior=await org.read('maker',{id:a.id,mode:'EFFECTIVE',businessAt:'2026-06-01T00:00:00',asOf:history[0]!.recordedAt});expect(prior[0]!.version).toBe('1');
});
test('AC02 duplicate credential isolates the second subject without deleting its input',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();c.identifiers=[{kind:'INSTITUTION_CODE',namespace:'DEMO_REGISTRY',value:'DEMO_COLLISION'}];
 await apply(c);const staged=await org.stage('maker',input(c));await expect(org.plan('maker',{inputId:staged.inputId,requestId:randomUUID()})).rejects.toThrow();
 expect(exec(`SELECT count(*) FROM organization_master.input WHERE id=${quote(staged.inputId)}::uuid;`)).toBe('1');
});
test('AC03 and AC05 registered qualification requires evidence and whole licensed window',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();c.identifiers=[{kind:'INSTITUTION_CODE',namespace:'DEMO_REGISTRY',value:randomUUID()}];
 const a=await apply(c),target={id:a.id,version:a.version};
 const l=await apply({...common,action:'ADD_LICENSE',target,license:{namespace:'DEMO_LICENSE',number:'DEMO_'+randomUUID(),authority:'DEMO_AUTHORITY',evidence:artifact.artifactId,validFrom:'2027-01-01',validTo:'2028-01-01T13:45:06',endKind:'FINITE'}});
 const verify:OrganizationCommand={...common,action:'VERIFY_REGISTRATION',target,licenseTargets:[{id:l.id,version:l.version}],creditCodeStatus:'NOT_APPLICABLE',evidence:artifact.artifactId};
 await expect(prepare(verify)).rejects.toThrow();
 await apply({...verify,validFrom:'2027-01-01T00:00:00',validTo:'2028-01-01T13:45:06'});
 expect((await org.qualification('maker',{id:a.id,validFrom:'2027-01-01T00:00:00',validTo:'2028-01-01T13:45:06'})).status).toBe('LICENSED_REGISTRATION');
 expect((await org.qualification('maker',{id:a.id,validFrom:'2026-01-01T00:00:00',validTo:'2027-01-01T00:00:00'})).status).toBe('NOT_ESTABLISHED');
 const missing=create();if(missing.action!=='CREATE')throw new Error();missing.facts.registrationEvidence=randomUUID();await expect(prepare(missing)).rejects.toThrow();
});
test('AC04 three synthetic nodes use one persisted subject, without operating authorization',async()=>{
 const a=await apply(create());const refs=['DEMO 本部','DEMO 高新','DEMO 中心'].map(node=>({node,organizationId:a.id}));
 for(const ref of refs)expect((await org.read('maker',{id:ref.organizationId,mode:'EXACT',version:'1'}))[0]!.id).toBe(a.id);
 expect((await org.qualification('maker',{id:a.id,validFrom:'2026-01-01T00:00:00',validTo:null})).operatingPermission).toBe('NOT_EVALUABLE');
});
test('maker checker, current permissions, replay and withdrawal',async()=>{
 const i=await org.stage('maker',input(create())),requestId=randomUUID(),c=await org.plan('maker',{inputId:i.inputId,requestId});
 await expect(org.approveApplyUnit('maker-alias',c)).rejects.toThrow();
 await org.readApplyCandidate('reviewer',{candidateId:c.candidateId});await org.approveApplyUnit('reviewer',c);
 const request={candidateId:c.candidateId,requestId};const results=await Promise.all([org.applyUnit('maker',request),org.applyUnit('maker-alias',request)]);expect(results[0]).toEqual(results[1]);
 await expect(org.read('outsider',{mode:'LIST'})).rejects.toThrow('ACCESS_DENIED');
 const w=await org.stage('maker',input(create()));await org.withdraw('maker',{inputId:w.inputId,requestId:randomUUID()});await expect(org.plan('maker',{inputId:w.inputId,requestId:randomUUID()})).rejects.toThrow('STALE_VALIDATION');
});
test('reviewer revocation after approval blocks new writes; READ-only committed replay needs no keys',async()=>{
 const request=await prepare(create());
 exec("DELETE FROM organization_master.access WHERE actor='reviewer' AND permission='REVIEW' AND subject_id='00000000-0000-0000-0000-000000000000';");
 await expect(org.applyUnit('maker',request)).rejects.toThrow('ACCESS_DENIED');
 exec("INSERT INTO organization_master.access VALUES('reviewer','00000000-0000-0000-0000-000000000000','NORTH','REVIEW');");
 const result=await org.applyUnit('maker',request);expect(result.status).toBe('COMMITTED');
 exec("DELETE FROM vnext_control.actor_grant WHERE actor_code='maker' AND scope='SYNTHETIC' AND permission='WRITE';");
 const noKey=openOrganization(connection);try{expect(await noKey.applyUnit('maker',request)).toEqual(result);}finally{await noKey.close();exec("INSERT INTO vnext_control.actor_grant VALUES('maker','SYNTHETIC','WRITE');");}
});
test('same request changed payload conflicts; stale organization head prevents applying approved revision',async()=>{
 const value=input(create());expect(await org.stage('maker',value)).toEqual(await org.stage('maker',value));
 const changed=structuredClone(value);changed.command.source.alias='DEMO_CHANGED';await expect(org.stage('maker',changed)).rejects.toThrow('REQUEST_CONFLICT');
 const a=await apply(create()),c=create();if(c.action!=='CREATE')throw new Error();
 const update={...c,action:'REVISE' as const,target:{id:a.id,version:a.version}};
 const old=await prepare(update);await apply({...update,facts:{...update.facts,legalName:'DEMO Concurrent'}});
 await expect(org.applyUnit('maker',old)).rejects.toThrow('STALE_VALIDATION');
});
test('unknown expiration blocks licensed state; revocation remains possible after source evidence expires',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();c.identifiers=[{kind:'INSTITUTION_CODE',namespace:'DEMO_REGISTRY',value:randomUUID()}];
 const a=await apply(c),target={id:a.id,version:a.version};
 const l=await apply({...common,action:'ADD_LICENSE',target,license:{namespace:'DEMO_LICENSE',number:'DEMO_'+randomUUID(),authority:'DEMO',evidence:artifact.artifactId,validFrom:'2026-01-01',validTo:null,endKind:'UNKNOWN'}});
 await expect(prepare({...common,action:'VERIFY_REGISTRATION',target,licenseTargets:[{id:l.id,version:l.version}],creditCodeStatus:'NOT_APPLICABLE',evidence:artifact.artifactId})).rejects.toThrow();
 const revoked=await apply({...common,source:{...common.source,systemId:randomUUID(),versionId:randomUUID()},action:'REVOKE_LICENSE',target,licenseTarget:{id:l.id,version:l.version},reason:'DEMO_WITHDRAW'});expect(revoked.version).toBe('2');
});
test('success audit failure rolls back business facts and outcome; app role cannot directly write',async()=>{
 const request=await prepare(create());const counts=()=>exec('SELECT jsonb_build_array((SELECT count(*) FROM organization_master.subject),(SELECT count(*) FROM organization_master.version),(SELECT count(*) FROM vnext_control.outcome),(SELECT count(*) FROM governance_catalog.apply_commit));');
 const before=counts();exec("CREATE FUNCTION organization_master.test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='OWNER_APPLY_COMMIT' THEN RAISE EXCEPTION 'DEMO_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER p1_audit_fail BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION organization_master.test_fail_audit();");
 try{await expect(org.applyUnit('maker',request)).rejects.toThrow();expect(counts()).toBe(before);}finally{exec('DROP TRIGGER p1_audit_fail ON vnext_control.audit; DROP FUNCTION organization_master.test_fail_audit();');}
 const pool=new Pool({connectionString:connection});try{await expect(pool.query("INSERT INTO organization_master.subject(campus) VALUES('NORTH')")).rejects.toMatchObject({code:'42501'});}finally{await pool.end();}
});
test('real HTTP typed flow creates, reviews, applies, reads history and rejects actor injection',async()=>{
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',{owner:org,actor:r=>actor(r.headers)});await app.listen({host:'127.0.0.1',port:0});
 try{
  const address=app.server.address();if(!address||typeof address==='string')throw new Error('NO_ADDRESS');
  const call=async(path:string,body:unknown,who='maker')=>{const r=await fetch(`http://127.0.0.1:${address.port}/api/vnext/organizations/${path}`,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':who},body:JSON.stringify(body)});return {status:r.status,body:await r.json() as Record<string,any>};};
  const staged=await call('inputs',input(create()));expect(staged.status).toBe(200);
  const requestId=randomUUID(),plan=await call('plan',{inputId:staged.body['inputId'],requestId});expect(plan.status).toBe(200);
  expect((await call('review',{candidateId:plan.body['candidateId']},'reviewer')).status).toBe(200);
  expect((await call('approve',plan.body,'reviewer')).status).toBe(200);
  const result=await call('apply',{candidateId:plan.body['candidateId'],requestId});expect(result.body['status']).toBe('COMMITTED');
  const rows=await call('query',{mode:'HISTORY',id:result.body['facts'][0].id});expect(rows.status).toBe(200);expect(JSON.stringify(rows.body)).not.toContain('DEMO_OFFICE_APPROVAL');
  expect((await call('inputs',{...input(create()),approvedBy:'reviewer'})).status).toBe(400);
  expect((await call('query',{mode:'LIST'},'outsider')).status).toBe(403);
 }finally{await app.close();}
});
test('review regression: original input identity cannot be laundered through another planner',async()=>{
 const i=await org.stage('maker',input(create()));await expect(org.plan('reviewer',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');
});
test('review regression: an input revision has only one frozen apply request',async()=>{
 const i=await org.stage('maker',input(create()));await org.plan('maker',{inputId:i.inputId,requestId:randomUUID()});
 await expect(org.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('REQUEST_CONFLICT');
});
test('review regression: reviewer attachment permission is rechecked at apply',async()=>{
 const request=await prepare(create());exec(`DELETE FROM vnext_control.protected_grant WHERE actor_code='reviewer' AND dataset_id=${quote(f.dataset.id)}::uuid AND permission='READ';`);
 try{await expect(org.applyUnit('maker',request)).rejects.toThrow('ACCESS_DENIED');}finally{exec(`INSERT INTO vnext_control.protected_grant VALUES('reviewer',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ');`);}
});
test('authenticated evidence rejects corruption and source substitution',async()=>{
 const saved=exec(`SELECT encode(ciphertext,'hex') FROM governance_catalog.protected_payload WHERE artifact_id=${quote(artifact.artifactId)}::uuid;`);
 exec(`UPDATE governance_catalog.protected_payload SET ciphertext=decode('00000000000000000000000000000000','hex') WHERE artifact_id=${quote(artifact.artifactId)}::uuid;`);
 try{await expect(prepare(create())).rejects.toThrow('PAYLOAD_UNAVAILABLE');}finally{exec(`UPDATE governance_catalog.protected_payload SET ciphertext=decode(${quote(saved)},'hex') WHERE artifact_id=${quote(artifact.artifactId)}::uuid;`);}
 const c=create();c.source.versionId=randomUUID();await expect(prepare(c)).rejects.toThrow('BLOCKED_DEPENDENCY');
});
test('FULL and unresolved explicit references remain intact and never downgrade to CORE',async()=>{
 for(const extra of [{profile:'FULL' as const},{dependencies:[{kind:'CAMPUS_OPERATION' as const,id:randomUUID()}]}]){
  const original={...input(create()),...extra},stored=await org.stage('maker',original);
  await expect(org.plan('maker',{inputId:stored.inputId,requestId:randomUUID()})).rejects.toThrow('BLOCKED_DEPENDENCY');
  expect(await org.readRestrictedInput('maker',stored.inputId)).toEqual(original);
 }
});
test('concurrent alternate requests cannot apply one input twice; object READ revocation blocks original input recovery',async()=>{
 const i=await org.stage('maker',input(create()));const results=await Promise.allSettled([org.plan('maker',{inputId:i.inputId,requestId:randomUUID()}),org.plan('maker-alias',{inputId:i.inputId,requestId:randomUUID()})]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const request=await prepare(create()),outcome=await org.applyUnit('maker',request);if(outcome.status!=='COMMITTED')throw new Error();const id=outcome.facts[0]!.id;
 exec(`DELETE FROM organization_master.access WHERE actor='maker' AND subject_id=${quote(id)}::uuid AND permission='READ';`);
 await expect(org.resumeOutcome('maker',request)).rejects.toThrow('ACCESS_DENIED');
});
test('reviewer source READ revocation blocks apply and restricted input hides originals from unauthorized readers',async()=>{
 const request=await prepare(create());
 const grants=exec(`SELECT jsonb_agg(to_jsonb(g)) FROM vnext_control.object_grant g WHERE actor_code='reviewer' AND object_id=${quote(source.id)}::uuid AND permission='READ';`);
 exec(`DELETE FROM vnext_control.object_grant WHERE actor_code='reviewer' AND object_id=${quote(source.id)}::uuid AND permission='READ';`);
 try{await expect(org.applyUnit('maker',request)).rejects.toThrow('ACCESS_DENIED');}finally{exec(`INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,${quote(grants)}::jsonb);`);}
 const i=await org.stage('maker',input(create()));await expect(org.readRestrictedInput('outsider',i.inputId)).rejects.toThrow('ACCESS_DENIED');
 expect((await org.readRestrictedInput('reviewer',i.inputId)).command.source.recordLocator).toBe('DEMO_SHEET_ROW_1');
});
test('future renewal preserves earlier licensed business intervals and unions adjacent verified intervals',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();c.identifiers=[{kind:'INSTITUTION_CODE',namespace:'DEMO_REGISTRY',value:randomUUID()}];const a=await apply(c),target={id:a.id,version:a.version};
 const license={namespace:'DEMO_LICENSE',number:'DEMO_'+randomUUID(),authority:'DEMO',evidence:artifact.artifactId,validFrom:'2026-01-01',validTo:'2027-01-01',endKind:'FINITE' as const};
 const l=await apply({...common,action:'ADD_LICENSE',target,license});
 const verify={...common,action:'VERIFY_REGISTRATION' as const,target,licenseTargets:[{id:l.id,version:l.version}],creditCodeStatus:'NOT_APPLICABLE' as const,evidence:artifact.artifactId,validTo:'2027-01-01T00:00:00'};
 await apply(verify);
 const next=await apply({...common,action:'REVISE_LICENSE',target,licenseTarget:{id:l.id,version:l.version},license:{...license,validFrom:'2027-01-01',validTo:'2028-01-01'}});
 expect((await org.readLicenses('maker',{id:a.id,licenseId:l.id,mode:'EFFECTIVE',businessAt:'2026-06-01T00:00:00'}))[0]!.version).toBe('1');
 expect((await org.readLicenses('maker',{id:a.id,licenseId:l.id,mode:'EXACT',version:'2'}))[0]!.version).toBe('2');
 expect(await org.readLicenses('maker',{id:a.id,licenseId:l.id,mode:'HISTORY'})).toHaveLength(2);
 expect((await org.qualification('maker',{id:a.id,validFrom:'2026-01-01T00:00:00',validTo:'2027-01-01T00:00:00'})).status).toBe('LICENSED_REGISTRATION');
 await apply({...verify,licenseTargets:[{id:next.id,version:next.version}],validFrom:'2027-01-01T00:00:00',validTo:'2028-01-01T00:00:00'});
 expect((await org.qualification('maker',{id:a.id,validFrom:'2026-01-01T00:00:00',validTo:'2028-01-01T00:00:00'})).status).toBe('LICENSED_REGISTRATION');
 const revised=await apply({...c,action:'REVISE',target,validFrom:'2027-01-01T00:00:00',facts:{...c.facts,legalName:'DEMO Future name'}});
 expect((await org.qualification('maker',{id:a.id,validFrom:'2026-01-01T00:00:00',validTo:'2027-01-01T00:00:00'})).status).toBe('LICENSED_REGISTRATION');
 await apply({...verify,target:{id:a.id,version:revised.version},licenseTargets:[{id:next.id,version:next.version}],validFrom:'2027-01-01T00:00:00',validTo:'2028-01-01T00:00:00'});
 expect((await org.qualification('maker',{id:a.id,validFrom:'2026-01-01T00:00:00',validTo:'2028-01-01T00:00:00'})).status).toBe('LICENSED_REGISTRATION');
});
test('two connections contend for the same license: one commits and the other retains a blocked candidate',async()=>{
 const a=await apply(create()),b=await apply(create());
 const license={namespace:'DEMO_CONCURRENT_LICENSE',number:'DEMO_'+randomUUID(),authority:'DEMO',evidence:artifact.artifactId,validFrom:'2026-01-01',validTo:null,endKind:'VERIFIED_UNBOUNDED' as const};
 const requests=await Promise.all([prepare({...common,action:'ADD_LICENSE',target:{id:a.id,version:a.version},license}),prepare({...common,action:'ADD_LICENSE',target:{id:b.id,version:b.version},license})]);
 const other=openOrganization(connection,provider);try{const results=await Promise.allSettled([org.applyUnit('maker',requests[0]!),other.applyUnit('maker',requests[1]!)]);expect(results.filter(r=>r.status==='fulfilled'&&r.value.status==='COMMITTED')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);}finally{await other.close();}
 expect((await org.historyDetails('maker',a.id)).licenses.length+(await org.historyDetails('maker',b.id)).licenses.length).toBe(1);
});
test('TDD R2: scheduled future versions do not prevent first verification of a still-effective older business period',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();c.identifiers=[{kind:'INSTITUTION_CODE',namespace:'DEMO_R2',value:randomUUID()}];
 const a=await apply(c),target={id:a.id,version:a.version};
 const license={namespace:'DEMO_R2_LICENSE',number:'DEMO_'+randomUUID(),authority:'DEMO',evidence:artifact.artifactId,validFrom:'2026-01-01',validTo:'2027-01-01',endKind:'FINITE' as const};
 const l=await apply({...common,action:'ADD_LICENSE',target,license});
 const future=await apply({...common,action:'REVISE_LICENSE',target,licenseTarget:{id:l.id,version:l.version},license:{...license,validFrom:'2027-01-01',validTo:'2028-01-01'}});
 // The subject still spans both years here: one verification can reference both
 // exact versions of the same license, without inventing a second license ID.
 await apply({...common,action:'VERIFY_REGISTRATION',target,licenseTargets:[{id:l.id,version:l.version},{id:future.id,version:future.version}],creditCodeStatus:'NOT_APPLICABLE',evidence:artifact.artifactId,validTo:'2028-01-01T00:00:00'});
 const laterSubject=await apply({...c,action:'REVISE',target,validFrom:'2027-01-01T00:00:00',facts:{...c.facts,legalName:'DEMO Scheduled'}});
 await apply({...common,action:'VERIFY_REGISTRATION',target,licenseTargets:[{id:l.id,version:l.version}],creditCodeStatus:'NOT_APPLICABLE',evidence:artifact.artifactId,validTo:'2027-01-01T00:00:00'});
 expect((await org.qualification('maker',{id:a.id,validFrom:common.validFrom,validTo:'2027-01-01T00:00:00'})).status).toBe('LICENSED_REGISTRATION');
 const history=await org.read('maker',{id:a.id,mode:'HISTORY'});
 expect((await org.historyDetails('maker',a.id)).verifications.at(-1)!.subjectVersionId).toBe(history[0]!.versionId);
 // A superseded business segment cannot be approved using the old subject.
 await expect(prepare({...common,action:'VERIFY_REGISTRATION',target,licenseTargets:[{id:future.id,version:future.version}],creditCodeStatus:'NOT_APPLICABLE',evidence:artifact.artifactId,validFrom:'2027-01-01T00:00:00',validTo:'2028-01-01T00:00:00'})).rejects.toThrow('LICENSE_PERIOD_NOT_COVERED');
 expect(laterSubject.version).toBe('2');
});
test('TDD R3: frozen candidates remain readable after commit or supersession, without authorizing another write',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();c.identifiers=[{kind:'INSTITUTION_CODE',namespace:'DEMO_R3',value:randomUUID()}];
 const request=await prepare(c);const before=await org.readApplyCandidate('reviewer',{candidateId:request.candidateId});
 const committed=await org.applyUnit('maker',request);if(committed.status!=='COMMITTED')throw new Error('NOT_COMMITTED');
 const after=await org.readApplyCandidate('reviewer',{candidateId:request.candidateId});expect(after.unit).toEqual(before.unit);expect(after.digest).toBe(before.digest);
 const subject=committed.facts[0]!,target={id:subject.id,version:subject.version};
 const pending=await prepare({...c,action:'REVISE',target,facts:{...c.facts,legalName:'DEMO Pending'}});
 const frozen=await org.readApplyCandidate('reviewer',{candidateId:pending.candidateId});
 await apply({...c,action:'REVISE',target,facts:{...c.facts,legalName:'DEMO Current'}});
 expect((await org.readApplyCandidate('reviewer',{candidateId:pending.candidateId})).unit).toEqual(frozen.unit);
 await expect(org.applyUnit('maker',pending)).rejects.toThrow('STALE_VALIDATION');
 exec(`DELETE FROM organization_master.access WHERE actor='reviewer' AND subject_id=${quote(subject.id)}::uuid AND permission='READ_RESTRICTED';`);
 await expect(org.readApplyCandidate('reviewer',{candidateId:pending.candidateId})).rejects.toThrow('ACCESS_DENIED');
});
test('TDD R4: identifier-only and evidence-only revisions appear as redacted changes through Owner and HTTP',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();
 c.identifiers=[{kind:'INSTITUTION_CODE',namespace:'DEMO_R4',value:'DEMO_OLD_INST_'+randomUUID()},{kind:'UNIFIED_CREDIT_CODE',namespace:'DEMO_R4',value:'DEMO_OLD_CREDIT_'+randomUUID()}];
 const a=await apply(c);
 const proof=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO_REVISED_REGISTRATION_EVIDENCE'));
 const identifiers=c.identifiers.map(i=>({...i,value:'DEMO_NEW_'+randomUUID()}));
 const b=await apply({...c,action:'REVISE',target:{id:a.id,version:a.version},facts:{...c.facts,registrationEvidence:proof.artifactId},identifiers});
 const expected={id:a.id,fromVersion:a.version,toVersion:b.version,changes:[
  {field:'institutionCode',before:null,after:null,redacted:true},
  {field:'unifiedCreditCode',before:null,after:null,redacted:true},
  {field:'registrationEvidence',before:null,after:null,redacted:true},
 ]};
 expect(await org.diff('maker',a.id,a.version,b.version)).toEqual(expected);
 // Reordering an unchanged identifier set is not a semantic change.
 const same=await apply({...c,action:'REVISE',target:{id:a.id,version:b.version},facts:{...c.facts,registrationEvidence:proof.artifactId},identifiers:[...identifiers].reverse()});
 expect((await org.diff('maker',a.id,b.version,same.version)).changes).toEqual([]);
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',{owner:org,actor:r=>actor(r.headers)});await app.listen({host:'127.0.0.1',port:0});
 try{const address=app.server.address();if(!address||typeof address==='string')throw new Error('NO_ADDRESS');const result=await fetch(`http://127.0.0.1:${address.port}/api/vnext/organizations/diff`,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify({id:a.id,fromVersion:a.version,toVersion:b.version})});expect(result.status).toBe(200);expect(await result.json()).toEqual(expected);}finally{await app.close();}
});
test('historical registration materials retain their own source version during a new source review',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();c.identifiers=[{kind:'INSTITUTION_CODE',namespace:'DEMO_REGISTRY',value:randomUUID()}];const a=await apply(c),target={id:a.id,version:a.version};
 const l=await apply({...common,action:'ADD_LICENSE',target,license:{namespace:'DEMO_LICENSE',number:'DEMO_'+randomUUID(),authority:'DEMO',evidence:artifact.artifactId,validFrom:'2026-01-01',validTo:null,endKind:'VERIFIED_UNBOUNDED'}});
 const draft=await catalog.command('maker',{...f.cmd('REVISE'),target:source.id,expectedHead:source.head,values:{name:'DEMO Source revised'},validFrom:'2026-01-01T00:00:00'});
 const review=await catalog.command('maker',{...f.cmd('SUBMIT'),target:source.id,expectedHead:draft.head});
 const impact=await catalog.sourceImpact('reviewer','SYNTHETIC',source.id,'PUBLISH');
 const revised=await catalog.command('reviewer',{...f.cmd('PUBLISH'),target:source.id,expectedHead:review.head,reviewDigest:review.reviewDigest,impactDigest:impact.impactDigest});
 const f2=await fixture(catalog,{textField:true,ruleVersion:'DEMO_REVIEW_SOURCE_V2'});
 const job2=await catalog.importJobCommand('maker',{...f2.create,requestId:randomUUID(),contractId:f2.contract.id,contractVersionId:f2.contract.versionId});
 exec(`INSERT INTO vnext_control.protected_grant SELECT a,${quote(f2.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
 const proof=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job2.id,revisionId:job2.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO_NEW_REGISTRATION_REVIEW'));
 const command:OrganizationCommand={...common,source:{...common.source,versionId:revised.versionId},action:'VERIFY_REGISTRATION',target,licenseTargets:[{id:l.id,version:l.version}],creditCodeStatus:'NOT_APPLICABLE',evidence:proof.artifactId};
 const i=await org.stage('maker',{...input(command),jobId:job2.id,revisionId:job2.revisionId});const requestId=randomUUID();const candidate=await org.plan('maker',{inputId:i.inputId,requestId});await org.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await org.approveApplyUnit('reviewer',candidate);expect((await org.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status).toBe('COMMITTED');
});
import {afterAll} from 'vitest';
afterAll(async()=>{await org.close();await catalog.close();});
