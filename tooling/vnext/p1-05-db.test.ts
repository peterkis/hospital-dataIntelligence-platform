import {organizationBundleFixture} from './organization-bundle-fixture.js';
import {organizationBundleHttpSmoke,rejectThirdRelationOverHttp} from './organization-bundle-http-smoke.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {readFileSync} from 'node:fs';
import {peer,quote} from './lineage.mjs';
import {organizationWorkbook} from './organization-workbook-fixture.js';
import * as organization from '../../apps/governance-api/src/modules/organization-master/index.js';
import {test,expect,afterAll} from 'vitest';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {fixture} from './protected-fixture.js';
import {organizationImportContracts} from './organization-import-contract-fixture.js';
const provider=new LocalSyntheticKeyProvider(),connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,catalog=await openCatalog(connection,provider);
const f=await fixture(catalog,{textField:true,ruleVersion:'ORG_BUNDLE_TRANSPORT_TEST'});
const source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='SOURCE'&&i.status==='PUBLISHED')!;
afterAll(()=>catalog.close());
test('independent organization file CORE contracts retain every original field',async()=>{
 const contracts=await organizationImportContracts(catalog,source.versionId);expect(contracts.map(c=>c.fields.length)).toEqual([19,17,15]);
});

test('organization workbook uses the existing file revision boundary',async()=>{
 expect(organization).toHaveProperty('openOrganizationImport');
 const owner=organization.openOrganizationImport(connection,provider);try{await expect(owner.readRevision('outsider',{jobId:'00000000-0000-0000-0000-000000000001',revisionId:'00000000-0000-0000-0000-000000000002'})).rejects.toThrow();}finally{await owner.close();}
});

test('file and typed manifest form one protected revision and exact request replay',async()=>{
 const bindings=await organizationImportContracts(catalog,source.versionId),receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
 const dataset=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='DATASET'&&i.code==='ORG01')!;
 peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
 const owner=organization.openOrganizationImport(connection,provider);try{
 const input={requestId:randomUUID(),job:{action:'CREATE' as const},campus:'NORTH' as const,retentionSeconds:3600,contracts:bindings.map(({dataset,contractId,contractVersionId})=>({dataset,contractId,contractVersionId})),manifest:{policy:'ORG_BUNDLE_V1' as const,rows:[{dataset:'ORG01' as const,row:2,intent:'CREATE' as const,governanceScope:'NORTH' as const,sourceVersionId:source.versionId}]}};
 const tables=Object.fromEntries(bindings.map(c=>[c.dataset,[c.fields.map(f=>f.code),...(c.dataset==='ORG01'?[c.fields.map(f=>f.code==='legal_entity_id'?'001':f.code==='legal_name'?'DEMO organization':'')]:[])]]));
 const bytes=organizationWorkbook(tables),first=await owner.receive('maker',input,bytes);expect(await owner.receive('maker',input,bytes)).toEqual(first);
 expect((await owner.readRevision('maker',{jobId:first.jobId,revisionId:first.revisionId})).manifest).toEqual(input.manifest);
 const parsed=await owner.inspectWorkbook('maker',{jobId:first.jobId,revisionId:first.revisionId});expect(parsed.structuralStatus).toBe('PARSED');expect(parsed.sheets.ORG01.rows[0]!['legal_entity_id']).toBe('001');
 await expect(owner.receive('maker',{...input,manifest:{...input.manifest,rows:[{...input.manifest.rows[0]!,row:3}]}},bytes)).rejects.toThrow('REQUEST_CONFLICT');
 await expect(owner.readRevision('outsider',{jobId:first.jobId,revisionId:first.revisionId})).rejects.toThrow('ACCESS_DENIED');
 }finally{await owner.close();}
});

test('a reversed workbook expands into one dependency graph and requires independent legal review',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const received=await owner.receive('maker',f.input,f.workbook());const result=await owner.validate('maker',{requestId:randomUUID(),jobId:received.jobId,revisionId:received.revisionId});expect(result.commandCount).toBe(12);expect(result.issues).toContainEqual(expect.objectContaining({code:'LEGAL_REVIEW_REQUIRED'}));expect(result.decision).toBe('BLOCKED');}finally{await owner.close();await f.close();}
});

