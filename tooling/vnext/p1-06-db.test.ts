import {workspaceManualFixture} from './workspace-manual-fixture.js';
import {Pool} from 'pg';
import {operatingScenario} from './operating-scenario.js';
import {campusCodeSet} from './campus-fixture.js';
import {fixture} from './protected-fixture.js';
import {readFileSync} from 'node:fs';
import {organizationBundleFixture} from './organization-bundle-fixture.js';
import {peer,quote} from './lineage.mjs';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {test,expect,afterAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import * as organization from '../../apps/governance-api/src/modules/organization-master/index.js';
import {LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
test('an editor explicitly saves an incomplete private draft and can restore it after reopening the service',async()=>{
 expect(organization).toHaveProperty('openOrganizationWorkspace');
 const open=organization.openOrganizationWorkspace;
 let owner=open(connection,provider);
 try{
  const input={requestId:randomUUID(),domain:'ORG01' as const,campus:'NORTH' as const,command:{action:'CREATE',facts:{legalName:'DEMO incomplete draft'}}};
  const saved=await owner.saveDraft('maker',input);expect(saved.id).toMatch(/^[a-f0-9-]{36}$/);expect(saved.version).toBe('1');
  await owner.close();owner=open(connection,provider);
  expect((await owner.readDraft('maker',saved.id)).content).toMatchObject({command:{facts:{legalName:'DEMO incomplete draft'}}});
  await expect(owner.readDraft('reviewer',saved.id)).rejects.toThrow('ACCESS_DENIED');
 }finally{await owner.close();}
});

test('private drafts can be listed and discarded without changing their source or accepting stale edits',async()=>{
 const owner=organization.openOrganizationWorkspace(connection,provider);
 try{
  expect(owner).toHaveProperty('listDrafts');
  const input={requestId:randomUUID(),domain:'ORG01' as const,campus:'NORTH' as const,command:{action:'CREATE',source:{alias:'DEMO_ORIGINAL'},facts:{legalName:'DEMO list draft'}}};
  const saved=await owner.saveDraft('maker',input);expect(await owner.saveDraft('maker',input)).toEqual(saved);
  await expect(owner.saveDraft('maker',{...input,command:{action:'CREATE'}})).rejects.toThrow('REQUEST_CONFLICT');
  const revised=await owner.saveDraft('maker',{...input,id:saved.id,expectedVersion:'1',requestId:randomUUID()});
  await expect(owner.saveDraft('maker',{...input,id:saved.id,expectedVersion:'1',requestId:randomUUID()})).rejects.toThrow('STALE_HEAD');
  expect(await owner.listDrafts('reviewer')).not.toContainEqual(expect.objectContaining({id:saved.id}));
  expect(await owner.listDrafts('maker')).toContainEqual(expect.objectContaining({id:saved.id,version:'2',state:'EDITING'}));
  await owner.discardDraft('maker',{id:saved.id,expectedVersion:revised.version,requestId:randomUUID()});
  expect((await owner.readDraft('maker',saved.id)).state).toBe('DISCARDED');
  await expect(owner.saveDraft('maker',{...input,id:saved.id,expectedVersion:'3',requestId:randomUUID()})).rejects.toThrow('STALE_HEAD');
 }finally{await owner.close();}
});

test('HTTP saves and restores an incomplete draft with trusted actor and closed input',async()=>{
 const owner=organization.openOrganizationWorkspace(connection,provider);
 const app=await buildCatalogServer(undefined,'CONTROL_PLANE',undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 try{
  const payload={requestId:randomUUID(),domain:'ORG01',campus:'NORTH',command:{action:'CREATE',facts:{legalName:'DEMO HTTP draft'}}};
  const saved=await app.inject({method:'POST',url:'/api/vnext/organization-workspace/drafts/save',headers:{'x-catalog-actor':'maker'},payload});expect(saved.statusCode).toBe(200);
  const id=saved.json().id;
  const read=await app.inject({method:'POST',url:'/api/vnext/organization-workspace/drafts/read',headers:{'x-catalog-actor':'maker'},payload:{id}});expect(read.statusCode).toBe(200);expect(read.json().content.command.facts.legalName).toBe('DEMO HTTP draft');
  expect((await app.inject({method:'POST',url:'/api/vnext/organization-workspace/drafts/read',headers:{'x-catalog-actor':'reviewer'},payload:{id}})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:'/api/vnext/organization-workspace/drafts/save',headers:{'x-catalog-actor':'maker'},payload:{...payload,actor:'reviewer'}})).statusCode).toBe(400);
 }finally{await app.close();await owner.close();}
});

test('stored workbook editing drafts recheck every protected dataset after permission revocation',async()=>{
 const catalog=await openCatalog(connection,provider),receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
 const f=await organizationBundleFixture(receipt,connection,provider,catalog),owner=organization.openOrganizationWorkspace(connection,provider);
 try{
  const payload={domain:'BUNDLE' as const,campus:'NORTH' as const,metadata:f.input,bytesBase64:f.workbook().toString('base64')};
  const previewReads=()=>Number(peer(receipt.name,"SELECT count(*) FROM vnext_control.audit WHERE action='WORKSPACE_PREVIEW_READ' AND actor_code='maker'"));const beforePreview=previewReads();
  expect(owner).toHaveProperty('previewWorkbook');
  const preview=await owner.previewWorkbook('maker',payload);expect(preview).toMatchObject({structuralStatus:'PARSED',qualification:'NOT_EVALUATED'});expect(preview.cells).toContainEqual(expect.objectContaining({sheet:'ORG01',row:2,field:'legal_entity_id',value:'DEMO_SUBJECT'}));
  expect(previewReads()).toBe(beforePreview+1);
  const saved=await owner.saveDraft('maker',{requestId:randomUUID(),...payload});
  const dataset=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='DATASET'&&i.code==='ORG03')!;
  peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND dataset_id=${quote(dataset.id)}::uuid AND campus='NORTH' AND permission='READ'`);
  try{await expect(owner.readDraft('maker',saved.id)).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ') ON CONFLICT DO NOTHING`);}
 }finally{await owner.close();await f.close();await catalog.close();}
});

