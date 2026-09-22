import {operatingHttpSmoke} from './operating-http-smoke.js';
import {prepare} from './operating-scenario.js';
import {peer,quote} from './lineage.mjs';
import {Pool} from 'pg';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {createOperatingRelationClient,createLicenseScopeClient} from '../../packages/generated-api-client/src/vnext-client.js';
import {randomUUID,createHmac} from 'node:crypto';
import {operatingScenario} from './operating-scenario.js';
import * as domain from '../../apps/governance-api/src/modules/organization-master/index.js';
import {test,expect,afterAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {openCatalog,LocalSyntheticKeyProvider,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {fixture} from './protected-fixture.js';
import {operatingCodeSet} from './operating-fixture.js';
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const catalog=await openCatalog(connection,provider);
const f=await fixture(catalog,{textField:true,ruleVersion:'ORG03_MANUAL_EVIDENCE_V1'});
const source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(v=>v.kind==='SOURCE'&&v.status==='PUBLISHED')!;
afterAll(async()=>{await catalog.close();});
test('ORG03 structured service contract explicitly adopts SRC-COND-007',async()=>{
 const cmd=<A extends string>(action:A,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'DEMO_RETIRED_TRANSPORT',...extra});
 let published=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.code==='ORG03'&&i.kind==='DATASET'&&i.status==='PUBLISHED');
 if(!published){const dataset=await catalog.command('maker',cmd('CREATE',{kind:'DATASET',code:'ORG03',values:{name:'DEMO ORG03'},validFrom:'2026-01-01T00:00:00'}));const submitted=await catalog.command('maker',cmd('SUBMIT',{target:dataset.id,expectedHead:dataset.head}));await catalog.command('reviewer',cmd('PUBLISH',{target:dataset.id,expectedHead:submitted.head,reviewDigest:submitted.reviewDigest}));published=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.id===dataset.id)!;}
 const legacy=await catalog.contractCommand('maker',cmd('CREATE',{datasetVersionId:published.versionId,profile:'CORE',validFrom:'2026-01-01T00:00:00',validTo:null,definition:{ruleVersion:'DEMO_OLD_JOB',templateVersion:'JOB_V1',sourceVersionId:source.versionId,businessKey:['legal_campus_rel_id'],fields:[{code:'legal_campus_rel_id',type:'id',required:'R',privacy:'INTERNAL',condition:'ALWAYS',enumValues:[]}],rules:[],references:[],codeSets:[]}}));
 const approved=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:legacy.id,expectedHead:legacy.head,reviewDigest:legacy.reviewDigest}));const released=await catalog.contractCommand('reviewer',cmd('PUBLISH',{target:legacy.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest}));const impact=await catalog.contractImpact('reviewer','SYNTHETIC',legacy.id,'RETIRE');await catalog.contractCommand('reviewer',cmd('RETIRE',{target:legacy.id,expectedHead:released.head,reviewDigest:released.reviewDigest,impactDigest:impact.impactDigest}));
 const adopted=await operatingCodeSet(catalog,source.versionId);expect(adopted.reference.codeSystem).toBe('SYNTHETIC_OPERATING_SERVICE');expect(adopted.reference.contractId).not.toBe(legacy.id);expect((await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(c=>c.id===legacy.id)?.status).toBe('RETIRED');
});

test('independent license scope verification is a governed Owner capability',async()=>{
 expect(domain).toHaveProperty('openOperatingRelations');
 const owner=domain.openOperatingRelations(connection,provider);
 try{await expect(owner.read('maker',{kind:'SCOPE',mode:'LIST',subjectId:'00000000-0000-0000-0000-000000000001',campusId:'00000000-0000-0000-0000-000000000002'})).rejects.toThrow();}
 finally{await owner.close();}
});