test('a platform reference cannot silently resolve a source alias and source limits remain enforced',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const relation=f.input.manifest.rows.find(r=>r.dataset==='ORG03')!;if(relation.dataset!=='ORG03')throw new Error();relation.subject={kind:'PLATFORM_REF',dataset:'ORG01',id:randomUUID(),expectedVersion:'1'};f.values['ORG01']![0]!['legal_name']='x'.repeat(161);
 const received=await owner.receive('maker',f.input,f.workbook()),result=await owner.validate('maker',{requestId:randomUUID(),jobId:received.jobId,revisionId:received.revisionId});expect(result.decision).toBe('FAIL');expect(result.issues).toContainEqual(expect.objectContaining({code:'SOURCE_REFERENCE_MISMATCH'}));expect(result.issues).toContainEqual(expect.objectContaining({field:'legal_name',code:'VALUE_TOO_LONG'}));
 }finally{await owner.close();await f.close();}
});

test('legal review requires exact pair preauthorization and a successful independent read',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const received=await owner.receive('maker',f.input,f.workbook()),ref={jobId:received.jobId,revisionId:received.revisionId};
 await expect(owner.readLegalReview('reviewer',ref)).rejects.toThrow('PAIR_PREAUTHORIZATION_REQUIRED');
 await owner.preauthorize('bundle-admin',{...ref,requestId:randomUUID(),grants:[2,3,4].flatMap(row=>['maker','maker-alias','reviewer'].map(actor=>({row,actor,permissions:['READ','CREATE','REVISE','REVIEW'] as const}))) });
 const read=await owner.readLegalReview('reviewer',ref);await expect(owner.verifyLegalReview('maker-alias',{...ref,requestId:randomUUID(),digest:read.digest})).rejects.toThrow();
 const verified=await owner.verifyLegalReview('reviewer',{...ref,requestId:randomUUID(),digest:read.digest});expect(verified.status).toBe('VERIFIED');
 }finally{await owner.close();await f.close();}
});

test('approved workbook commits all twelve dependent steps through one coordinator root',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const received=await owner.receive('maker',f.input,f.workbook()),ref={jobId:received.jobId,revisionId:received.revisionId};
 await owner.preauthorize('bundle-admin',{...ref,requestId:randomUUID(),grants:[2,3,4].flatMap(row=>['maker','maker-alias','reviewer'].map(actor=>({row,actor,permissions:['READ','CREATE','REVISE','REVIEW'] as const}))) });
 const legal=await owner.readLegalReview('reviewer',ref);await owner.verifyLegalReview('reviewer',{...ref,requestId:randomUUID(),digest:legal.digest});
 const requestId=randomUUID(),candidate=await owner.plan('maker',{...ref,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 const other=organization.openOrganizationImport(connection,provider);const concurrent=await Promise.all([owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId}),other.applyUnit('maker',{candidateId:candidate.candidateId,requestId})]).finally(()=>other.close());
 const applied=concurrent[0]!;expect(concurrent[1]).toMatchObject({status:'COMMITTED'});expect(applied.status).toBe('COMMITTED');if(applied.status!=='COMMITTED'||concurrent[1]!.status!=='COMMITTED')throw new Error();expect(concurrent[1]!.facts).toEqual(applied.facts);expect(applied.facts).toHaveLength(12);
 const subject=applied.facts.filter(f=>f.owner==='organization-master');expect(subject).toHaveLength(1);expect(applied.facts.filter(f=>f.owner==='organization-master/campus')).toHaveLength(3);
 for(const relation of applied.facts.filter(f=>f.owner==='organization-master/operating-relation'))expect((await f.x.operating.read('maker',{kind:'RELATION',mode:'EXACT',id:relation.id,version:relation.version}))[0]!.subject.id).toBe(subject[0]!.id);
 const replay=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(replay).toMatchObject({status:applied.status,facts:applied.facts,recordedAt:applied.recordedAt});
 const recovery=organization.openOrganizationImport(connection);try{expect(await recovery.resumeOutcome('maker',{candidateId:candidate.candidateId,requestId})).toMatchObject({status:applied.status,facts:applied.facts,recordedAt:applied.recordedAt});}finally{await recovery.close();}
 const repeated=await owner.receive('maker',{...f.input,requestId:randomUUID()},f.workbook());expect(repeated.jobId).not.toBe(received.jobId);
 const repeatRef={jobId:repeated.jobId,revisionId:repeated.revisionId};await owner.preauthorize('bundle-admin',{...repeatRef,requestId:randomUUID(),grants:[2,3,4].flatMap(row=>['maker','reviewer'].map(actor=>({row,actor,permissions:['READ','CREATE','REVIEW'] as const})))});
 await expect(owner.readLegalReview('reviewer',repeatRef)).rejects.toThrow('IDENTIFIER_CONFLICT');
 }finally{await owner.close();await f.close();}
});