test('operation capabilities reflect current policy rather than a client role label',async()=>{
 const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
 peer(receipt.name,"INSERT INTO vnext_control.actor VALUES('workspace-reviewer','DEMO_WORKSPACE_REVIEWER',true);INSERT INTO vnext_control.actor_grant SELECT 'workspace-reviewer','SYNTHETIC',p FROM unnest(ARRAY['READ','REVIEW']) p;INSERT INTO organization_master.access SELECT 'workspace-reviewer','00000000-0000-0000-0000-000000000000','NORTH',p FROM unnest(ARRAY['READ','REVIEW','READ_RESTRICTED']) p;");
 const owner=organization.openOrganizationWorkspace(connection,provider),input={domain:'ORG01' as const,campus:'NORTH' as const,command:{action:'CREATE'}};
 try{
  expect(owner).toHaveProperty('capabilities');
  expect(await owner.capabilities('maker',input)).toMatchObject({canWrite:true,canRead:true});
  expect(await owner.capabilities('workspace-reviewer',input)).toMatchObject({canWrite:false,canRead:true,canReview:true});
  expect(await owner.capabilities('outsider',input)).toMatchObject({canWrite:false,canRead:false,canReview:false});
 }finally{await owner.close();}
});

test('a complete saved draft submits through the existing Owner and replays the same input IDs',async()=>{
 const catalog=await openCatalog(connection,provider),owner=organization.openOrganizationWorkspace(connection,provider),org=organization.openOrganization(connection,provider),receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
 try{
  expect(owner).toHaveProperty('submitDraft');
  const f=await workspaceManualFixture(catalog,{ruleVersion:'WORKSPACE_MANUAL_TRANSPORT'}),job=await catalog.importJobCommand('maker',{...f.create,requestId:randomUUID()});
  peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
  const evidence=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO_WORKSPACE_REGISTRATION'));
  const source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='SOURCE'&&i.status==='PUBLISHED')!;
  const saved=await owner.saveDraft('maker',{requestId:randomUUID(),domain:'ORG01',campus:'NORTH',transport:{contractId:f.contract.id,contractVersionId:f.contract.versionId},command:{action:'CREATE',source:{systemId:source.id,versionId:source.versionId,alias:'DEMO_WORKSPACE',versionNo:1,recordLocator:'DEMO_PRIVATE_LOCATION',recordedAt:'2026-01-01T00:00:00',recordStatus:'PUBLISHED',approvalRef:'DEMO_APPROVAL'},validFrom:'2026-01-01T00:00:00',validTo:null,facts:{legalName:'DEMO submitted from workspace',entityNature:'DEMO',authority:null,legalAddress:null,registrationEvidence:evidence.artifactId},identifiers:[{kind:'INSTITUTION_CODE',namespace:'DEMO_REGISTRY',value:'DEMO_WORKSPACE_CODE'}]}});
  const command={id:saved.id,expectedVersion:saved.version,requestId:randomUUID()},submitted=await owner.submitDraft('maker',command);
  expect(await owner.submitDraft('maker',command)).toEqual(submitted);expect((await owner.readDraft('maker',saved.id)).state).toBe('SUBMITTED');
  expect(owner).toHaveProperty('preflight');const before=await org.read('maker',{mode:'LIST'});expect(await owner.preflight('maker',{domain:'ORG01',inputId:submitted.inputId})).toMatchObject({status:'ELIGIBLE_FOR_CANDIDATE',codes:[]});expect(await org.read('maker',{mode:'LIST'})).toEqual(before);expect(await owner.listApplications('maker')).toContainEqual(expect.objectContaining({inputId:submitted.inputId,state:'STAGED',candidateId:null}));
  const requestId=randomUUID(),candidate=await org.plan('maker',{inputId:submitted.inputId,requestId});await org.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});expect(owner).toHaveProperty('reviewMaterials');const materials=await owner.reviewMaterials('reviewer',{domain:'ORG01',candidateId:candidate.candidateId});expect(materials.materials).toHaveLength(1);expect(Buffer.from(materials.materials[0]!.bytesBase64,'base64').toString()).toBe('DEMO_WORKSPACE_REGISTRATION');await org.approveApplyUnit('reviewer',candidate);const result=await org.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(result.status).toBe('COMMITTED');if(result.status!=='COMMITTED')throw new Error('NOT_COMMITTED');
  expect(await org.read('maker',{mode:'EXACT',id:result.facts![0]!.id,version:result.facts![0]!.version})).toContainEqual(expect.objectContaining({legalName:'DEMO submitted from workspace'}));
  expect(owner).toHaveProperty('listApplications');
  expect(await owner.listApplications('reviewer')).toContainEqual(expect.objectContaining({inputId:submitted.inputId,maker:'maker',state:'COMMITTED',candidateId:candidate.candidateId}));
  expect(await owner.applicationCapabilities('maker-alias',submitted.inputId)).toMatchObject({canReview:false});
  const priorInput=await org.readRestrictedInput('maker',submitted.inputId);
  for(let index=0;index<101;index++)await org.stage('maker',{...priorInput,requestId:randomUUID()});
  expect(await owner.listApplications('reviewer')).not.toContainEqual(expect.objectContaining({inputId:submitted.inputId}));
  const exactApp=await buildCatalogServer(undefined,'CONTROL_PLANE',undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
  try{const response=await exactApp.inject({method:'POST',url:'/api/vnext/organization-workspace/applications/list',headers:{'x-catalog-actor':'reviewer'},payload:{inputId:submitted.inputId}});expect(response.statusCode).toBe(200);expect(response.json()).toEqual([expect.objectContaining({inputId:submitted.inputId,state:'COMMITTED'})]);}finally{await exactApp.close();}

  expect(owner).toHaveProperty('prepareRevision');expect(await owner.prepareRevision('maker',{kind:'ORGANIZATION',id:result.facts![0]!.id,version:'1'})).toMatchObject({domain:'ORG01',command:{action:'REVISE',target:{id:result.facts![0]!.id,version:'1'},identifiers:[{kind:'INSTITUTION_CODE',namespace:'DEMO_REGISTRY',value:'DEMO_WORKSPACE_CODE'}],source:{alias:'DEMO_WORKSPACE'}}});
 }finally{await org.close();await owner.close();await catalog.close();}
});