test('an independently approved scope pins the registered license, campus and service codes',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);
 try{const subject=await x.createSubject(),campus=await x.createCampus();x.grantPair(subject.id,campus.id);const license=await x.addLicense(subject);
 const fact=await x.operatingApply({...x.common,subject:{owner:'organization-master',id:subject.id},campus:{owner:'organization-master/campus',id:campus.id},evidence:x.artifact.artifactId,action:'VERIFY_SCOPE',facts:{license,catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO scope A'}});
 const rows=await x.operating.read('maker',{kind:'SCOPE',mode:'HISTORY',id:fact.id});expect(rows[0]).toMatchObject({version:'1',facts:{license,services:['DEMO_MEDICAL_A']},reviewer:'reviewer'});
 }finally{await x.close();}
});

test('an approved operating relation cannot substitute for independent campus activation',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);
 try{const subject=await x.createSubject(),node=await x.createCampus();x.grantPair(subject.id,node.id);const license=await x.addLicense(subject),scope=await x.verifyScope(subject,node,license);
 const relation=await x.operatingApply({...x.common,...x.endpoints(subject,node),evidence:x.artifact.artifactId,action:'ESTABLISH',facts:{role:'OPERATOR',relationTypeText:'DEMO operator',primary:'Y',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO medical A',scopeTargets:[scope]}});
 expect(relation.owner).toBe('organization-master/operating-relation');
 const result=await x.operating.evaluateOperatingWindow('maker',{...x.endpoints(subject,node),services:['DEMO_MEDICAL_A'],validFrom:'2026-01-01T00:00:00',validTo:null});
 expect(result.status).toBe('NOT_SATISFIED');expect(result.services[0]!.reasons).toContain('CAMPUS_NOT_RUNNING');
 }finally{await x.close();}
});


test('primary conflict retains its candidate; closing shrinks the window while old R remains reproducible',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);
 try{const subject=await x.createSubject(),node=await x.createCampus();x.grantPair(subject.id,node.id);await x.activateCampus(node);
 const license=await x.addLicense(subject),scope=await x.verifyScope(subject,node,license);
 const command={...x.common,...x.endpoints(subject,node),evidence:x.artifact.artifactId,action:'ESTABLISH' as const,facts:{role:'OPERATOR' as const,relationTypeText:'DEMO operator',primary:'Y' as const,catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO medical A',scopeTargets:[scope]}};
 const relation=await x.operatingApply(command),query={...x.endpoints(subject,node),services:['DEMO_MEDICAL_A'],validFrom:'2026-01-01T00:00:00',validTo:null};
 const before=await x.operating.evaluateOperatingWindow('maker',query);expect(before.status).toBe('SATISFIED');
 const input=await x.operating.stage('maker',x.operatingInput(command));const candidate=await x.operating.plan('maker',{inputId:input.inputId,requestId:randomUUID()});
 const review=await x.operating.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});expect(review.unit.basis['blockingIssues']).toContain('PRIMARY_OPERATOR_CONFLICT');
 await expect(x.operating.approveApplyUnit('reviewer',candidate)).rejects.toThrow('PRIMARY_OPERATOR_CONFLICT');
 await x.operatingApply({...x.common,...x.endpoints(subject,node),action:'CLOSE',target:{owner:'organization-master/operating-relation',id:relation.id,expectedVersion:relation.version},validFrom:'2026-06-01T00:00:00',evidence:null,reason:'DEMO end'});
 const now=await x.operating.evaluateOperatingWindow('maker',query);expect(now.status).toBe('NOT_SATISFIED');expect(now.services[0]!.gaps).toEqual([{from:'2026-06-01T00:00:00.000000',to:null}]);
 expect((await x.operating.evaluateOperatingWindow('maker',{...query,asOf:before.observedAt})).status).toBe('SATISFIED');
 }finally{await x.close();}
});


test('unsupported nonmedical operator remains a blocked reviewable candidate',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);
 try{const subject=await x.createSubject(),node=await x.createCampus();x.grantPair(subject.id,node.id);
 const input=await x.operating.stage('maker',x.operatingInput({...x.common,...x.endpoints(subject,node),evidence:x.artifact.artifactId,action:'ESTABLISH',facts:{role:'OPERATOR',relationTypeText:'DEMO nonmedical',primary:'N',catalog:x.codeSet.reference,services:['DEMO_NONMEDICAL'],licenseScopeText:'DEMO nonmedical',scopeTargets:[]}}));
 const candidate=await x.operating.plan('maker',{inputId:input.inputId,requestId:randomUUID()});
 const review=await x.operating.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});expect(review.unit.basis['blockingIssues']).toContain('UNSUPPORTED_SERVICE');await expect(x.operating.approveApplyUnit('reviewer',candidate)).rejects.toThrow('BLOCKED_DEPENDENCY');
 }finally{await x.close();}
});