test('failure in the third relation or final success audit rolls back all facts and converted grants',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const received=await owner.receive('maker',f.input,f.workbook()),ref={jobId:received.jobId,revisionId:received.revisionId};
 await owner.preauthorize('bundle-admin',{...ref,requestId:randomUUID(),grants:[2,3,4].flatMap(row=>['maker','reviewer'].map(actor=>({row,actor,permissions:['READ','CREATE','REVIEW'] as const})))});
 const legal=await owner.readLegalReview('reviewer',ref);await owner.verifyLegalReview('reviewer',{...ref,requestId:randomUUID(),digest:legal.digest});
 const validated=await owner.validate('maker',{...ref,requestId:randomUUID()});expect(validated.decision).toBe('PASS');expect(validated.run?.adapterReadiness).toBe('READY');
 const requestId=randomUUID(),candidate=await owner.plan('maker',{...ref,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 const counts=()=>peer(receipt.name,`SELECT jsonb_build_array((SELECT count(*) FROM organization_master.subject),(SELECT count(*) FROM organization_master.campus),(SELECT count(*) FROM organization_master.operating_object),(SELECT count(*) FROM organization_master.operating_version),(SELECT count(*) FROM organization_master.operating_access),(SELECT count(*) FROM organization_master.bundle_child),(SELECT count(*) FROM governance_catalog.apply_commit),(SELECT count(*) FROM vnext_control.outcome))`);
 const before=counts();
 peer(receipt.name,`CREATE FUNCTION organization_master.test_bundle_third() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM organization_master.bundle_child WHERE input_id=NEW.input_id AND step_key='ORG03/4/main') THEN RAISE EXCEPTION 'DEMO_THIRD_RELATION_FAILURE';END IF;RETURN NEW;END $$;CREATE TRIGGER bundle_fail_third BEFORE INSERT ON organization_master.operating_version FOR EACH ROW EXECUTE FUNCTION organization_master.test_bundle_third();`);
 try{await expect(owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).rejects.toThrow();expect(counts()).toBe(before);}finally{peer(receipt.name,'DROP TRIGGER bundle_fail_third ON organization_master.operating_version;DROP FUNCTION organization_master.test_bundle_third();');}
 peer(receipt.name,`CREATE FUNCTION organization_master.test_bundle_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='OWNER_APPLY_COMMIT' THEN RAISE EXCEPTION 'DEMO_AUDIT_FAILURE';END IF;RETURN NEW;END $$;CREATE TRIGGER bundle_fail_audit BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION organization_master.test_bundle_failure();`);
 try{await expect(owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).rejects.toThrow();expect(counts()).toBe(before);}finally{peer(receipt.name,'DROP TRIGGER bundle_fail_audit ON vnext_control.audit;DROP FUNCTION organization_master.test_bundle_failure();');}
 }finally{await owner.close();await f.close();}
});

test('bundle validation persists signed parser provenance and a normal quality-readable run',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const received=await owner.receive('maker',f.input,f.workbook()),ref={jobId:received.jobId,revisionId:received.revisionId};
 const result=await owner.validate('maker',{...ref,requestId:randomUUID()});expect(result).toHaveProperty('run.runId');
 const run=(result as unknown as {run:{runId:string}}).run;
 const explained=await catalog.explainIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',runId:run.runId});expect(explained.evaluation.decision).toBe('BLOCKED');expect(explained.parserPolicy).toBe('STRICT_ORG_BUNDLE_V1');
 }finally{await owner.close();await f.close();}
});

test('real HTTP organization upload fails closed without an Owner and rejects undeclared fields',async()=>{
 const app=await buildCatalogServer();try{await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error();
 const response=await fetch(`http://127.0.0.1:${address.port}/api/vnext/import/organization-bundles/revision`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId:randomUUID(),revisionId:randomUUID()})});expect(response.status).toBe(503);
 }finally{await app.close();}
});