test('a private evidence attachment becomes a real protected reference only when its draft is submitted',async()=>{
 const catalog=await openCatalog(connection,provider),owner=organization.openOrganizationWorkspace(connection,provider),org=organization.openOrganization(connection,provider),receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
 try{
  const f=await workspaceManualFixture(catalog,{ruleVersion:'WORKSPACE_ATTACHMENT'}),source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='SOURCE'&&i.status==='PUBLISHED')!;
  peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
  const saved=await owner.saveDraft('maker',{requestId:randomUUID(),domain:'ORG01',campus:'NORTH',transport:{contractId:f.contract.id,contractVersionId:f.contract.versionId},attachment:{filename:'DEMO-evidence.txt',bytesBase64:Buffer.from('DEMO_PRIVATE_ATTACHMENT').toString('base64')},command:{action:'CREATE',source:{systemId:source.id,versionId:source.versionId,alias:'DEMO_ATTACHMENT',versionNo:1,recordLocator:'DEMO_PRIVATE_LOCATOR',recordedAt:'2026-01-01T00:00:00',recordStatus:'PUBLISHED',approvalRef:'DEMO_APPROVAL'},validFrom:'2026-01-01T00:00:00',validTo:null,facts:{legalName:'DEMO attachment subject',entityNature:'DEMO',authority:null,legalAddress:null},identifiers:[]}});
  await expect(owner.readDraft('reviewer',saved.id)).rejects.toThrow('ACCESS_DENIED');
  peer(receipt.name,"DELETE FROM organization_master.access WHERE actor='maker' AND subject_id='00000000-0000-0000-0000-000000000000' AND campus='NORTH' AND permission='READ_RESTRICTED'");
  try{await expect(owner.readDraft('maker',saved.id)).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,"INSERT INTO organization_master.access VALUES('maker','00000000-0000-0000-0000-000000000000','NORTH','READ_RESTRICTED')");}
  const submitted=await owner.submitDraft('maker',{id:saved.id,expectedVersion:saved.version,requestId:randomUUID()}),input=await org.readRestrictedInput('maker',submitted.inputId);
  if(input.command.action!=='CREATE')throw new Error('WRONG_COMMAND');const artifactId=input.command.facts.registrationEvidence;
  const material=await catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',artifactId,requestId:randomUUID()});expect(Buffer.from(material).toString()).toBe('DEMO_PRIVATE_ATTACHMENT');
 }finally{await org.close();await owner.close();await catalog.close();}
});