test('different licenses can join exactly; a microsecond gap or missing second service cannot pass',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);
 try{const subject=await x.createSubject(),node=await x.createCampus();x.grantPair(subject.id,node.id);await x.activateCampus(node);
 const first=await x.addLicense(subject,'2026-01-01T00:00:00','2026-06-01T00:00:00'),second=await x.addLicense(subject,'2026-06-01T00:00:00',null);
 const a=await x.verifyScope(subject,node,first,['DEMO_MEDICAL_A'],'2026-01-01T00:00:00','2026-06-01T00:00:00'),b=await x.verifyScope(subject,node,second,['DEMO_MEDICAL_A'],'2026-06-01T00:00:00',null);
 const command={...x.common,...x.endpoints(subject,node),action:'ESTABLISH' as const,evidence:x.artifact.artifactId,facts:{role:'OPERATOR' as const,primary:'N' as const,relationTypeText:'DEMO operator',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO scope',scopeTargets:[a,b]}};
 await x.operatingApply(command);
 const query={...x.endpoints(subject,node),services:['DEMO_MEDICAL_A'],validFrom:'2026-01-01T00:00:00',validTo:null};
 const result=await x.operating.evaluateOperatingWindow('maker',query);expect(result.status).toBe('SATISFIED');expect(new Set(result.services[0]!.segments.map(s=>s.license.id)).size).toBe(2);
 await expect(x.operatingApply({...command,facts:{...command.facts,services:['DEMO_MEDICAL_A','DEMO_MEDICAL_B']}})).rejects.toThrow('LICENSE_PERIOD_NOT_COVERED');
 const late=await x.verifyScope(subject,node,second,['DEMO_MEDICAL_A'],'2026-06-01T00:00:00.000001',null);
 await expect(x.operatingApply({...command,facts:{...command.facts,scopeTargets:[a,late]}})).rejects.toThrow('LICENSE_PERIOD_NOT_COVERED');
 }finally{await x.close();}
});


test('real HTTP generated clients bind exact approval, restore outcome, and keep families isolated',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);const app=await buildCatalogServer(undefined,'CONTROL_PLANE',undefined,undefined,{owner:x.operating,actor:r=>actor(r.headers)});
 try{await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('HTTP_NOT_READY');const base='http://127.0.0.1:'+address.port;
 const maker=createOperatingRelationClient(base,'maker'),reviewer=createOperatingRelationClient(base,'reviewer'),scopes=createLicenseScopeClient(base,'maker');
 const subject=await x.createSubject(),node=await x.createCampus();x.grantPair(subject.id,node.id);
 const staged=await maker.stage(x.operatingInput({...x.common,...x.endpoints(subject,node),action:'ESTABLISH',evidence:x.artifact.artifactId,facts:{role:'REGISTRANT',relationTypeText:'DEMO registrant',primary:'N',services:[],scopeTargets:[],licenseScopeText:null,catalog:x.codeSet.reference}}));expect(staged.response.status).toBe(200);
 const requestId=randomUUID(),plan=await maker.plan({inputId:staged.data!.inputId,requestId});expect(plan.response.status).toBe(200);
 expect((await scopes.plan({inputId:staged.data!.inputId,requestId})).response.status).toBe(403);
 const candidate=plan.data!;expect((await reviewer.review({candidateId:candidate.candidateId})).response.status).toBe(200);expect((await reviewer.approve(candidate)).response.status).toBe(200);
 const applied=await maker.apply({candidateId:candidate.candidateId,requestId});expect(applied.response.status).toBe(200);expect(applied.data!.status).toBe('COMMITTED');
 expect((await maker.resume({candidateId:candidate.candidateId,requestId})).data?.facts).toEqual(applied.data!.facts);
 const detail=await maker.read({kind:'RELATION',mode:'HISTORY',id:applied.data!.facts![0]!.id});expect(detail.response.status).toBe(200);expect(detail.data![0]!.facts).toMatchObject({role:'REGISTRANT'});expect(JSON.stringify(detail.data)).not.toContain('DEMO_ORG03_ROW');
 }finally{await app.close();await x.close();}
});