test('generated clients upload, independently verify, approve, atomically apply and recover a real workbook over HTTP',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const alias=randomUUID();f.values['ORG01']![0]!['legal_entity_id']=alias;for(const raw of f.values['ORG03']!)raw['legal_entity_id']=alias;
 for(const row of f.input.manifest.rows)if(row.dataset==='ORG03'){row.subject={kind:'JOB_ALIAS',dataset:'ORG01',alias};for(const scope of row.scopes)if(scope.kind==='VERIFY_SCOPE'&&'kind' in scope.license)scope.license.subject={kind:'JOB_ALIAS',dataset:'ORG01',alias};}
 const applied=await organizationBundleHttpSmoke(owner,f);expect(applied.facts!.find(f=>f.owner==='organization-master')!.id).not.toBe(alias);
 const count=()=>peer(receipt.name,'SELECT jsonb_build_array((SELECT count(*) FROM organization_master.subject),(SELECT count(*) FROM organization_master.campus),(SELECT count(*) FROM organization_master.operating_object),(SELECT count(*) FROM organization_master.operating_access),(SELECT count(*) FROM organization_master.bundle_child),(SELECT count(*) FROM governance_catalog.apply_commit))');const before=count();await rejectThirdRelationOverHttp(owner,f);expect(count()).toBe(before);
 }finally{await owner.close();await f.close();}
});

test('unsupported services and uncovered declared scope are validation blockers before legal approval',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const first=f.input.manifest.rows.find(r=>r.dataset==='ORG03')!;if(first.dataset!=='ORG03')throw new Error();first.services=['UNKNOWN_MEDICAL'];
 const second=f.input.manifest.rows.find(r=>r.dataset==='ORG03'&&r.row===3)!;if(second.dataset!=='ORG03'||second.scopes[0]?.kind!=='VERIFY_SCOPE')throw new Error();second.scopes[0].validTo='2027-01-01T00:00:00';
 const received=await owner.receive('maker',f.input,f.workbook()),result=await owner.validate('maker',{requestId:randomUUID(),jobId:received.jobId,revisionId:received.revisionId});
 expect(result.issues).toContainEqual(expect.objectContaining({dataset:'ORG03',row:2,code:'UNSUPPORTED_SERVICE'}));expect(result.issues).toContainEqual(expect.objectContaining({dataset:'ORG03',row:3,code:'LICENSE_PERIOD_NOT_COVERED'}));
 }finally{await owner.close();await f.close();}
});

test('generic protected reads cannot bypass the workbook governance scopes',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const received=await owner.receive('maker',f.input,f.workbook());
 peer(receipt.name,"DELETE FROM organization_master.access WHERE actor='maker' AND subject_id='00000000-0000-0000-0000-000000000000' AND campus='NORTH' AND permission='READ'");
 try{await expect(catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:received.rawArtifactId})).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,"INSERT INTO organization_master.access VALUES('maker','00000000-0000-0000-0000-000000000000','NORTH','READ') ON CONFLICT DO NOTHING");}
 }finally{await owner.close();await f.close();}
});

test('validation request replay returns the original signed run',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const received=await owner.receive('maker',f.input,f.workbook()),input={jobId:received.jobId,revisionId:received.revisionId,requestId:randomUUID()};
 const first=await owner.validate('maker',input),again=await owner.validate('maker',input);expect(first.run?.runId).toBeTruthy();expect(again.run).toEqual(first.run);
 }finally{await owner.close();await f.close();}
});

test('a changed referenced license after approval makes the whole workbook stale',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const subject=await f.x.createSubject(),license=await f.x.addLicense(subject);f.values['ORG01']=[];f.input.manifest.rows=f.input.manifest.rows.filter(r=>r.dataset!=='ORG01');
 for(const row of f.input.manifest.rows)if(row.dataset==='ORG03'){row.subject={kind:'PLATFORM_REF',dataset:'ORG01',id:subject.id,expectedVersion:subject.version};for(const scope of row.scopes)if(scope.kind==='VERIFY_SCOPE')scope.license=license;}
 for(const row of f.values['ORG03']!)row['legal_entity_id']=subject.id;
 const received=await owner.receive('maker',f.input,f.workbook()),ref={jobId:received.jobId,revisionId:received.revisionId};
 await owner.preauthorize('bundle-admin',{...ref,requestId:randomUUID(),grants:[2,3,4].flatMap(row=>['maker','reviewer'].map(actor=>({row,actor,permissions:['READ','CREATE','REVIEW'] as const})))});
 const legal=await owner.readLegalReview('reviewer',ref);await owner.verifyLegalReview('reviewer',{...ref,requestId:randomUUID(),digest:legal.digest});
 const requestId=randomUUID(),candidate=await owner.plan('maker',{...ref,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 await f.x.orgApply({...f.x.common,action:'REVOKE_LICENSE',target:{id:subject.id,version:subject.version},licenseTarget:{id:license.id,version:license.version},reason:'DEMO_CORRECTION'});
 const count=()=>peer(receipt.name,'SELECT jsonb_build_array((SELECT count(*) FROM organization_master.campus),(SELECT count(*) FROM organization_master.operating_object),(SELECT count(*) FROM organization_master.bundle_child),(SELECT count(*) FROM governance_catalog.apply_commit))');const before=count();
 await expect(owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).rejects.toThrow('STALE_VALIDATION');expect(count()).toBe(before);
 }finally{await owner.close();await f.close();}
});