test('historical organization details do not include a license recorded after the selected R',async()=>{
 const catalog=await openCatalog(connection,provider),receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await operatingScenario(receipt,connection,provider,catalog);
 try{
  const subject=await f.createSubject(),version=(await f.org.read('maker',{id:subject.id,mode:'EXACT',version:subject.version}))[0]!;
  const license=await f.addLicense(subject,'2030-01-01T00:00:00');
  expect((await f.org.historyDetails('maker',subject.id,version.recordedAt)).licenses).toEqual([]);
  expect(await f.org.readLicenses('maker',{id:subject.id,mode:'EFFECTIVE',businessAt:'2026-01-01T00:00:00'})).toEqual([]);
  expect(await f.org.readLicenses('maker',{id:subject.id,mode:'EFFECTIVE',businessAt:'2030-01-01T00:00:00'})).toContainEqual(expect.objectContaining({id:license.id,version:license.version}));
 }finally{await f.close();await catalog.close();}
});

test('campus history uses one R for profile, plan and operation events',async()=>{
 const catalog=await openCatalog(connection,provider),receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await operatingScenario(receipt,connection,provider,catalog);
 try{
  const node=await f.createCampus(),first=await f.campus.references.history('maker',node.id),asOf=first.versions[0]!.recordedAt;
  await f.campusApply({...f.common,action:'SCHEDULE_OPENING',sourceOperationStatus:'PLANNING',target:{owner:'organization-master/campus',id:node.id,expectedVersion:node.version},evidence:f.artifact.artifactId,plannedOpeningAt:'2030-01-01T00:00:00'});
  expect((await f.campus.references.history('maker',node.id,asOf)).plans).toEqual([]);
  expect((await f.campus.references.history('maker',node.id)).plans).toHaveLength(1);
 }finally{await f.close();await catalog.close();}
});