test('catalogue change reports review required for all affected relations in one read transaction',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);
 try{const subject=await x.createSubject(),node=await x.createCampus();x.grantPair(subject.id,node.id);await x.activateCampus(node);
 const license=await x.addLicense(subject),scope=await x.verifyScope(subject,node,license),command={...x.common,...x.endpoints(subject,node),action:'ESTABLISH' as const,evidence:x.artifact.artifactId,facts:{role:'OPERATOR' as const,primary:'N' as const,relationTypeText:'DEMO operator',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO scope',scopeTargets:[scope]}};
 await x.operatingApply(command);await x.operatingApply(command);
 await operatingCodeSet(catalog,x.source.versionId);
 const result=await x.operating.evaluateOperatingWindow('maker',{...x.endpoints(subject,node),services:['DEMO_MEDICAL_A'],validFrom:'2026-01-01T00:00:00',validTo:null});expect(result.status).toBe('REVIEW_REQUIRED');expect(result.services[0]!.reasons).toContain('SERVICE_CATALOG_CHANGED');
 await x.operatingApply({...x.common,...x.endpoints(subject,node),action:'REVOKE_SCOPE',target:{owner:'organization-master/license-scope',id:scope.id,expectedVersion:scope.version},validFrom:'2026-05-01T00:00:00',evidence:null,reason:'DEMO contraction with retired catalogue'});
 }finally{await x.close();}
});


test('changed scope requires a new independent revalidation; unrelated license does not',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);
 try{const subject=await x.createSubject(),node=await x.createCampus();x.grantPair(subject.id,node.id);await x.activateCampus(node);
 const license=await x.addLicense(subject),scope=await x.verifyScope(subject,node,license),facts={role:'OPERATOR' as const,primary:'Y' as const,relationTypeText:'DEMO operator',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO scope',scopeTargets:[scope]};
 const relation=await x.operatingApply({...x.common,...x.endpoints(subject,node),action:'ESTABLISH',evidence:x.artifact.artifactId,facts});
 const query={...x.endpoints(subject,node),services:['DEMO_MEDICAL_A'],validFrom:'2026-01-01T00:00:00',validTo:null};
 await x.addLicense(subject);expect((await x.operating.evaluateOperatingWindow('maker',query)).status).toBe('SATISFIED');
 const revised=await x.operatingApply({...x.common,...x.endpoints(subject,node),action:'REVISE_SCOPE',target:{owner:'organization-master/license-scope',id:scope.id,expectedVersion:scope.version},evidence:x.artifact.artifactId,facts:{license,catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO updated verified evidence'}});
 expect((await x.operating.evaluateOperatingWindow('maker',query)).status).toBe('REVIEW_REQUIRED');
 const newVersion=(await x.operating.read('maker',{kind:'SCOPE',mode:'EXACT',id:scope.id,version:revised.version}))[0]!;
 await x.operatingApply({...x.common,...x.endpoints(subject,node),action:'REVALIDATE',target:{owner:'organization-master/operating-relation',id:relation.id,expectedVersion:relation.version},evidence:x.artifact.artifactId,facts:{...facts,scopeTargets:[{...scope,version:revised.version,versionId:newVersion.versionId}]}});
 expect((await x.operating.evaluateOperatingWindow('maker',query)).status).toBe('SATISFIED');
 }finally{await x.close();}
});

test('pair access is required even for empty reads, aliases cannot self-review, and approval revocation blocks apply',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);
 try{const subject=await x.createSubject(),node=await x.createCampus(),read={kind:'RELATION' as const,mode:'LIST' as const,subjectId:subject.id,campusId:node.id};
 await expect(x.operating.read('maker',read)).rejects.toThrow('ACCESS_DENIED');x.grantPair(subject.id,node.id);expect(await x.operating.read('maker',read)).toEqual([]);
 const input=await x.operating.stage('maker',x.operatingInput({...x.common,...x.endpoints(subject,node),action:'ESTABLISH',evidence:x.artifact.artifactId,facts:{role:'MANAGER',primary:'N',relationTypeText:'DEMO manager',catalog:x.codeSet.reference,services:[],licenseScopeText:null,scopeTargets:[]}}));
 const requestId=randomUUID(),candidate=await x.operating.plan('maker',{inputId:input.inputId,requestId});await x.operating.readApplyCandidate('maker-alias',{candidateId:candidate.candidateId});await expect(x.operating.approveApplyUnit('maker-alias',candidate)).rejects.toThrow('MAKER_CHECKER_REQUIRED');
 await x.operating.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await x.operating.approveApplyUnit('reviewer',candidate);
 peer(receipt.name,`DELETE FROM organization_master.operating_access WHERE actor='reviewer' AND subject_id=${quote(subject.id)}::uuid AND campus_id=${quote(node.id)}::uuid AND permission='REVIEW'`);
 await expect(x.operating.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).rejects.toThrow('ACCESS_DENIED');expect(await x.operating.read('maker',read)).toEqual([]);
 peer(receipt.name,`DELETE FROM organization_master.operating_access WHERE actor='maker' AND subject_id=${quote(subject.id)}::uuid AND campus_id=${quote(node.id)}::uuid AND permission='READ'`);
 await expect(x.operating.read('maker',read)).rejects.toThrow('ACCESS_DENIED');await expect(x.operating.readRestrictedInput('maker',input.inputId)).rejects.toThrow('ACCESS_DENIED');
 }finally{await x.close();}
});