test('application SQL and individual manual inputs cannot forge an organization bundle',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider),pool=new Pool({connectionString:connection,max:1});
 try{const received=await owner.receive('maker',f.input,f.workbook());
 await expect(pool.query('INSERT INTO organization_master.bundle_child(input_id,candidate_id,step_key,legal_review_id,command_digest) VALUES(uuidv7(),uuidv7(),$1,uuidv7(),$2)',['ORG01/2/main','0'.repeat(64)])).rejects.toMatchObject({code:'42501'});
 await expect(pool.query('SELECT organization_master.bundle_control($1,$2)',['{}','0'.repeat(64)])).rejects.toThrow();
 const client=await pool.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('hdi.org_bundle',$1,true)",[JSON.stringify({ticket:'{}',signature:'0'.repeat(64)})]);await expect(client.query("SELECT organization_master.bundle_context('maker')")).rejects.toThrow();}finally{await client.query('ROLLBACK');client.release();}
 await expect(f.x.org.stage('maker',{requestId:randomUUID(),jobId:received.jobId,revisionId:received.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',command:{...f.x.common,action:'CREATE',facts:{legalName:'DEMO forbidden partial',entityNature:'DEMO',authority:null,legalAddress:null,registrationEvidence:f.x.artifact.artifactId},identifiers:[]}})).rejects.toThrow();
 }finally{await pool.end();await owner.close();await f.close();}
});

test('a workbook revises an explicit campus in place and cannot smuggle a suspension declaration',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const node=await f.x.createCampus();f.values['ORG01']=[];f.values['ORG03']=[];f.values['ORG02']=[{...f.values['ORG02']![0]!,campus_name:'DEMO renamed through workbook'}];
 const row=f.input.manifest.rows.find(r=>r.dataset==='ORG02')!;row.intent='REVISE';row.target={owner:'organization-master/campus',id:node.id,expectedVersion:node.version};f.input.manifest.rows=[row];
 const received=await owner.receive('maker',f.input,f.workbook()),ref={jobId:received.jobId,revisionId:received.revisionId};
 const legal=await owner.readLegalReview('reviewer',ref);await owner.verifyLegalReview('reviewer',{...ref,requestId:randomUUID(),digest:legal.digest});const requestId=randomUUID(),candidate=await owner.plan('maker',{...ref,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 const applied=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(applied.status).toBe('COMMITTED');if(applied.status!=='COMMITTED')throw new Error();expect(applied.facts[0]!.id).toBe(node.id);
 const read=await f.x.campus.references.resolveCampusReference('maker',{references:[{owner:'organization-master/campus',id:node.id}]});expect(read.items[0]?.facts?.campusName).toBe('DEMO renamed through workbook');expect(read.items[0]?.operationStatus).toBe('PLANNING');
 row.target.expectedVersion=applied.facts[0]!.version;f.input.requestId=randomUUID();f.values['ORG02']![0]!['operation_status']='SUSPENDED';const invalid=await owner.receive('maker',f.input,f.workbook());
 await expect(owner.readLegalReview('reviewer',{jobId:invalid.jobId,revisionId:invalid.revisionId})).rejects.toThrow('UNSUPPORTED_STATE_TRANSITION');
 }finally{await owner.close();await f.close();}
});

test('pair A READ preauthorization cannot grant pair B access or object WRITE',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{peer(receipt.name,"INSERT INTO vnext_control.actor VALUES('bundle-reader','DEMO_BUNDLE_READER',true);INSERT INTO vnext_control.actor_grant SELECT 'bundle-reader','SYNTHETIC',p FROM unnest(ARRAY['READ','WRITE','REVIEW']) p;INSERT INTO organization_master.access SELECT 'bundle-reader','00000000-0000-0000-0000-000000000000','NORTH',p FROM unnest(ARRAY['READ','WRITE','REVIEW','READ_RESTRICTED']) p;");
 const received=await owner.receive('maker',f.input,f.workbook()),ref={jobId:received.jobId,revisionId:received.revisionId};
 await owner.preauthorize('bundle-admin',{...ref,requestId:randomUUID(),grants:[...[2,3,4].flatMap(row=>['maker','reviewer'].map(actor=>({row,actor,permissions:['READ' as const,'CREATE' as const,'REVIEW' as const]}))),{row:2,actor:'bundle-reader',permissions:['READ']}]});
 const legal=await owner.readLegalReview('reviewer',ref);await owner.verifyLegalReview('reviewer',{...ref,requestId:randomUUID(),digest:legal.digest});const requestId=randomUUID(),candidate=await owner.plan('maker',{...ref,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);const applied=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(applied.status!=='COMMITTED')throw new Error();
 const first=applied.facts.find(f=>f.owner==='organization-master/campus'&&f.source?.row===2)!,second=applied.facts.find(f=>f.owner==='organization-master/campus'&&f.source?.row===3)!;
 expect((await f.x.campus.references.resolveCampusReference('bundle-reader',{references:[{owner:'organization-master/campus',id:first.id}]})).items).toHaveLength(1);
 await expect(f.x.campus.references.resolveCampusReference('bundle-reader',{references:[{owner:'organization-master/campus',id:second.id}]})).rejects.toThrow('ACCESS_DENIED');
 expect(peer(receipt.name,`SELECT count(*) FROM organization_master.access WHERE actor='bundle-reader' AND subject_id=${quote(first.id)}::uuid AND permission<>'READ'`)).toBe('0');
 }finally{await owner.close();await f.close();}
});

test('losing a child worksheet protected permission denies the entire original workbook',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const received=await owner.receive('maker',f.input,f.workbook()),ref={jobId:received.jobId,revisionId:received.revisionId};const dataset=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='DATASET'&&i.code==='ORG03')!;
 peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='reviewer' AND dataset_id=${quote(dataset.id)}::uuid AND campus='NORTH' AND permission='READ'`);
 try{await expect(owner.readRevision('reviewer',ref)).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('reviewer',${quote(dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ') ON CONFLICT DO NOTHING`);}
 }finally{await owner.close();await f.close();}
});

