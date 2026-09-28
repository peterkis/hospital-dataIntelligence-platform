import {operatingScenario,prepare as prepareOperating} from './operating-scenario.js';
import {provisionCampusAuthority} from './campus-authority.mjs';
import {createCampusClient} from '../../packages/generated-api-client/src/index.js';
import {campusCodeSet} from './campus-fixture.js';
import {test,expect,afterAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
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
const create=():CampusCommand=>({...structuredClone(common),action:'CREATE',evidence:artifact.artifactId,sourceOperationStatus:'PLANNING',facts:{campusCode:'DEMO_'+randomUUID(),campusName:'DEMO 本部',nodeRole:'HEADQUARTERS',nodeKind:'PHYSICAL',campusAddress:null,adminDivision:null,publicPhone:null,openingDate:null}});
const input=(command:CampusCommand)=>({requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,command});
async function prepare(command:CampusCommand){const i=await org.stage('maker',input(command));const requestId=randomUUID(),candidate=await org.plan('maker',{inputId:i.inputId,requestId});await org.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await org.approveApplyUnit('reviewer',candidate);return {candidateId:candidate.candidateId,requestId};}
async function apply(command:CampusCommand){const result=await org.applyUnit('maker',await prepare(command));expect(result.status).toBe('COMMITTED');if(result.status!=='COMMITTED')throw new Error('NOT_COMMITTED');return result.facts[0]!;}
const target=(f:{id:string;version:string})=>({owner:'organization-master/campus' as const,id:f.id,expectedVersion:f.version});
test('P1-07 AC01: approved RESUME restores the same campus after temporary suspension',async()=>{
 const adopted=await campusCodeSet(catalog,source.versionId);
 const c=create();if(c.action!=='CREATE')throw new Error();c.facts.campusAddress='DEMO_ADDRESS';c.facts.adminDivision=adopted.reference;
 const a=await apply(c);
 const b=await apply({...common,action:'SUSPEND',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'SUSPENDED',reason:'DEMO_STOP'});
 const resumed=await apply({...common,action:'RESUME',target:target(b),evidence:artifact.artifactId,sourceOperationStatus:'RUNNING',state:'RUNNING',validFrom:'2026-02-01T00:00:00'});
 expect(resumed.id).toBe(a.id);
 expect(await org.references.read('maker',{id:a.id,businessAt:'2026-03-01T00:00:00'})).toMatchObject({operationStatus:'RUNNING'});
 expect(await org.references.read('maker',{id:a.id,businessAt:'2026-01-15T00:00:00'})).toMatchObject({operationStatus:'SUSPENDED'});
});

test('P1-07 retirement preserves identity and unknown dependencies prevent disposition completion',async()=>{
 const a=await apply(create());
 const assessment=await org.assessCampusImpact('maker',{id:a.id,validFrom:common.validFrom,validTo:null});
 expect(assessment.unavailable).toEqual(['BUSINESS_UNIT','LOCATION','ASSIGNMENT','CONSUMPTION']);
 const retired=await apply({...common,action:'RETIRE',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'RETIRED',reason:'DEMO_EXIT',assessmentDigest:assessment.digest,plan:{responsibleOwner:'DEMO_OFFICE',dueAt:'2027-01-01T00:00:00',actions:'Owner分别关闭关系并核验在途'}});
 expect(retired.id).toBe(a.id);
 expect(await org.references.read('maker',{id:a.id})).toMatchObject({operationStatus:'RETIRED'});
 const fresh=await org.assessCampusImpact('maker',{id:a.id,validFrom:common.validFrom,validTo:null});
 await expect(prepare({...common,action:'COMPLETE_DISPOSITION',target:target(retired),evidence:artifact.artifactId,sourceOperationStatus:'RETIRED',reason:'DEMO_COMPLETE',assessmentDigest:fresh.digest})).rejects.toThrow('DISPOSITION_INCOMPLETE');
 await expect(prepare({...common,action:'RESUME',target:target(retired),evidence:artifact.artifactId,sourceOperationStatus:'RUNNING',state:'RUNNING'})).rejects.toThrow('CAMPUS_RETIRED');
 expect((await org.references.history('maker',a.id)).versions).toHaveLength(1);
});

const impact=(id:string)=>org.assessCampusImpact('maker',{id,validFrom:common.validFrom,validTo:null});
async function retireNode(){const a=await apply(create());return apply({...common,action:'RETIRE',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'RETIRED',reason:'DEMO_EXIT',assessmentDigest:(await impact(a.id)).digest,plan:{responsibleOwner:'DEMO_OFFICE',dueAt:'2027-01-01T00:00:00',actions:'分Owner人工核查'}});}

test('manual declarations remain NOT_EVALUABLE and complete only the explicitly reviewed synthetic disposition',async()=>{
 let a=await retireNode();const before=await org.references.history('maker',a.id);
 for(const owner of ['BUSINESS_UNIT','LOCATION','ASSIGNMENT','CONSUMPTION'] as const){
  a=await apply({...common,action:'RECORD_DISPOSITION',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'RETIRED',reason:'DEMO_MANUAL_VERIFIED',assessmentDigest:(await impact(a.id)).digest,resolution:{owner,status:'CLEAR',scope:'SYNTHETIC'}});
 }
 const pending=await prepare({...common,action:'COMPLETE_DISPOSITION',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'RETIRED',reason:'DEMO_COMPLETE',assessmentDigest:(await impact(a.id)).digest});
 const result=await org.applyUnit('maker',pending,async()=>{throw new Error('DEMO_ACK_LOST');});
 expect(result).toMatchObject({status:'COMMITTED',responseStatus:'POST_COMMIT_FAILED'});
 expect(await org.resumeOutcome('maker',pending)).toMatchObject({status:'COMMITTED',facts:result.status==='COMMITTED'?result.facts:[]});
 const report=await impact(a.id);expect(report.completed).toBe(true);expect(report.unavailable).toHaveLength(4);
 expect((await org.references.history('maker',a.id,before.operations.at(-1)!.recordedAt)).head).toBe('2');
});

test('an UNKNOWN consumption declaration supersedes an earlier CLEAR and blocks closure',async()=>{
 let a=await retireNode();
 for(const owner of ['BUSINESS_UNIT','LOCATION','ASSIGNMENT','CONSUMPTION','CONSUMPTION'] as const){
  const previous=await impact(a.id),status=owner==='CONSUMPTION'&&previous.dispositions.some(d=>d.owner===owner)?'UNKNOWN':'CLEAR';
  a=await apply({...common,action:'RECORD_DISPOSITION',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'RETIRED',reason:'DEMO_RECHECK',assessmentDigest:previous.digest,resolution:{owner,status,scope:'SYNTHETIC'}});
 }
 await expect(prepare({...common,action:'COMPLETE_DISPOSITION',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'RETIRED',reason:'DEMO_COMPLETE',assessmentDigest:(await impact(a.id)).digest})).rejects.toThrow('DISPOSITION_INCOMPLETE');
});

test('assessment cannot be transplanted or hide dependencies by changing the retirement window',async()=>{
 const a=await retireNode(),b=await apply(create());
 await expect(prepare({...common,action:'RETIRE',target:target(b),evidence:artifact.artifactId,sourceOperationStatus:'RETIRED',reason:'DEMO_EXIT',assessmentDigest:(await impact(a.id)).digest,plan:{responsibleOwner:'DEMO',dueAt:'2027-01-01T00:00:00',actions:'DEMO'}})).rejects.toThrow('STALE_VALIDATION');
 const later={id:a.id,validFrom:'2026-09-01T00:00:00',validTo:null};
 await expect(prepare({...common,validFrom:later.validFrom,action:'RECORD_DISPOSITION',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'RETIRED',reason:'DEMO_LATE',assessmentDigest:(await org.assessCampusImpact('maker',later)).digest,resolution:{owner:'CONSUMPTION',status:'CLEAR',scope:'SYNTHETIC'}})).rejects.toThrow('BLOCKED_DEPENDENCY');
 await expect(org.assessCampusImpact('outsider',{id:a.id,validFrom:common.validFrom,validTo:null})).rejects.toThrow('ACCESS_DENIED');
});

test('future retirement preserves B/R history and overrides old future activation',async()=>{
 const c=create();if(c.action!=='CREATE')throw new Error();c.facts.campusAddress='DEMO';c.facts.adminDivision=(await campusCodeSet(catalog,source.versionId)).reference;
 const a=await apply(c),b=await apply({...common,action:'ACTIVATE',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'RUNNING',state:'RUNNING',validFrom:'2028-01-01T00:00:00'});
 const history=await org.references.history('maker',a.id),from='2027-01-01T00:00:00.000001';
 const assessment=await org.assessCampusImpact('maker',{id:a.id,validFrom:from,validTo:null});
 await apply({...common,validFrom:from,action:'RETIRE',target:target(b),evidence:randomUUID(),sourceOperationStatus:'RETIRED',reason:'DEMO_EXIT',assessmentDigest:assessment.digest,plan:{responsibleOwner:'DEMO',dueAt:'2029-01-01T00:00:00',actions:'DEMO'}});
 expect(await org.references.read('maker',{id:a.id,businessAt:'2027-01-01T00:00:00'})).toMatchObject({operationStatus:'PLANNING'});
 expect(await org.references.read('maker',{id:a.id,businessAt:'2028-01-01T00:00:00'})).toMatchObject({operationStatus:'RETIRED'});
 expect(await org.references.read('maker',{id:a.id,businessAt:'2028-01-01T00:00:00',asOf:history.operations.at(-1)!.recordedAt})).toMatchObject({operationStatus:'RUNNING'});
});

test('retirement audit failure rolls back facts and outcome; competing lifecycle candidates become stale',async()=>{
 const a=await apply(create()),command:CampusCommand={...common,action:'RETIRE',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'RETIRED',reason:'DEMO_EXIT',assessmentDigest:(await impact(a.id)).digest,plan:{responsibleOwner:'DEMO',dueAt:'2027-01-01T00:00:00',actions:'DEMO'}};
 const request=await prepare(command),other=await prepare(command);
 exec("CREATE FUNCTION organization_master.p107_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='OWNER_APPLY_COMMIT' THEN RAISE EXCEPTION 'DEMO_AUDIT_FAILURE';END IF;RETURN NEW;END $$;CREATE TRIGGER p107_fail BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION organization_master.p107_fail_audit();");
 try{await expect(org.applyUnit('maker',request)).rejects.toThrow();expect(await org.references.read('maker',{id:a.id})).toMatchObject({head:'1',operationStatus:'PLANNING'});expect(await org.resumeOutcome('maker',request)).toBeNull();}finally{exec('DROP TRIGGER p107_fail ON vnext_control.audit;DROP FUNCTION organization_master.p107_fail_audit();');}
 await org.applyUnit('maker',request);await expect(org.applyUnit('maker',other)).rejects.toThrow();
});

test('existing operating dependencies remain history; stale candidate/new expansion blocked while closing survives invalid license',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);
 try{
 const subject=await x.createSubject(),node=await x.createCampus();x.grantPair(subject.id,node.id);
 const license=await x.addLicense(subject),scope=await x.verifyScope(subject,node,license);
 const relation=await x.operatingApply({...x.common,...x.endpoints(subject,node),action:'ESTABLISH',evidence:x.artifact.artifactId,facts:{role:'OPERATOR',relationTypeText:'DEMO',primary:'Y',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO',scopeTargets:[scope]}});
 const pending=await prepareOperating(x.operating,x.operatingInput({...x.common,...x.endpoints(subject,node),action:'ESTABLISH',evidence:x.artifact.artifactId,facts:{role:'MANAGER',relationTypeText:'DEMO',primary:'N',catalog:x.codeSet.reference,services:[],licenseScopeText:null,scopeTargets:[]}}));
 const before=await x.campus.assessCampusImpact('maker',{id:node.id,validFrom:common.validFrom,validTo:null});expect(before.dependencies.filter(d=>d.active)).toHaveLength(2);
 await x.campusApply({...x.common,action:'RETIRE',target:target(node),evidence:x.artifact.artifactId,sourceOperationStatus:'RETIRED',reason:'DEMO_EXIT',assessmentDigest:before.digest,plan:{responsibleOwner:'DEMO',dueAt:'2027-01-01T00:00:00',actions:'分别关闭'}});
 await expect(x.operating.applyUnit('maker',pending)).rejects.toThrow('CAMPUS_RETIRED');
 await x.orgApply({...x.common,action:'REVOKE_LICENSE',target:{id:subject.id,version:subject.version},licenseTarget:{id:license.id,version:license.version},reason:'DEMO_REVOKED'});
 await x.operatingApply({...x.common,...x.endpoints(subject,node),validFrom:'2026-02-01T00:00:00',action:'CLOSE',target:{owner:'organization-master/operating-relation',id:relation.id,expectedVersion:relation.version},evidence:null,reason:'DEMO_CLOSE'});
 await x.operatingApply({...x.common,...x.endpoints(subject,node),validFrom:'2026-02-01T00:00:00',action:'REVOKE_SCOPE',target:{owner:'organization-master/license-scope',id:scope.id,expectedVersion:scope.version},evidence:null,reason:'DEMO_CLOSE'});
 const after=await x.campus.assessCampusImpact('maker',{id:node.id,validFrom:common.validFrom,validTo:null});expect(after.dependencies).toHaveLength(2);expect(after.dependencies.every(d=>d.active&&d.outstanding===false)).toBe(true);
 expect((await x.operating.read('maker',{kind:'RELATION',id:relation.id,mode:'EXACT',version:'1'}))[0]?.facts).toMatchObject({role:'OPERATOR'});
 let current={id:node.id,version:(await x.campus.references.read('maker',{id:node.id})).head};
 for(const owner of ['BUSINESS_UNIT','LOCATION','ASSIGNMENT','CONSUMPTION'] as const){
  const report=await x.campus.assessCampusImpact('maker',{id:node.id,validFrom:common.validFrom,validTo:null});
  current=await x.campusApply({...x.common,action:'RECORD_DISPOSITION',target:target(current),sourceOperationStatus:'RETIRED',evidence:x.artifact.artifactId,reason:'DEMO_RECHECK',assessmentDigest:report.digest,resolution:{owner,status:'CLEAR',scope:'SYNTHETIC'}});
 }
 const complete=await x.campus.assessCampusImpact('maker',{id:node.id,validFrom:common.validFrom,validTo:null});
 await x.campusApply({...x.common,action:'COMPLETE_DISPOSITION',target:target(current),sourceOperationStatus:'RETIRED',evidence:x.artifact.artifactId,reason:'DEMO_DONE',assessmentDigest:complete.digest});
 expect((await x.campus.assessCampusImpact('maker',{id:node.id,validFrom:common.validFrom,validTo:null})).completed).toBe(true);

 }finally{await x.close();}
});

test('future retirement permits bounded pre-exit admission and blocks overlap',async()=>{
 const a=await apply(create()),from='2027-01-01T00:00:00';
 await apply({...common,validFrom:from,action:'RETIRE',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'RETIRED',reason:'DEMO',assessmentDigest:(await org.assessCampusImpact('maker',{id:a.id,validFrom:from,validTo:null})).digest,plan:{responsibleOwner:'DEMO',dueAt:'2028-01-01T00:00:00',actions:'DEMO'}});
 const pool=new Pool({connectionString:connection});try{await expect(pool.query('select organization_master.campus_admission($1,$2::uuid,$3::timestamp,$4::timestamp)',['maker',a.id,'2026-10-01','2026-11-01'])).resolves.toBeDefined();await expect(pool.query('select organization_master.campus_admission($1,$2::uuid,$3::timestamp,$4::timestamp)',['maker',a.id,'2026-10-01','2027-02-01'])).rejects.toThrow('CAMPUS_RETIRED');}finally{await pool.end();}
});

test('real HTTP serializes retirement/impact and current grants forbid unauthorized creation and replay',async()=>{
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,{owner:org,actor:r=>actor(r.headers)});await app.listen({host:'127.0.0.1',port:0});
 try{const address=app.server.address();if(!address||typeof address==='string')throw new Error();const base=`http://127.0.0.1:${address.port}`,client=createCampusClient(base,'maker');
 const retired=await retireNode();expect((await client.getCampusAsOf({id:retired.id})).data?.operationStatus).toBe('RETIRED');expect((await client.assessImpact({id:retired.id,validFrom:common.validFrom,validTo:null})).data?.unavailable).toHaveLength(4);
 expect((await createCampusClient(base,'outsider').assessImpact({id:retired.id,validFrom:common.validFrom,validTo:null})).response.status).toBe(403);
 const c=create();const inputValue=input(c);const staged=await org.stage('maker',inputValue);const candidate=await org.plan('maker',{inputId:staged.inputId,requestId:randomUUID()});
 await expect(org.approveApplyUnit('maker-alias',candidate)).rejects.toThrow();
 const legal=openOrganization(connection,provider);try{
  exec("DELETE FROM organization_master.access WHERE actor='maker' AND subject_id='00000000-0000-0000-0000-000000000000' AND permission='WRITE';");
  await expect(legal.stage('maker',{...inputValue,command:{...common,action:'CREATE',facts:{legalName:'DEMO_UNAPPROVED',entityNature:'DEMO',authority:null,legalAddress:null,registrationEvidence:artifact.artifactId},identifiers:[]}})).rejects.toThrow('ACCESS_DENIED');
 }finally{exec("INSERT INTO organization_master.access VALUES('maker','00000000-0000-0000-0000-000000000000','NORTH','WRITE');");await legal.close();}
 const pool=new Pool({connectionString:connection});try{await expect(pool.query("update organization_master.campus_event set lifecycle='{}'")).rejects.toMatchObject({code:'42501'});await expect(pool.query('select organization_master.campus_write_approved($1,$2)',['{}','00'])).rejects.toThrow('ACCESS_DENIED');}finally{await pool.end();}
 }finally{await app.close();}
});

test('non-expanding suspension before a scheduled exit cannot override permanent retirement',async()=>{
 const a=await apply(create()),from='2027-01-01T00:00:00';
 const retired=await apply({...common,validFrom:from,action:'RETIRE',target:target(a),evidence:artifact.artifactId,sourceOperationStatus:'RETIRED',reason:'DEMO',assessmentDigest:(await org.assessCampusImpact('maker',{id:a.id,validFrom:from,validTo:null})).digest,plan:{responsibleOwner:'DEMO',dueAt:'2028-01-01T00:00:00',actions:'DEMO'}});
 await apply({...common,validFrom:'2026-10-01T00:00:00',action:'SUSPEND',target:target(retired),sourceOperationStatus:'SUSPENDED',evidence:randomUUID(),reason:'DEMO_EARLY_STOP'});
 expect(await org.references.read('maker',{id:a.id,businessAt:'2026-11-01T00:00:00'})).toMatchObject({operationStatus:'SUSPENDED'});
 expect(await org.references.read('maker',{id:a.id,businessAt:'2027-02-01T00:00:00'})).toMatchObject({operationStatus:'RETIRED'});
});