test('application SQL cannot bypass ORG03 signature, table ownership, or legacy input-domain isolation',async()=>{
 const pool=new Pool({connectionString:connection});try{
 for(const table of ['operating_object','operating_version','operating_input','operating_access'])for(const operation of ['INSERT','UPDATE','DELETE']){
 const statement=operation==='INSERT'?`INSERT INTO organization_master.${table} DEFAULT VALUES`:operation==='UPDATE'?`UPDATE organization_master.${table} SET ${table==='operating_access'?'actor=actor':table==='operating_input'?'input_id=input_id':'id=id'} WHERE false`:`DELETE FROM organization_master.${table} WHERE false`;
 await expect(pool.query(statement)).rejects.toThrow(/permission denied/);
 }
 await expect(pool.query('SELECT key_hex FROM vnext_control.operating_write_authority')).rejects.toThrow(/permission denied/);
 await expect(pool.query('SELECT organization_master.operating_write($1,$2)',[JSON.stringify({domain:'ORG03_WRITE_V1',transaction:'0'}),'0'.repeat(64)])).rejects.toThrow('ACCESS_DENIED');
 const client=await pool.connect();try{await client.query('BEGIN');const tx=(await client.query('SELECT pg_current_xact_id()::text id')).rows[0].id;
 const ticket=JSON.stringify({domain:'ORG03_WRITE_V1',actor:'maker',transaction:tx,command:{action:'ESTABLISH'}}),key=Buffer.from(planBinding(provider,'OPERATING_SQL_AUTHORITY_V1',{}),'hex');let signature:string;try{signature=createHmac('sha256',key).update(ticket).digest('hex');}finally{key.fill(0);}
 await expect(client.query('SELECT organization_master.operating_write($1,$2)',[ticket.replace('ESTABLISH','CLOSE'),signature])).rejects.toThrow('ACCESS_DENIED');await client.query('ROLLBACK');
 await expect(client.query('SELECT organization_master.operating_write($1,$2)',[ticket,signature])).rejects.toThrow('ACCESS_DENIED');
 }finally{await client.query('ROLLBACK');client.release();}
 await expect(pool.query('SELECT organization_master.stage($1,$2,$3,$4)',['maker',{domain:'ORG03'},'0'.repeat(64),{}])).rejects.toThrow('ACCESS_DENIED');
 }finally{await pool.end();}
});