test('an assigned campus steward submits a revision without acquiring dataset-wide catalog write permission',async()=>{
 const catalog=await openCatalog(connection,provider),owner=organization.openOrganizationWorkspace(connection,provider),receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await operatingScenario(receipt,connection,provider,catalog);
 try{
  const node=await f.createCampus();
  await campusCodeSet(catalog,f.source.versionId);
  peer(receipt.name,`INSERT INTO vnext_control.actor VALUES('workspace-steward','DEMO_WORKSPACE_STEWARD',true);INSERT INTO vnext_control.actor_grant SELECT 'workspace-steward','SYNTHETIC',p FROM unnest(ARRAY['READ','WRITE']) p;INSERT INTO organization_master.access SELECT 'workspace-steward',${quote(node.id)}::uuid,'NORTH',p FROM unnest(ARRAY['READ','WRITE','READ_RESTRICTED']) p;INSERT INTO vnext_control.object_grant SELECT 'workspace-steward',object_id,scope,object_kind,campus,purpose,field_group,permission FROM vnext_control.object_grant WHERE actor_code='maker' AND permission='READ' ON CONFLICT DO NOTHING;INSERT INTO vnext_control.protected_grant SELECT 'workspace-steward',dataset_id,campus,purpose,permission FROM vnext_control.protected_grant WHERE actor_code='maker' AND permission='READ' ON CONFLICT DO NOTHING;`);
  const content=await owner.prepareRevision('workspace-steward',{kind:'CAMPUS',id:node.id,version:node.version});if(content.domain!=='ORG02')throw new Error('WRONG_DOMAIN');
  const saved=await owner.saveDraft('workspace-steward',{...content,requestId:randomUUID(),command:{...content.command,validFrom:'2026-02-01T00:00:00',sourceOperationStatus:'PLANNING'}});
  const sqlBoundary=new Pool({connectionString:connection});
  try{await expect(sqlBoundary.query('select governance_catalog.import_job_command($1,$2::jsonb)', ['workspace-steward',JSON.stringify({action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'WORKSPACE_MANUAL',profile:'CORE',contractId:f.codeSet.published.id,contractVersionId:f.codeSet.published.versionId,input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)},workspaceDraft:{id:saved.id,expectedVersion:saved.version}})])).rejects.toThrow('ACCESS_DENIED');}finally{await sqlBoundary.end();}
  await expect(owner.submitDraft('workspace-steward',{id:saved.id,expectedVersion:saved.version,requestId:randomUUID()})).resolves.toMatchObject({domain:'ORG02'});
  expect(await owner.capabilities('workspace-steward',{domain:'ORG02',campus:'NORTH',command:{action:'CREATE'}})).toMatchObject({canWrite:false});
  await expect(owner.saveDraft('workspace-steward',{requestId:randomUUID(),domain:'ORG01',campus:'NORTH',command:{action:'CREATE'}})).rejects.toThrow('ACCESS_DENIED');
  const control=await fixture(catalog,{textField:true,ruleVersion:'WORKSPACE_STEWARD_CATALOG_NEGATIVE'});
  await expect(catalog.importJobCommand('workspace-steward',{...control.create,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');
 }finally{await owner.close();await f.close();await catalog.close();}
});

test('a saved organization workbook submits as one existing bundle revision and recovers the same IDs',async()=>{
 const catalog=await openCatalog(connection,provider),owner=organization.openOrganizationWorkspace(connection,provider),bundle=organization.openOrganizationImport(connection,provider),receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog);
 try{
  const saved=await owner.saveDraft('maker',{requestId:randomUUID(),domain:'BUNDLE',campus:'NORTH',metadata:f.input,bytesBase64:f.workbook().toString('base64')}),request={id:saved.id,expectedVersion:saved.version,requestId:randomUUID()};
  const submitted=await owner.submitDraft('maker',request);expect(submitted.domain).toBe('BUNDLE');expect(await owner.submitDraft('maker',request)).toEqual(submitted);
  expect((await bundle.readRevision('maker',{jobId:submitted.jobId,revisionId:submitted.revisionId})).manifest).toEqual(f.input.manifest);expect((await owner.readDraft('maker',saved.id)).state).toBe('SUBMITTED');
  expect(owner).toHaveProperty('listBundles');expect(await owner.listBundles('reviewer')).toContainEqual(expect.objectContaining({jobId:submitted.jobId,revisionId:submitted.revisionId,state:'STAGED'}));
  const next=await bundle.receive('maker',{...f.input,requestId:randomUUID(),job:{action:'REVISE',jobId:submitted.jobId,expectedCurrentRevision:submitted.revisionId}},f.workbook());
  expect(next.revisionId).not.toBe(submitted.revisionId);
  expect(await owner.listBundles('reviewer')).toContainEqual(expect.objectContaining({jobId:submitted.jobId,revisionId:submitted.revisionId,access:expect.objectContaining({canWrite:false,canReview:false,canPlan:false,canPreauthorize:false})}));
  expect(await owner.submitDraft('maker',request)).toEqual(submitted);
  await expect(owner.submitDraft('reviewer',request)).rejects.toThrow('ACCESS_DENIED');
 }finally{await owner.close();await bundle.close();await f.close();await catalog.close();}
});

