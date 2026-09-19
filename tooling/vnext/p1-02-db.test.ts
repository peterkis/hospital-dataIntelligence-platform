import {provisionCampusAuthority} from './campus-authority.mjs';
import {createCampusClient} from '../../packages/generated-api-client/src/index.js';
import {campusCodeSet} from './campus-fixture.js';
import {test,expect,afterAll} from 'vitest';
import {randomUUID,createHmac} from 'node:crypto';
import {canonicalPlan,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/plan-binding.js';
import {readFileSync,existsSync,writeFileSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {openCampus,type CampusCommand} from '../../apps/governance-api/src/modules/organization-master/campus/index.js';
import {openOrganization} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {fixture} from './protected-fixture.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {Pool} from 'pg';
import {peer,quote} from './lineage.mjs';
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const exec=(s:string)=>peer(receipt.name,s);
const provider=new LocalSyntheticKeyProvider();
provisionCampusAuthority(receipt,provider);
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!;
const org=openCampus(connection,provider);
const catalog=await openCatalog(connection,provider);
const f=await fixture(catalog,{textField:true,ruleVersion:'ORG01_MANUAL_CORE_V1'});
const job=await catalog.importJobCommand('maker',{...f.create,requestId:randomUUID(),contractId:f.contract.id,contractVersionId:f.contract.versionId});
exec(`INSERT INTO vnext_control.protected_grant SELECT a,${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
const artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO_REGISTRATION_EVIDENCE'));
const source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(v=>v.kind==='SOURCE'&&v.status==='PUBLISHED')!;
const common={validFrom:'2026-01-01T00:00:00',validTo:null,source:{systemId:source.id,versionId:source.versionId,alias:'DEMO_ORG',versionNo:1,recordLocator:'DEMO_SHEET_ROW_1',recordedAt:'2026-01-01T00:00:00',recordStatus:'PUBLISHED' as const,approvalRef:'DEMO_OFFICE_APPROVAL'}};

afterAll(async()=>{await org.close();await catalog.close();});
test('campus input can enter the governed Owner without creating a legal subject',async()=>{
 const result=await org.stage('maker',{requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',command:{...common,action:'CREATE',evidence:artifact.artifactId,sourceOperationStatus:'PLANNING',facts:{campusCode:'DEMO_MAIN',campusName:'DEMO 本部',nodeRole:'HEADQUARTERS',nodeKind:'PHYSICAL',campusAddress:null,adminDivision:null,publicPhone:null,openingDate:null}}});
 expect(result).toHaveProperty('inputId');
});

const create=():CampusCommand=>({...structuredClone(common),action:'CREATE',evidence:artifact.artifactId,sourceOperationStatus:'PLANNING',facts:{campusCode:'DEMO_'+randomUUID(),campusName:'DEMO 本部',nodeRole:'HEADQUARTERS',nodeKind:'PHYSICAL',campusAddress:null,adminDivision:null,publicPhone:null,openingDate:null}});
const input=(command:CampusCommand)=>({requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,command});
async function prepare(command:CampusCommand){const i=await org.stage('maker',input(command));const requestId=randomUUID(),candidate=await org.plan('maker',{inputId:i.inputId,requestId});await org.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await org.approveApplyUnit('reviewer',candidate);return {candidateId:candidate.candidateId,requestId};}
async function apply(command:CampusCommand){const result=await org.applyUnit('maker',await prepare(command));expect(result.status).toBe('COMMITTED');if(result.status!=='COMMITTED')throw new Error('NOT_COMMITTED');return result.facts[0]!;}
const target=(f:{id:string;version:string})=>({owner:'organization-master/campus' as const,id:f.id,expectedVersion:f.version});
test('AC01/02: create and rename preserve campus identity without legal subject creation',async()=>{
 const before=exec('SELECT count(*) FROM organization_master.subject;');const c=create();if(c.action!=='CREATE')throw new Error();
 const a=await apply(c),b=await apply({...c,action:'REVISE',target:target(a),facts:{...c.facts,campusName:'DEMO 更名',campusAddress:'DEMO 迁址'}});
 expect(b.id).toBe(a.id);expect(b.version).toBe('2');
 const history=await org.history('maker',a.id);expect(history.versions).toHaveLength(2);
 expect((await org.read('maker',{id:a.id,businessAt:'2026-06-01T00:00:00'})).facts?.campusName).toBe('DEMO 更名');
 expect(exec('SELECT count(*) FROM organization_master.subject;')).toBe(before);
});

test('AC03: scheduling and cancelling never activate a campus',async()=>{
 const a=await apply(create());const b=await apply({...common,action:'SCHEDULE_OPENING',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'PLANNING',plannedOpeningAt:'2027-01-01T00:00:00'});
 expect(await org.read('maker',{id:a.id,businessAt:'2027-02-01T00:00:00'})).toMatchObject({operationStatus:'PLANNING',plannedOpeningAt:'2027-01-01T00:00:00.000000'});
 await apply({...common,action:'CANCEL_OPENING',target:target(b),evidence:artifact.artifactId,sourceOperationStatus:'PLANNING',reason:'DEMO_CANCEL'});
 expect(await org.read('maker',{id:a.id,businessAt:'2027-02-01T00:00:00'})).toMatchObject({operationStatus:'PLANNING',plannedOpeningAt:null});
});

test('AC05: physical campus activation cannot be approved with a null address or division',async()=>{
 const a=await apply(create());await expect(prepare({...common,action:'ACTIVATE',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'RUNNING',state:'RUNNING'})).rejects.toThrow('BLOCKED_DEPENDENCY');
});

let adopted:Awaited<ReturnType<typeof campusCodeSet>>;
test('adopted exact division enables scheduled operation; suspension overrides future opening without re-admission',async()=>{
 adopted=await campusCodeSet(catalog,source.versionId);
 const c=create();if(c.action!=='CREATE')throw new Error();c.facts.campusAddress='DEMO 地址';c.facts.adminDivision=adopted.reference;
 const a=await apply(c);const b=await apply({...common,action:'ACTIVATE',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'RUNNING',state:'RUNNING',validFrom:'2027-01-01T00:00:00.000001'});
 const h=await org.history('maker',a.id);
 expect(await org.read('maker',{id:a.id,businessAt:'2027-01-01T00:00:00'})).toMatchObject({operationStatus:'PLANNING'});
 expect(await org.read('maker',{id:a.id,businessAt:'2027-01-01T00:00:00.000001'})).toMatchObject({operationStatus:'RUNNING'});
 await apply({...common,action:'SUSPEND',target:target(b),evidence:randomUUID(),source:{...common.source,systemId:randomUUID(),versionId:randomUUID()},sourceOperationStatus:'SUSPENDED',validFrom:'2026-12-01T00:00:00',reason:'DEMO_CLOSE'});
 expect(await org.read('maker',{id:a.id,businessAt:'2027-02-01T00:00:00'})).toMatchObject({operationStatus:'SUSPENDED'});
 expect(await org.read('maker',{id:a.id,businessAt:'2027-02-01T00:00:00',asOf:h.operations.at(-1)!.recordedAt})).toMatchObject({operationStatus:'RUNNING'});
});

test('real HTTP exposes campus creation, review, apply and ordinary version facts',async()=>{
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,{owner:org,actor:r=>actor(r.headers)});await app.listen({host:'127.0.0.1',port:0});
 try{const address=app.server.address();if(!address||typeof address==='string')throw new Error('NO_ADDRESS');
 const baseUrl=`http://127.0.0.1:${address.port}`,client=createCampusClient(baseUrl,'maker'),reviewer=createCampusClient(baseUrl,'reviewer');
 const staged=await client.stage(input(create()));expect(staged.response.status).toBe(200);const requestId=randomUUID();
 const plan=await client.plan({inputId:staged.data!.inputId,requestId});expect(plan.response.status).toBe(200);const candidate=plan.data!;
 expect((await reviewer.review(candidate.candidateId)).response.status).toBe(200);expect((await reviewer.approve(candidate)).response.status).toBe(200);
 const outcome=await client.apply({candidateId:candidate.candidateId,requestId});expect(outcome.response.status).toBe(200);const id=outcome.data!.facts![0]!.id;
 expect((await client.getCampusAsOf({id})).data).toMatchObject({operationStatus:'PLANNING',operatingPermission:'NOT_EVALUABLE',facts:{nodeRole:'HEADQUARTERS',publicPhone:null}});
 expect((await client.version({id,version:'1'})).data).toMatchObject({version:'1'});
 expect((await client.history(id)).data!.versions).toHaveLength(1);
 expect((await client.diff({id,fromVersion:'1',toVersion:'1'})).data).toMatchObject({changes:[]});

 }finally{await app.close();}
});