test('two connections cannot win the same primary interval; replay and stale head remain safe',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog),other=domain.openOperatingRelations(connection,provider);
 try{const subject=await x.createSubject(),node=await x.createCampus();x.grantPair(subject.id,node.id);const license=await x.addLicense(subject),scope=await x.verifyScope(subject,node,license);
 const command={...x.common,...x.endpoints(subject,node),action:'ESTABLISH' as const,evidence:x.artifact.artifactId,facts:{role:'OPERATOR' as const,primary:'Y' as const,relationTypeText:'DEMO operator',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO scope',scopeTargets:[scope]}};
 const a=await prepare(x.operating,x.operatingInput(command)),b=await prepare(x.operating,x.operatingInput(command));
 const race=await Promise.allSettled([x.operating.applyUnit('maker',a),other.applyUnit('maker',b)]);expect(race.filter(v=>v.status==='fulfilled')).toHaveLength(1);
 const winner=race[0]!.status==='fulfilled'?a:b;const replay=await Promise.all([x.operating.applyUnit('maker',winner),other.applyUnit('maker-alias',winner)]);expect(replay[0]).toEqual(replay[1]);
 const id=(await x.operating.read('maker',{kind:'RELATION',mode:'LIST',subjectId:subject.id,campusId:node.id}))[0]!.id;
 const revise={...command,action:'REVISE_RELATION' as const,target:{owner:'organization-master/operating-relation' as const,id,expectedVersion:'1'}};
 const stale=await prepare(x.operating,x.operatingInput(revise));await x.operatingApply(revise);await expect(x.operating.applyUnit('maker',stale)).rejects.toThrow('STALE_VALIDATION');
 const staged=x.operatingInput({...command,facts:{...command.facts,primary:'N'}});expect(await x.operating.stage('maker',staged)).toEqual(await x.operating.stage('maker',staged));await expect(x.operating.stage('maker',{...staged,command:{...staged.command,source:{...staged.command.source,alias:'DEMO other payload'}}})).rejects.toThrow('REQUEST_CONFLICT');
 const nonprimary=await prepare(x.operating,staged),lost=await x.operating.applyUnit('maker',nonprimary,async()=>{throw new Error('DEMO_LOST_ACK');});expect(lost).toMatchObject({status:'COMMITTED',responseStatus:'POST_COMMIT_FAILED'});
 const noKey=domain.openOperatingRelations(connection);try{expect(await noKey.resumeOutcome('maker',nonprimary)).toMatchObject({status:'COMMITTED'});}finally{await noKey.close();}
 }finally{await other.close();await x.close();}
});

test('an audit failure rolls back every domain fact and success outcome in the root transaction',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);
 try{const subject=await x.createSubject(),node=await x.createCampus();x.grantPair(subject.id,node.id);
 const request=await prepare(x.operating,x.operatingInput({...x.common,...x.endpoints(subject,node),action:'ESTABLISH',evidence:x.artifact.artifactId,facts:{role:'BILLING',primary:'N',relationTypeText:'DEMO billing declaration',catalog:x.codeSet.reference,services:[],scopeTargets:[],licenseScopeText:null}}));
 const counts=()=>peer(receipt.name,'SELECT jsonb_build_array((SELECT count(*) FROM organization_master.operating_object),(SELECT count(*) FROM organization_master.operating_version),(SELECT count(*) FROM governance_catalog.apply_commit),(SELECT count(*) FROM vnext_control.outcome),(SELECT count(*) FROM vnext_control.audit))');const before=counts();
 peer(receipt.name,"CREATE FUNCTION organization_master.test_operating_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='OWNER_APPLY_COMMIT' THEN RAISE EXCEPTION 'DEMO_AUDIT_FAILURE';END IF;RETURN NEW;END $$;CREATE TRIGGER operating_fail_audit BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION organization_master.test_operating_audit();");
 try{await expect(x.operating.applyUnit('maker',request)).rejects.toThrow();expect(counts()).toBe(before);}finally{peer(receipt.name,'DROP TRIGGER operating_fail_audit ON vnext_control.audit;DROP FUNCTION organization_master.test_operating_audit();');}
 expect(await x.operating.resumeOutcome('maker',request)).toBeNull();expect(await x.operating.read('maker',{kind:'RELATION',mode:'LIST',subjectId:subject.id,campusId:node.id})).toEqual([]);
 }finally{await x.close();}
});