test('private drafts retain unsupported intent and incomplete binding selections without claiming readiness',async()=>{
 const owner=organization.openOrganizationWorkspace(connection,provider);
 try{
  const incomplete=await owner.saveDraft('maker',{requestId:randomUUID(),domain:'BUNDLE',campus:'NORTH',metadata:{contracts:[{dataset:'ORG01',contractId:randomUUID(),contractVersionId:randomUUID()}]}});
  expect((await owner.readDraft('maker',incomplete.id)).state).toBe('EDITING');
  const full=await owner.saveDraft('maker',Object.assign({requestId:randomUUID(),domain:'ORG01' as const,campus:'NORTH' as const,command:{action:'CREATE'}},{profile:'FULL' as const}));
  await expect(owner.submitDraft('maker',{id:full.id,expectedVersion:full.version,requestId:randomUUID()})).rejects.toThrow('BLOCKED_DEPENDENCY');
 }finally{await owner.close();}
});

test('a failed submission audit leaves neither a received workbook nor a submitted draft transition',async()=>{
 const catalog=await openCatalog(connection,provider),owner=organization.openOrganizationWorkspace(connection,provider),receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog);
 try{
  const saved=await owner.saveDraft('maker',{requestId:randomUUID(),domain:'BUNDLE',campus:'NORTH',metadata:f.input,bytesBase64:f.workbook().toString('base64')}),request={id:saved.id,expectedVersion:saved.version,requestId:randomUUID()};
  const before=await owner.listBundles('maker');
  peer(receipt.name,"CREATE FUNCTION organization_master.test_workspace_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='WORKSPACE_SAVE' AND NEW.reason='SUBMITTED' THEN RAISE EXCEPTION 'DEMO_AUDIT_FAILURE';END IF;RETURN NEW;END $$;CREATE TRIGGER workspace_fail_audit BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION organization_master.test_workspace_audit();");
  try{await expect(owner.submitDraft('maker',request)).rejects.toThrow('DEMO_AUDIT_FAILURE');expect(await owner.listBundles('maker')).toEqual(before);expect((await owner.readDraft('maker',saved.id)).state).toBe('EDITING');}
  finally{peer(receipt.name,'DROP TRIGGER workspace_fail_audit ON vnext_control.audit;DROP FUNCTION organization_master.test_workspace_audit();');}
  const completed=await owner.submitDraft('maker',request);expect(await owner.submitDraft('maker',request)).toEqual(completed);
 }finally{await owner.close();await f.close();await catalog.close();}
});