test('existing partial license scope cannot receive a successful legal review',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const subject=await f.x.createSubject(),campus=await f.x.createCampus();f.x.grantPair(subject.id,campus.id);const license=await f.x.addLicense(subject),scope=await f.x.verifyScope(subject,campus,license,['DEMO_MEDICAL_A'],'2026-01-01T00:00:00','2027-01-01T00:00:00');
 f.values['ORG01']=[];f.values['ORG02']=[];f.values['ORG03']=[{...f.values['ORG03']![0]!,legal_entity_id:subject.id,campus_id:campus.id}];const row=f.input.manifest.rows.find(r=>r.dataset==='ORG03')!;if(row.dataset!=='ORG03')throw new Error();row.subject={kind:'PLATFORM_REF',dataset:'ORG01',id:subject.id,expectedVersion:subject.version};row.campus={kind:'PLATFORM_REF',dataset:'ORG02',id:campus.id,expectedVersion:campus.version};row.scopes=[{kind:'EXISTING_SCOPE',reference:scope}];f.input.manifest.rows=[row];
 const received=await owner.receive('maker',f.input,f.workbook()),ref={jobId:received.jobId,revisionId:received.revisionId};await owner.preauthorize('bundle-admin',{...ref,requestId:randomUUID(),grants:['maker','reviewer'].map(actor=>({row:2,actor,permissions:['READ','CREATE','REVIEW']}))});
 await expect(owner.readLegalReview('reviewer',ref)).rejects.toThrow('LICENSE_PERIOD_NOT_COVERED');
 const blocked=await owner.validate('maker',{...ref,requestId:randomUUID()});expect(blocked.issues).toContainEqual(expect.objectContaining({dataset:'ORG03',row:2,code:'LICENSE_PERIOD_NOT_COVERED'}));
 const nextLicense=await f.x.addLicense(subject,'2027-01-01T00:00:00');row.scopes.push({kind:'VERIFY_SCOPE',license:nextLicense,evidence:f.x.artifact.artifactId,validFrom:'2027-01-01T00:00:00',validTo:null,services:['DEMO_MEDICAL_A']});f.input.requestId=randomUUID();
 const next=await owner.receive('maker',f.input,f.workbook()),nextRef={jobId:next.jobId,revisionId:next.revisionId};await owner.preauthorize('bundle-admin',{...nextRef,requestId:randomUUID(),grants:['maker','reviewer'].map(actor=>({row:2,actor,permissions:['READ','CREATE','REVIEW']}))});
 const legal=await owner.readLegalReview('reviewer',nextRef);await owner.verifyLegalReview('reviewer',{...nextRef,requestId:randomUUID(),digest:legal.digest});const requestId=randomUUID(),candidate=await owner.plan('maker',{...nextRef,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 const applied=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(applied.status).toBe('COMMITTED');if(applied.status!=='COMMITTED')throw new Error();expect(applied.facts).toHaveLength(2);
 expect((await f.x.operating.evaluateOperatingWindow('maker',{...f.x.endpoints(subject,campus),services:['DEMO_MEDICAL_A'],validFrom:'2026-01-01T00:00:00',validTo:null})).status).toBe('NOT_SATISFIED');
 }finally{await owner.close();await f.close();}
});