test('a local primary correction releases only its declared interval and closure is terminal',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);
 try{const subject=await x.createSubject(),node=await x.createCampus();x.grantPair(subject.id,node.id);const license=await x.addLicense(subject),scope=await x.verifyScope(subject,node,license),command={...x.common,...x.endpoints(subject,node),action:'ESTABLISH' as const,evidence:x.artifact.artifactId,facts:{role:'OPERATOR' as const,primary:'Y' as const,relationTypeText:'DEMO operator',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO scope',scopeTargets:[scope]}};
 const first=await x.operatingApply(command),target={owner:'organization-master/operating-relation' as const,id:first.id,expectedVersion:'1'};
 await x.operatingApply({...command,action:'REVISE_RELATION',target,validFrom:'2026-06-01T00:00:00',validTo:'2026-09-01T00:00:00',facts:{...command.facts,primary:'N'}});
 await x.operatingApply({...command,validFrom:'2026-06-01T00:00:00',validTo:'2026-09-01T00:00:00'});
 await expect(x.operatingApply({...command,validFrom:'2026-09-01T00:00:00'})).rejects.toThrow('PRIMARY_OPERATOR_CONFLICT');
 const close={...x.common,...x.endpoints(subject,node),action:'CLOSE' as const,target:{...target,expectedVersion:'2'},validFrom:'2026-09-01T00:00:00',evidence:null,reason:'DEMO terminal'};
 await expect(x.operatingApply({...close,source:{...close.source,approvalRef:null}})).rejects.toThrow('APPROVAL_REQUIRED');await x.operatingApply(close);
 await expect(x.operatingApply({...command,action:'REVISE_RELATION',target:{...target,expectedVersion:'3'}})).rejects.toThrow('OPERATING_CLOSED');
 await x.operatingApply({...command,validFrom:'2026-09-01T00:00:00'});
 }finally{await x.close();}
});


test('three named physical campuses reference one subject through the complete HTTP lifecycle',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);try{const result=await operatingHttpSmoke(x);expect(result.campusIds).toHaveLength(3);expect(new Set(result.campusIds).size).toBe(3);expect(result.closeAndHistoricalR).toBe(true);}finally{await x.close();}
},60000);


test('scope evidence cannot cross subject, campus, license version or service membership',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);
 try{const subject=await x.createSubject(),other=await x.createSubject(),node=await x.createCampus(),second=await x.createCampus();x.grantPair(subject.id,node.id);x.grantPair(subject.id,second.id);x.grantPair(other.id,node.id);
 const license=await x.addLicense(subject),scope=await x.verifyScope(subject,node,license);
 await expect(x.verifyScope(other,node,license)).rejects.toThrow('BLOCKED_DEPENDENCY');await expect(x.verifyScope(subject,node,{...license,versionId:randomUUID()})).rejects.toThrow('BLOCKED_DEPENDENCY');
 const command={...x.common,...x.endpoints(subject,second),action:'ESTABLISH' as const,evidence:x.artifact.artifactId,facts:{role:'OPERATOR' as const,primary:'N' as const,relationTypeText:'DEMO operator',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO scope',scopeTargets:[scope]}};
 await expect(x.operatingApply(command)).rejects.toThrow('BLOCKED_DEPENDENCY');
 for(const extra of [{profile:'FULL' as const},{dependencies:[{kind:'LOCATION',id:randomUUID()}]}]){const input=await x.operating.stage('maker',{...x.operatingInput(command),...extra});await expect(x.operating.plan('maker',{inputId:input.inputId,requestId:randomUUID()})).rejects.toThrow('BLOCKED_DEPENDENCY');}
 const badCatalog={...x.codeSet.reference,version:'UNADOPTED'};await expect(x.operatingApply({...command,...x.endpoints(subject,node),facts:{...command.facts,catalog:badCatalog}})).rejects.toThrow('BLOCKED_DEPENDENCY');
 const closed=await x.operating.stage('maker',x.operatingInput({...command,...x.endpoints(subject,node),facts:{...command.facts,role:'OTHER',services:[],scopeTargets:[],licenseScopeText:null}}));const candidate=await x.operating.plan('maker',{inputId:closed.inputId,requestId:randomUUID()});expect((await x.operating.readApplyCandidate('reviewer',{candidateId:candidate.candidateId})).unit.basis['blockingIssues']).toContain('UNSUPPORTED_RELATION_ROLE');await expect(x.operating.approveApplyUnit('reviewer',candidate)).rejects.toThrow('BLOCKED_DEPENDENCY');
 await x.operating.withdraw('maker',{inputId:closed.inputId,requestId:randomUUID()});await expect(x.operating.plan('maker',{inputId:closed.inputId,requestId:randomUUID()})).rejects.toThrow();
 }finally{await x.close();}
});