test('synthetic campus division adoption preserves the separate published ORG02 file contract',async()=>{
 const catalog=await openCatalog(connection,provider),receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog);
 try{
  const file=f.input.contracts.find(c=>c.dataset==='ORG02')!;
  const before=await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:file.contractId});
  const division=await campusCodeSet(catalog,f.x.source.versionId);expect(division.reference.contractId).not.toBe(file.contractId);
  expect(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:file.contractId})).toEqual(before);
 }finally{await f.close();await catalog.close();}
});

test('a scope editing draft cannot borrow another pair target for its transport authorization',async()=>{
 const catalog=await openCatalog(connection,provider),owner=organization.openOrganizationWorkspace(connection,provider),receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await operatingScenario(receipt,connection,provider,catalog);
 try{
  const subject=await f.createSubject(),node=await f.createCampus(),otherNode=await f.createCampus();f.grantPair(subject.id,node.id);f.grantPair(subject.id,otherNode.id);
  const license=await f.addLicense(subject),scope=await f.verifyScope(subject,node,license);
  const original=await owner.prepareRevision('maker',{kind:'SCOPE',id:scope.id,version:scope.version});if(original.domain!=='ORG03')throw new Error('WRONG_DOMAIN');
  await expect(owner.saveDraft('maker',{...original,requestId:randomUUID(),command:{...original.command,campus:{owner:'organization-master/campus',id:otherNode.id}}})).rejects.toThrow('ACCESS_DENIED');
  const {campus:removedCampus,...missingCampus}=original.command;const {subject:removedSubject,...missingSubject}=original.command;
  for(const command of [missingCampus,missingSubject])await expect(owner.saveDraft('maker',{...original,requestId:randomUUID(),command})).rejects.toThrow('ACCESS_DENIED');
 }finally{await owner.close();await f.close();await catalog.close();}
});

test('workspace private content fails closed without keys and application SQL cannot read or mutate draft rows',async()=>{
 const owner=organization.openOrganizationWorkspace(connection,provider),locked=organization.openOrganizationWorkspace(connection),pool=new Pool({connectionString:connection});
 try{
  const saved=await owner.saveDraft('maker',{domain:'ORG01',campus:'NORTH',requestId:randomUUID(),command:{action:'CREATE',facts:{legalName:'DEMO PRIVATE KEY REQUIRED'}}});
  await expect(locked.readDraft('maker',saved.id)).rejects.toThrow('KEY_UNAVAILABLE');
  for(const query of ['SELECT * FROM organization_master.workspace_draft_revision','INSERT INTO organization_master.workspace_draft_revision DEFAULT VALUES','UPDATE organization_master.workspace_draft_revision SET state=state','DELETE FROM organization_master.workspace_draft_revision'])await expect(pool.query(query)).rejects.toMatchObject({code:'42501'});
  expect((await owner.readDraft('maker',saved.id)).content).toMatchObject({command:{facts:{legalName:'DEMO PRIVATE KEY REQUIRED'}}});
 }finally{await pool.end();await locked.close();await owner.close();}
});