test('a structurally rejected workbook retains signed parse and validation evidence',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const received=await owner.receive('maker',f.input,organizationWorkbook({ORG01:[['wrong_header']],ORG02:[['wrong_header']]})),result=await owner.validate('maker',{jobId:received.jobId,revisionId:received.revisionId,requestId:randomUUID()});expect(result.decision).toBe('FAIL');expect(result.run?.runId).toBeTruthy();
 expect((await catalog.explainIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',runId:result.run!.runId})).evaluation.decision).toBe('FAIL');
 }finally{await owner.close();await f.close();}
});

test('retained deployment fixtures reuse the published service adoption without revising it',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),before=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(c=>c.definition.templateVersion==='ORG03_MANUAL_CORE_V1')!;
 const f=await organizationBundleFixture(receipt,connection,provider,catalog,true);try{expect(f.x.codeSet.reference.contractVersionId).toBe(before.versionId);expect((await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(c=>c.id===before.id)!.versionId).toBe(before.versionId);}finally{await f.close();}
});

test('a bundle task cannot downgrade its atomic workbook policy to single-sheet CSV',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const received=await owner.receive('maker',f.input,f.workbook());
 await expect(catalog.receiveFile('maker',{job:{action:'REVISE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'DEMO_DOWNGRADE',jobId:received.jobId,expectedCurrentRevision:received.revisionId,input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V2'}},fileRequestId:randomUUID(),extension:'.csv',campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600},Buffer.from('legal_entity_id\nDEMO'))).rejects.toThrow('BUNDLE_CONTEXT_REQUIRED');
 expect((await owner.readRevision('maker',{jobId:received.jobId,revisionId:received.revisionId})).currentRevisionId).toBe(received.revisionId);
 }finally{await owner.close();await f.close();}
});

test('changing all three contract bindings creates a new revision with fresh review and preauthorization',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const first=await owner.receive('maker',f.input,f.workbook()),oldRef={jobId:first.jobId,revisionId:first.revisionId};
 await owner.preauthorize('bundle-admin',{...oldRef,requestId:randomUUID(),grants:[2,3,4].flatMap(row=>['maker','reviewer'].map(actor=>({row,actor,permissions:['READ','CREATE','REVIEW'] as const})))});const oldLegal=await owner.readLegalReview('reviewer',oldRef);await owner.verifyLegalReview('reviewer',{...oldRef,requestId:randomUUID(),digest:oldLegal.digest});
 const contracts=await organizationImportContracts(catalog,f.x.source.versionId),next=await owner.receive('maker',{...f.input,requestId:randomUUID(),job:{action:'REVISE',jobId:first.jobId,expectedCurrentRevision:first.revisionId},contracts:contracts.map(({dataset,contractId,contractVersionId})=>({dataset,contractId,contractVersionId}))},f.workbook());expect(next.jobId).toBe(first.jobId);expect(next.revisionId).not.toBe(first.revisionId);
 const ref={jobId:next.jobId,revisionId:next.revisionId};await expect(owner.readLegalReview('reviewer',ref)).rejects.toThrow('PAIR_PREAUTHORIZATION_REQUIRED');
 await owner.preauthorize('bundle-admin',{...ref,requestId:randomUUID(),grants:[2,3,4].flatMap(row=>['maker','reviewer'].map(actor=>({row,actor,permissions:['READ','CREATE','REVIEW'] as const})))});const legal=await owner.readLegalReview('reviewer',ref);await owner.verifyLegalReview('reviewer',{...ref,requestId:randomUUID(),digest:legal.digest});
 const valid=await owner.validate('maker',{...ref,requestId:randomUUID()});expect(valid.decision).toBe('PASS');const explanation=await catalog.explainIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',runId:valid.run!.runId});expect(explanation.evaluation.dependencies.some(d=>d.target==='ORG01.contract'&&d.version===contracts[0]!.contractVersionId)).toBe(true);
 }finally{await owner.close();await f.close();}
});