test('AC04 code conflicts freeze reviewable candidates and reserve old codes after rename and suspension',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();const a=await apply(c);const b=await apply({...c,action:'REVISE',target:target(a),facts:{...c.facts,campusCode:'DEMO_'+randomUUID()}});
 const stopped=await apply({...common,action:'SUSPEND',target:target(b),evidence:randomUUID(),sourceOperationStatus:'SUSPENDED',reason:'DEMO_STOP'});
 const i=await org.stage('maker',input(c)),candidate=await org.plan('maker',{inputId:i.inputId,requestId:randomUUID()});
 expect((await org.readApplyCandidate('reviewer',{candidateId:candidate.candidateId})).unit.basis['blockingIssues']).toEqual(['IDENTIFIER_CONFLICT']);
 await expect(org.approveApplyUnit('reviewer',candidate)).rejects.toThrow('IDENTIFIER_CONFLICT');
 await expect(prepare({...common,action:'ACTIVATE',target:target(stopped),evidence:artifact.artifactId,sourceOperationStatus:'RUNNING',state:'RUNNING'})).rejects.toThrow('BLOCKED_DEPENDENCY');
 await expect(prepare({...common,action:'SCHEDULE_OPENING',target:target(stopped),evidence:artifact.artifactId,sourceOperationStatus:'SUSPENDED',plannedOpeningAt:'2027-01-01T00:00:00'})).rejects.toThrow('BLOCKED_DEPENDENCY');
});
test('current permissions, alias self-review, wrong scope and withdrawal are enforced',async()=>{
 const i=await org.stage('maker',input(create())),candidate=await org.plan('maker',{inputId:i.inputId,requestId:randomUUID()});
 await expect(org.approveApplyUnit('maker-alias',candidate)).rejects.toThrow();
 await expect(org.readRestrictedInput('outsider',i.inputId)).rejects.toThrow('ACCESS_DENIED');
 await org.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await org.approveApplyUnit('reviewer',candidate);
 exec("DELETE FROM organization_master.access WHERE actor='reviewer' AND subject_id='00000000-0000-0000-0000-000000000000' AND permission='REVIEW';");
 try{await expect(org.applyUnit('maker',{candidateId:candidate.candidateId,requestId:(await org.readApplyCandidate('maker',{candidateId:candidate.candidateId})).unit.input.requestId})).rejects.toThrow('ACCESS_DENIED');}finally{exec("INSERT INTO organization_master.access VALUES('reviewer','00000000-0000-0000-0000-000000000000','NORTH','REVIEW');");}
 const a=await apply(create()),c=create();if(c.action!=='CREATE')throw new Error();
 await expect(org.stage('maker',{...input({...c,action:'REVISE',target:target(a)}),campus:'SOUTH'})).rejects.toThrow('ACCESS_DENIED');
 const w=await org.stage('maker',input(create()));await org.withdraw('maker',{inputId:w.inputId,requestId:randomUUID()});await expect(org.plan('maker',{inputId:w.inputId,requestId:randomUUID()})).rejects.toThrow('STALE_VALIDATION');
});
test('concurrent replay and lost response recover unchanged facts with current READ and no keys',async()=>{
 const value=input(create());expect(await org.stage('maker',value)).toEqual(await org.stage('maker',value));
 await expect(org.stage('maker',{...value,command:{...value.command,source:{...value.command.source,alias:'DEMO_CHANGED'}}})).rejects.toThrow('REQUEST_CONFLICT');
 const request=await prepare(create());const first=await org.applyUnit('maker',request,async()=>{throw new Error('DEMO_LOST_ACK');});expect(first).toMatchObject({status:'COMMITTED',responseStatus:'POST_COMMIT_FAILED'});
 const [a,b]=await Promise.all([org.applyUnit('maker',request),org.applyUnit('maker-alias',request)]);expect(a).toEqual(b);if(a.status!=='COMMITTED')throw new Error();expect(await org.history('maker',a.facts[0]!.id)).toMatchObject({head:'1'});
 const noKey=openCampus(connection);try{expect(await noKey.resumeOutcome('maker',request)).toMatchObject({facts:a.facts});}finally{await noKey.close();}
 exec(`DELETE FROM organization_master.access WHERE actor='maker' AND subject_id=${quote(a.facts[0]!.id)}::uuid AND permission='READ';`);
 await expect(org.resumeOutcome('maker',request)).rejects.toThrow('ACCESS_DENIED');
});
test('competing code claims and stale heads cannot both commit',async()=>{
 const c=create(),a=await prepare(c),b=await prepare({...c,source:{...c.source,alias:'DEMO_SECOND'}});
 const other=openCampus(connection,provider);try{const outcomes=await Promise.allSettled([org.applyUnit('maker',a),other.applyUnit('maker',b)]);expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);}finally{await other.close();}
 const subject=await apply(create()),fresh=create();if(fresh.action!=='CREATE')throw new Error();
 const revise={...fresh,action:'REVISE' as const,target:target(subject)};const pending=await prepare(revise);await apply(revise);await expect(org.applyUnit('maker',pending)).rejects.toThrow('STALE_VALIDATION');
});
test('write/audit failure rolls back campus, versions, claims and outcome; direct DML is denied',async()=>{
 const request=await prepare(create());const counts=()=>exec("SELECT jsonb_build_array((SELECT count(*) FROM organization_master.campus),(SELECT count(*) FROM organization_master.campus_event),(SELECT count(*) FROM organization_master.campus_code),(SELECT count(*) FROM governance_catalog.apply_commit),(SELECT count(*) FROM vnext_control.outcome));");const before=counts();
 exec("CREATE FUNCTION organization_master.test_campus_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='OWNER_APPLY_COMMIT' THEN RAISE EXCEPTION 'DEMO_AUDIT_FAILURE';END IF;RETURN NEW;END $$; CREATE TRIGGER campus_fail_audit BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION organization_master.test_campus_audit();");
 try{await expect(org.applyUnit('maker',request)).rejects.toThrow();expect(counts()).toBe(before);}finally{exec('DROP TRIGGER campus_fail_audit ON vnext_control.audit;DROP FUNCTION organization_master.test_campus_audit();');}
 const pool=new Pool({connectionString:connection});try{await expect(pool.query("INSERT INTO organization_master.campus(scope) VALUES('NORTH')")).rejects.toMatchObject({code:'42501'});}finally{await pool.end();}
});
test('bad division, future actual date and active address removal are blocked; moves retain operation',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();c.facts.adminDivision=adopted.reference;c.facts.campusAddress='DEMO_ADDRESS';
 await expect(prepare({...c,facts:{...c.facts,adminDivision:{...adopted.reference,code:'UNKNOWN'}}})).rejects.toThrow('BLOCKED_DEPENDENCY');
 await expect(prepare({...c,facts:{...c.facts,openingDate:'2999-01-01'}})).rejects.toThrow('CLOSED_INPUT_REQUIRED');
 const a=await apply(c),b=await apply({...common,action:'ACTIVATE',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'RUNNING',state:'RUNNING'});
 await expect(prepare({...c,action:'REVISE',target:target(b),sourceOperationStatus:'RUNNING',facts:{...c.facts,campusAddress:null}})).rejects.toThrow('BLOCKED_DEPENDENCY');
 const moved=await apply({...c,action:'REVISE',target:target(b),sourceOperationStatus:'RUNNING',facts:{...c.facts,campusAddress:'DEMO_NEW_ADDRESS',publicPhone:'DEMO_PUBLIC_PHONE'}});
 expect(await org.read('maker',{id:moved.id})).toMatchObject({operationStatus:'RUNNING',facts:{campusAddress:'DEMO_NEW_ADDRESS',publicPhone:'DEMO_PUBLIC_PHONE'}});
 expect((await org.diff('maker',{id:a.id,fromVersion:'1',toVersion:moved.version})).changes.map(c=>c.field).sort()).toEqual(['campusAddress','publicPhone']);
});
test('FULL and unsupported dependencies never downgrade; source approval is mandatory for contraction',async()=>{
 const c=create();for(const extra of [{profile:'FULL' as const},{dependencies:[{kind:'LOCATION' as const,id:randomUUID()}]}]){const i=await org.stage('maker',{...input(c),...extra});await expect(org.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('BLOCKED_DEPENDENCY');}
 const a=await apply(c);for(const source of [{...common.source,recordStatus:'DRAFT' as const},{...common.source,approvalRef:null}])await expect(prepare({...common,source,action:'SUSPEND',target:target(a),evidence:randomUUID(),sourceOperationStatus:'SUSPENDED',reason:'DEMO_STOP'})).rejects.toThrow();
});

test('shared protected input storage enforces domain isolation in both directions',async()=>{
 const legacy=openOrganization(connection,provider);try{
 const prior=await legacy.stage('maker',{...input(create()),command:{...common,action:'CREATE',facts:{legalName:'DEMO_ORG',entityNature:'DEMO',authority:null,legalAddress:null,registrationEvidence:artifact.artifactId},identifiers:[]}});
 await expect(org.withdraw('maker',{inputId:prior.inputId,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');
 await expect(org.plan('maker',{inputId:prior.inputId,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');
 const i=await org.stage('maker',input(create()));await expect(legacy.withdraw('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');
 const request=await prepare(create());await org.applyUnit('maker',request);await expect(legacy.resumeOutcome('maker',request)).rejects.toThrow('ACCESS_DENIED');
 await expect(legacy.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');
 }finally{await legacy.close();}
});

test('source +08:00 precision is preserved as evidence while invalid calendar input is rejected',async()=>{
 const c=create();c.source.recordedAt='2026-01-01T12:34:56.123456+08:00';const i=await org.stage('maker',input(c));
 expect((await org.readRestrictedInput('maker',i.inputId)).command.source.recordedAt).toBe(c.source.recordedAt);
 await expect(org.stage('maker',input({...c,validFrom:'2026-02-30T00:00:00'}))).rejects.toThrow();
 const value=await apply(c);expect(value.version).toBe('1');
});
test('exact division references and full profile coverage reject wrong versions and business gaps',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();c.facts.adminDivision=adopted.reference;c.facts.campusAddress='DEMO';
 for(const bad of [{...adopted.reference,contractVersionId:randomUUID()},{...adopted.reference,sourceVersionId:randomUUID()},{...adopted.reference,version:'UNKNOWN'}])await expect(prepare({...c,facts:{...c.facts,adminDivision:bad}})).rejects.toThrow();
 const a=await apply({...c,validTo:'2026-06-01T00:00:00'});
 await expect(prepare({...common,action:'ACTIVATE',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'RUNNING',state:'RUNNING',validTo:'2027-01-01T00:00:00'})).rejects.toThrow('BLOCKED_DEPENDENCY');
});

test('version diff reports business-period changes even when descriptive facts are unchanged',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();const a=await apply(c),b=await apply({...c,action:'REVISE',target:target(a),validFrom:'2026-02-01T00:00:00',validTo:'2027-01-01T00:00:00'});
 expect((await org.diff('maker',{id:a.id,fromVersion:a.version,toVersion:b.version})).changes).toEqual([{field:'validFrom',before:'2026-01-01T00:00:00.000000',after:'2026-02-01T00:00:00.000000'},{field:'validTo',before:null,after:'2027-01-01T00:00:00.000000'}]);
});

test.each([{rules:['SRC-COND-005']},{rules:['SRC-COND-006']},{rules:[]}])('manual CORE cannot publish an incomplete owner-condition set: $rules',async({rules})=>{
 try{await expect(campusCodeSet(catalog,source.versionId,rules)).rejects.toThrow('FINITE_RULE_REQUIRED');}finally{adopted=await campusCodeSet(catalog,source.versionId);}
});

test('an approved campus change is blocked after exact code-set retirement; contraction remains possible',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();c.facts.campusAddress='DEMO';c.facts.adminDivision=adopted.reference;
 const a=await apply(c),pending=await prepare({...c,action:'REVISE',target:target(a),facts:{...c.facts,campusName:'DEMO_PENDING'}});
 const latest=(await catalog.contractRead('reviewer',{scope:'SYNTHETIC',mode:'CURRENT',target:adopted.published.id}))[0]!;
 const impact=await catalog.contractImpact('reviewer','SYNTHETIC',latest.id,'RETIRE');
 await catalog.contractCommand('reviewer',{...f.cmd('RETIRE'),target:latest.id,expectedHead:latest.head,reviewDigest:latest.reviewDigest,impactDigest:impact.impactDigest});
 await expect(org.applyUnit('maker',pending)).rejects.toThrow('BLOCKED_DEPENDENCY');
 const stop=await apply({...common,action:'SUSPEND',target:target(a),evidence:randomUUID(),sourceOperationStatus:'SUSPENDED',reason:'DEMO_STOP'});
 expect(await org.read('maker',{id:stop.id})).toMatchObject({operationStatus:'SUSPENDED'});
});

test('historical lists exclude not-yet-known campus identities before output pagination',async()=>{
 const first=await apply(create()),cutoff=(await org.history('maker',first.id)).versions[0]!.recordedAt;
 const later=await apply(create());
 expect(await org.list('maker',{asOf:'2025-01-01T00:00:00',limit:1})).toEqual([]);
 expect(await org.list('maker',{after:first.id,asOf:cutoff,limit:1})).toEqual([]);
 expect((await org.list('maker',{after:first.id,limit:1})).map(v=>v.id)).toEqual([later.id]);
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,{owner:org,actor:r=>actor(r.headers)});await app.listen({host:'127.0.0.1',port:0});
 try{const address=app.server.address();if(!address||typeof address==='string')throw new Error();const client=createCampusClient(`http://127.0.0.1:${address.port}`,'maker');const result=await client.list({after:first.id,asOf:cutoff,limit:1});expect(result.response.status).toBe(200);expect(result.data).toEqual([]);}finally{await app.close();}
});

test('cleanup CLI accepts Windows uppercase receipt extension and actually disposes its owned database',()=>{
 const owned=createTemporary('P1-02');const marker=owned.receiptPath.replace(/\.json$/u,'.disposed.json');
 try{
  const run=spawnSync(process.execPath,['tooling/vnext/p1-02-cleanup.mjs',owned.receiptPath.replace(/\.json$/u,'.JSON')],{cwd:process.cwd(),env:process.env,encoding:'utf8',windowsHide:true});
  expect(run.status,run.stderr).toBe(0);
  expect(peer('postgres',`SELECT count(*) FROM pg_database WHERE datname=${quote(owned.receipt.name)};`)).toBe('0');
  expect(JSON.parse(readFileSync(marker,'utf8'))).toMatchObject({name:owned.receipt.name,oid:owned.receipt.oid,disposed:true});
  const replay=spawnSync(process.execPath,['tooling/vnext/p1-02-cleanup.mjs',owned.receiptPath],{cwd:process.cwd(),env:process.env,encoding:'utf8',windowsHide:true});expect(replay.status,replay.stderr).toBe(0);
 }finally{if(!existsSync(marker))dropTemporary(owned.receipt);}
});

test('cleanup rejects a mismatched disposal receipt without claiming success or deleting a database',()=>{
 const owned=createTemporary('P1-02'),marker=owned.receiptPath.replace(/\.json$/u,'.disposed.json');
 try{
  writeFileSync(marker,JSON.stringify({name:owned.receipt.name,oid:'0',disposed:true}),{flag:'wx'});
  const result=spawnSync(process.execPath,['tooling/vnext/p1-02-cleanup.mjs',owned.receiptPath],{cwd:process.cwd(),env:process.env,encoding:'utf8',windowsHide:true});
  expect(result.status).not.toBe(0);expect(result.stdout).not.toContain('OWNED_TEMPORARY_CLEANED');
  expect(peer('postgres',`SELECT count(*) FROM pg_database WHERE datname=${quote(owned.receipt.name)};`)).toBe('1');
 }finally{if(existsSync(marker))unlinkSync(marker);dropTemporary(owned.receipt);}
});

test.each(['write','plan_input','withdraw'] as const)('legacy SQL %s rejects an ORG02 input before mutation',async(action)=>{
 const staged=await org.stage('maker',input(create()));const pool=new Pool({connectionString:connection}),client=await pool.connect();
 try{await client.query('BEGIN');
  const command={...common,action:'CREATE',facts:{legalName:'DEMO_FORGED_ORG',entityNature:'DEMO',authority:null,legalAddress:null,registrationEvidence:artifact.artifactId},identifiers:[]};
  const query=action==='write'?client.query('SELECT organization_master.write($1,$2::uuid,$3::jsonb,$4::jsonb)',['maker',staged.inputId,JSON.stringify(command),'[]']):client.query(`SELECT organization_master.${action}($1,$2::uuid,$3::uuid)`,['maker',staged.inputId,randomUUID()]);
  await expect(query).rejects.toThrow('ACCESS_DENIED');
 }finally{await client.query('ROLLBACK');client.release();await pool.end();}
});


test.each(['REVISE','SCHEDULE_OPENING','CANCEL_OPENING'] as const)('operation gaps cannot be represented as PLANNING by %s',async(action)=>{
 const c=create();if(c.action!=='CREATE')throw new Error();const a=await apply({...c,validTo:'2026-06-01T00:00:00'});
 expect(await org.read('maker',{id:a.id,businessAt:'2026-07-01T00:00:00'})).toMatchObject({operationStatus:'NOT_ESTABLISHED'});
 const base={...common,target:target(a),validFrom:'2026-07-01T00:00:00',sourceOperationStatus:'PLANNING' as const,evidence:artifact.artifactId};
 const command:CampusCommand=action==='REVISE'?{...base,action,facts:c.facts}:action==='SCHEDULE_OPENING'?{...base,action,plannedOpeningAt:'2027-01-01T00:00:00'}:{...base,action,reason:'DEMO_CANCEL'};
 await expect(prepare(command)).rejects.toThrow('BLOCKED_DEPENDENCY');
});

test('suspension stays visible after descriptive facts expire, including HTTP and old R',async()=>{
 const a=await apply({...create(),validTo:'2026-06-01T00:00:00'}),old=(await org.history('maker',a.id)).operations[0]!.recordedAt;
 await apply({...common,action:'SUSPEND',target:target(a),validFrom:'2026-07-01T00:00:00',sourceOperationStatus:'SUSPENDED',evidence:randomUUID(),reason:'DEMO_CLOSE_EXPIRED_PROFILE'});
 expect(await org.read('maker',{id:a.id,businessAt:'2026-08-01T00:00:00'})).toMatchObject({facts:null,operationStatus:'SUSPENDED'});
 expect(await org.read('maker',{id:a.id,businessAt:'2026-08-01T00:00:00',asOf:old})).toMatchObject({facts:null,operationStatus:'NOT_ESTABLISHED'});
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,{owner:org,actor:r=>actor(r.headers)});await app.listen({host:'127.0.0.1',port:0});
 try{const address=app.server.address();if(!address||typeof address==='string')throw new Error();const client=createCampusClient(`http://127.0.0.1:${address.port}`,'maker');const result=await client.getCampusAsOf({id:a.id,businessAt:'2026-08-01T00:00:00'});expect(result.response.status).toBe(200);expect(result.data).toMatchObject({facts:null,operationStatus:'SUSPENDED'});}finally{await app.close();}
});

 test('service SQL cannot forge a campus write without the approved coordinator command',async()=>{
 const staged=await org.stage('maker',input(create())),pool=new Pool({connectionString:connection}),client=await pool.connect();
 try{await client.query('BEGIN');await expect(client.query('SELECT organization_master.campus_write($1,$2::uuid,$3::jsonb)',['maker',staged.inputId,JSON.stringify(create())])).rejects.toThrow('ACCESS_DENIED');}
 finally{await client.query('ROLLBACK');client.release();await pool.end();}
 });

test('service SQL rejects fabricated attestations and cannot read the coordinator authority',async()=>{
 const staged=await org.stage('maker',input(create())),requestId=randomUUID(),candidate=await org.plan('maker',{inputId:staged.inputId,requestId});
 await org.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await org.approveApplyUnit('reviewer',candidate);
 const pool=new Pool({connectionString:connection});
 try{
  await expect(pool.query('SELECT key_hex FROM vnext_control.campus_write_authority')).rejects.toThrow('permission denied');
  const ticket=JSON.stringify({actor:'maker',inputId:staged.inputId,candidateId:candidate.candidateId,digest:candidate.digest,command:create(),transaction:'0'});
  await expect(pool.query('SELECT organization_master.campus_write_approved($1,$2)',[ticket,'0'.repeat(64)])).rejects.toThrow('ACCESS_DENIED');
 }finally{await pool.end();}
});
test('SQL attestation cannot be changed or replayed in another transaction',async()=>{
 const staged=await org.stage('maker',input(create())),requestId=randomUUID(),candidate=await org.plan('maker',{inputId:staged.inputId,requestId});
 await org.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await org.approveApplyUnit('reviewer',candidate);
 const pool=new Pool({connectionString:connection}),client=await pool.connect();let ticket='',signature='';
 try{
  await client.query('BEGIN');const transaction=(await client.query('SELECT pg_current_xact_id()::text id')).rows[0].id;
  ticket=canonicalPlan({actor:'maker',inputId:staged.inputId,candidateId:candidate.candidateId,digest:candidate.digest,command:create(),transaction});
  signature=createHmac('sha256',Buffer.from(planBinding(provider,'CAMPUS_SQL_AUTHORITY_V1',{}),'hex')).update(ticket).digest('hex');
  for(const changed of [ticket.replace('"actor":"maker"','"actor":"maker-alias"'),ticket.replace('"sourceOperationStatus":"PLANNING"','"sourceOperationStatus":"RUNNING"')]){
   await client.query('SAVEPOINT tamper');
   await expect(client.query('SELECT organization_master.campus_write_approved($1,$2)',[changed,signature])).rejects.toThrow('ACCESS_DENIED');
   await client.query('ROLLBACK TO SAVEPOINT tamper');
  }
  await client.query('ROLLBACK');
  await expect(client.query('SELECT organization_master.campus_write_approved($1,$2)',[ticket,signature])).rejects.toThrow('ACCESS_DENIED');
 }finally{await client.query('ROLLBACK');client.release();await pool.end();}
});