for(const scenario of ['NORMAL','UNKNOWN_SERVICE','LICENSE_GAP','STALE_VERSION'] as const)test('manual and workbook domain admissibility agree for '+scenario,async()=>{
 const catalog=await openCatalog(connection,provider),receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),f=await organizationBundleFixture(receipt,connection,provider,catalog),bundle=organization.openOrganizationImport(connection,provider),workspace=organization.openOrganizationWorkspace(connection,provider);
 try{
  const subject=await f.x.createSubject(),node=await f.x.createCampus();f.x.grantPair(subject.id,node.id);
  const finite=scenario==='LICENSE_GAP',license=await f.x.addLicense(subject,'2026-01-01T00:00:00',finite?'2026-06-01T00:00:00':null);
  let manual:Awaited<ReturnType<typeof workspace.preflight>>;
  if(scenario==='STALE_VERSION'){
   const current=await f.x.campus.references.read('maker',{id:node.id});
   const staged=await f.x.campus.stage('maker',{...f.x.operatingInput({...f.x.common,...f.x.endpoints(subject,node),action:'VERIFY_SCOPE',evidence:f.x.artifact.artifactId,facts:{license,catalog:f.x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO scope'}}),campus:'NORTH',purpose:'IDENTITY_VERIFY',command:{...f.x.common,action:'REVISE',target:{owner:'organization-master/campus',id:node.id,expectedVersion:'999'},facts:current.facts!,evidence:f.x.artifact.artifactId,sourceOperationStatus:'PLANNING'}});
   manual=await workspace.preflight('maker',{domain:'ORG02',inputId:staged.inputId});
   const row=f.input.manifest.rows.find(r=>r.dataset==='ORG02')!;row.intent='REVISE';row.target={owner:'organization-master/campus',id:node.id,expectedVersion:'999'};
  }else{
   const services=scenario==='UNKNOWN_SERVICE'?['UNKNOWN_SERVICE']:['DEMO_MEDICAL_A'];
   const staged=await f.x.operating.stage('maker',f.x.operatingInput({...f.x.common,...f.x.endpoints(subject,node),action:'VERIFY_SCOPE',evidence:f.x.artifact.artifactId,facts:{license,catalog:f.x.codeSet.reference,services,licenseScopeText:'DEMO scope'}}));
   manual=await workspace.preflight('maker',{domain:'ORG03',inputId:staged.inputId});
   if(scenario==='UNKNOWN_SERVICE'){const row=f.input.manifest.rows.find(r=>r.dataset==='ORG03')!;if(row.dataset!=='ORG03'||row.scopes[0]?.kind!=='VERIFY_SCOPE')throw new Error('FIXTURE_SHAPE');row.scopes[0].services=services;}
   if(finite){f.values['ORG01']![0]!['license_valid_to']='2026-06-01';const row=f.input.manifest.rows.find(r=>r.dataset==='ORG01')!;if(row.dataset!=='ORG01'||!row.license)throw new Error('FIXTURE_SHAPE');row.license.endKind='FINITE';}
  }
  const received=await bundle.receive('maker',f.input,f.workbook()),ref={jobId:received.jobId,revisionId:received.revisionId};
  await bundle.preauthorize('bundle-admin',{...ref,requestId:randomUUID(),grants:[2,3,4].flatMap(row=>['maker','reviewer'].map(actor=>({row,actor,permissions:['READ','CREATE','REVISE','REVIEW'] as const})))});
  if(scenario==='NORMAL'){
   const review=await bundle.readLegalReview('reviewer',ref);await bundle.verifyLegalReview('reviewer',{...ref,requestId:randomUUID(),digest:review.digest});
  }
  const imported=await bundle.validate('maker',{...ref,requestId:randomUUID()});
  if(scenario==='NORMAL'){expect(manual.status).toBe('ELIGIBLE_FOR_CANDIDATE');expect(imported.decision).toBe('PASS');}
  else{expect(manual.status).toBe('BLOCKED');expect(imported.decision).not.toBe('PASS');expect(imported.issues).toContainEqual(expect.objectContaining({code:scenario==='UNKNOWN_SERVICE'?'UNSUPPORTED_SERVICE':scenario==='LICENSE_GAP'?'LICENSE_PERIOD_NOT_COVERED':'STALE_VALIDATION'}));}
 }finally{await workspace.close();await bundle.close();await f.close();await catalog.close();}
},60000);