test('a mixed NORTH/SOUTH workbook uses exact per-dataset scopes without requiring ORG01 SOUTH',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{
 const datasets=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.filter(i=>i.kind==='DATASET'&&['ORG02','ORG03'].includes(i.code));
 peer(receipt.name,"INSERT INTO organization_master.access SELECT a,'00000000-0000-0000-0000-000000000000','SOUTH',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','REVIEW','READ_RESTRICTED']) p ON CONFLICT DO NOTHING;");
 for(const dataset of datasets)peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(dataset.id)}::uuid,'SOUTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer','bundle-admin']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
 const source=JSON.parse(peer(receipt.name,`SELECT jsonb_build_object('jobId',job_id,'revisionId',revision_id) FROM governance_catalog.protected_artifact WHERE id=${quote(f.x.artifact.artifactId)}::uuid`));
 const south=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',campus:'SOUTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),jobId:source.jobId,revisionId:source.revisionId,kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO_SOUTH_LEGAL_EVIDENCE'));
 for(const row of f.input.manifest.rows)if(row.row===2&&row.dataset!=='ORG01'){row.governanceScope='SOUTH';if(row.dataset==='ORG02')row.evidence=south.artifactId;else for(const scope of row.scopes)if(scope.kind==='VERIFY_SCOPE')scope.evidence=south.artifactId;}
 f.values['ORG03']![0]!['evidence_ref']=south.artifactId;
 const applied=await organizationBundleHttpSmoke(owner,f),campus=applied.facts!.find(f=>f.owner==='organization-master/campus'&&f.source.row===2)!;
 expect(peer(receipt.name,`SELECT scope FROM organization_master.campus WHERE id=${quote(campus.id)}::uuid`)).toBe('SOUTH');
 }finally{await owner.close();await f.close();}
});

test('the shared quality ledger distinguishes physical row two in ORG01 and ORG02',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{f.values['ORG01']![0]!['legal_name']='';f.values['ORG02']![0]!['campus_name']='';const received=await owner.receive('maker',f.input,f.workbook()),result=await owner.validate('maker',{jobId:received.jobId,revisionId:received.revisionId,requestId:randomUUID()});
 await catalog.openIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),runId:result.run!.runId,reason:'DEMO_BUNDLE_FIELDS'});
 const issues=await catalog.qualityIssueRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',jobId:received.jobId});expect(issues.items).toContainEqual(expect.objectContaining({dataset:'ORG01',sheet:'ORG01',row:2,field:'ORG01.legal_name'}));expect(issues.items).toContainEqual(expect.objectContaining({dataset:'ORG02',sheet:'ORG02',row:2,field:'ORG02.campus_name'}));
 }finally{await owner.close();await f.close();}
});


test('new scope extra unknown service blocks legal verification before symbolic IDs resolve',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{const row=f.input.manifest.rows.find(r=>r.dataset==='ORG03')!;if(row.dataset!=='ORG03'||row.scopes[0]?.kind!=='VERIFY_SCOPE')throw new Error();row.scopes[0].services.push('UNKNOWN_SERVICE');
 const received=await owner.receive('maker',f.input,f.workbook()),ref={jobId:received.jobId,revisionId:received.revisionId};const result=await owner.validate('maker',{...ref,requestId:randomUUID()});expect(result.issues).toContainEqual(expect.objectContaining({dataset:'ORG03',row:2,code:'UNSUPPORTED_SERVICE'}));
 }finally{await owner.close();await f.close();}
});

test('unmanifested worksheet data cannot bypass its protected read dimension',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationImport(connection,provider);
 try{f.input.manifest.rows=f.input.manifest.rows.filter(r=>r.dataset!=='ORG03');const received=await owner.receive('maker',f.input,f.workbook()),ref={jobId:received.jobId,revisionId:received.revisionId};const dataset=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='DATASET'&&i.code==='ORG03')!;
 peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='reviewer' AND dataset_id=${quote(dataset.id)}::uuid AND campus='NORTH' AND permission='READ'`);
 try{await expect(owner.inspectWorkbook('reviewer',ref)).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('reviewer',${quote(dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ') ON CONFLICT DO NOTHING`);}
 }finally{await owner.close();await f.close();}
});