test('cross-governance endpoints still require an explicit pair and each current endpoint permission',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);
 try{peer(receipt.name,"INSERT INTO organization_master.access SELECT a,'00000000-0000-0000-0000-000000000000'::uuid,'SOUTH',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','REVIEW','READ_RESTRICTED']) p ON CONFLICT DO NOTHING");
 const subject=await x.createSubject(),node=await x.createCampus('DEMO south','CITY_CENTER','SOUTH'),query={kind:'RELATION' as const,mode:'LIST' as const,subjectId:subject.id,campusId:node.id};
 await expect(x.operating.read('maker',query)).rejects.toThrow('ACCESS_DENIED');x.grantPair(subject.id,node.id);expect(await x.operating.read('maker',query)).toEqual([]);
 peer(receipt.name,`DELETE FROM organization_master.access WHERE actor='maker' AND subject_id=${quote(node.id)}::uuid AND permission='READ'`);await expect(x.operating.read('maker',query)).rejects.toThrow('ACCESS_DENIED');
 }finally{await x.close();}
});


test('a revoked relevant license requires review without releasing primary; valid close remains possible',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);
 try{const subject=await x.createSubject(),node=await x.createCampus();x.grantPair(subject.id,node.id);await x.activateCampus(node);const license=await x.addLicense(subject),scope=await x.verifyScope(subject,node,license);
 const facts={role:'OPERATOR' as const,primary:'Y' as const,relationTypeText:'DEMO operator',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO scope',scopeTargets:[scope]},command={...x.common,...x.endpoints(subject,node),action:'ESTABLISH' as const,evidence:x.artifact.artifactId,facts};
 const relation=await x.operatingApply(command),query={...x.endpoints(subject,node),services:['DEMO_MEDICAL_A'],validFrom:'2026-01-01T00:00:00',validTo:null};const before=await x.operating.evaluateOperatingWindow('maker',query);
 await x.orgApply({...x.common,action:'REVOKE_LICENSE',target:{id:subject.id,version:subject.version},licenseTarget:{id:license.id,version:license.version},reason:'DEMO_REVOKE'});
 expect((await x.operating.evaluateOperatingWindow('maker',query)).status).toBe('REVIEW_REQUIRED');expect((await x.operating.evaluateOperatingWindow('maker',{...query,asOf:before.observedAt})).status).toBe('SATISFIED');
 const replacement=await x.addLicense(subject),replacementScope=await x.verifyScope(subject,node,replacement);await expect(x.operatingApply({...command,facts:{...facts,scopeTargets:[replacementScope]}})).rejects.toThrow('PRIMARY_OPERATOR_CONFLICT');
 await x.operatingApply({...x.common,...x.endpoints(subject,node),action:'CLOSE',target:{owner:'organization-master/operating-relation',id:relation.id,expectedVersion:relation.version},evidence:null,reason:'DEMO closing revoked license'});
 }finally{await x.close();}
});


test('manual source business offsets are retained while canonical periods keep local microseconds',async()=>{
 const x=await operatingScenario(receipt,connection,provider,catalog);
 try{const subject=await x.createSubject(),node=await x.createCampus();x.grantPair(subject.id,node.id);
 const value=x.operatingInput({...x.common,...x.endpoints(subject,node),action:'ESTABLISH',evidence:x.artifact.artifactId,validFrom:'2026-01-01T00:00:00.123456+08:00',validTo:'2026-06-01T00:00:00+08:00',source:{...x.common.source,recordedAt:'2026-01-01T00:00:00.123456+08:00'},facts:{role:'REGISTRANT',primary:'N',relationTypeText:'DEMO registrant',catalog:x.codeSet.reference,services:[],scopeTargets:[],licenseScopeText:null}});
 const staged=await x.operating.stage('maker',value);expect((await x.operating.readRestrictedInput('maker',staged.inputId)).command.validFrom).toBe(value.command.validFrom);
 const pending=await prepare(x.operating,value),result=await x.operating.applyUnit('maker',pending);if(result.status!=='COMMITTED')throw new Error('NOT_COMMITTED');
 const exact=(await x.operating.read('maker',{kind:'RELATION',mode:'EXACT',id:result.facts[0]!.id,version:'1'}))[0]!;expect(exact.validFrom).toBe('2026-01-01T00:00:00.123456');expect(exact.validTo).toBe('2026-06-01T00:00:00.000000');
 }finally{await x.close();}
});
