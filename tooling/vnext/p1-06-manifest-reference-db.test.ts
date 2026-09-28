import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {organizationBundleFixture} from './organization-bundle-fixture.js';
import {peer,quote,inspect,migrationFiles} from './lineage.mjs';
import {workspaceStartupPrefix} from './workspace-migrations.mjs';
import {openCatalog,LocalSyntheticKeyProvider,canonicalPlan,planBinding,sealProtectedPayload} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationWorkspace,type DraftContent,type DraftSave} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {draftMetadata} from '../../apps/governance-api/src/modules/organization-master/workspace/contracts.js';

const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const upgrade=process.env['HDIP_REVIEW_CI_MANIFEST_UPGRADE']==='1';
let catalog:Awaited<ReturnType<typeof openCatalog>>,workspace:ReturnType<typeof openOrganizationWorkspace>,fixture:Awaited<ReturnType<typeof organizationBundleFixture>>;
let legacy:{id:string;restore:()=>void}|null=null;
type BundleDraft=Extract<DraftContent,{domain:'BUNDLE'}>;
const clone=<T>(value:T):T=>structuredClone(value);
function content(metadata:BundleDraft['metadata']):BundleDraft{return {domain:'BUNDLE',campus:'NORTH',metadata,bytesBase64:fixture.workbook().toString('base64')};}
function exactTarget(subject:{id:string;version:string}){
 const metadata=clone(fixture.input),row=metadata.manifest.rows.find(value=>value.dataset==='ORG01');if(!row||row.dataset!=='ORG01')throw new Error('ORG01_ROW_REQUIRED');
 row.intent='REVISE';row.target={owner:'organization-master',id:subject.id,expectedVersion:subject.version};return content(metadata);
}
function exactPair(subject:{id:string;version:string},campus:{id:string;version:string}){
 const metadata=clone(fixture.input),row=metadata.manifest.rows.find(value=>value.dataset==='ORG03');if(!row||row.dataset!=='ORG03')throw new Error('ORG03_ROW_REQUIRED');
 row.intent='CREATE';delete row.target;row.subject={kind:'PLATFORM_REF',dataset:'ORG01',id:subject.id,expectedVersion:subject.version};row.campus={kind:'PLATFORM_REF',dataset:'ORG02',id:campus.id,expectedVersion:campus.version};return content(metadata);
}
function revoke(table:string,where:string){
 const removed=peer(receipt.name,`WITH r AS(DELETE FROM ${table} WHERE ${where} RETURNING *) SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]')::text FROM r`),rows=JSON.parse(removed);
 expect(rows).not.toHaveLength(0);return ()=>peer(receipt.name,`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},${quote(removed)}::jsonb) ON CONFLICT DO NOTHING`);
}
function rawRead(id:string){return peer(receipt.name,`SELECT organization_master.workspace_read('maker',${quote(id)}::uuid)::text`);}
function saveLegacyV3(value:BundleDraft){
 const input:DraftSave={...value,requestId:randomUUID()},current=draftMetadata(input,'V3'),{manifestReferences:ignored,...metadata}=current,digest=planBinding(provider,'WORKSPACE_DRAFT_V1',{state:'EDITING',input}),raw=Buffer.from(canonicalPlan(input));
 void ignored;
 try{const envelope=sealProtectedPayload(raw,['WORKSPACE_DRAFT_V1',digest],provider),request={requestId:input.requestId,state:'EDITING',metadata};return JSON.parse(peer(receipt.name,`SELECT organization_master.workspace_save('maker',${quote(JSON.stringify(request))}::jsonb,${quote(digest)},${quote(JSON.stringify(envelope))}::jsonb)::text`)) as {id:string;version:string};}finally{raw.fill(0);}
}
beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);workspace=openOrganizationWorkspace(connection,provider);fixture=await organizationBundleFixture(receipt,connection,provider,catalog);
 if(upgrade){
  const subject=await fixture.x.createSubject(),saved=saveLegacyV3(exactTarget(subject)),restore=revoke('organization_master.access',`actor='maker' AND subject_id=${quote(subject.id)}::uuid AND campus='NORTH' AND permission='READ'`);
  expect(rawRead(saved.id)).toContain(saved.id);legacy={id:saved.id,restore};
  expect((await inspect(receipt)).ledger).toHaveLength(76);expect(()=>workspaceStartupPrefix(migrationFiles(),migrationFiles().slice(0,76))).toThrow('WORKSPACE_MIGRATION_REQUIRED');
  const {upgradeManifestReferenceAccess}=await import('./review-ci-manifest-database.mjs');await upgradeManifestReferenceAccess(receipt);
 }
 expect(workspaceStartupPrefix(migrationFiles(),(await inspect(receipt)).ledger)).toBe(migrationFiles().length);
});
afterAll(async()=>{legacy?.restore();await workspace?.close();await fixture?.close();await catalog?.close();});

test('0076 exact-reference drafts fail closed after the 0077 upgrade',()=>{
 if(!upgrade)return;
 expect(()=>rawRead(legacy!.id)).toThrow('BLOCKED_DEPENDENCY');
});

test('revoked exact ORG01 target access blocks list, read, resave and submit',async()=>{
 const subject=await fixture.x.createSubject(),draft=exactTarget(subject),saved=await workspace.saveDraft('maker',{...draft,requestId:randomUUID()});
 expect(draftMetadata(draft).manifestReferences).toEqual(expect.arrayContaining([expect.objectContaining({dataset:'ORG01',target:expect.objectContaining({id:subject.id,version:subject.version})})]));
 const restore=revoke('organization_master.access',`actor='maker' AND subject_id=${quote(subject.id)}::uuid AND campus='NORTH' AND permission='READ'`);
 try{
  await expect(workspace.readDraft('maker',saved.id)).rejects.toThrow('ACCESS_DENIED');
  expect((await workspace.listDrafts('maker')).some(item=>item.id===saved.id)).toBe(false);
  await expect(workspace.saveDraft('maker',{...draft,id:saved.id,expectedVersion:saved.version,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');
  await expect(workspace.submitDraft('maker',{id:saved.id,expectedVersion:saved.version,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');
 }finally{restore();}
 expect((await workspace.readDraft('maker',saved.id)).content).toMatchObject({domain:'BUNDLE'});
});

test('revoked ORG03 exact-pair access blocks private manifest decryption and mutation',async()=>{
 const subject=await fixture.x.createSubject(),campus=await fixture.x.createCampus();fixture.x.grantPair(subject.id,campus.id);
 const draft=exactPair(subject,campus),saved=await workspace.saveDraft('maker',{...draft,requestId:randomUUID()});
 expect(draftMetadata(draft).manifestReferences).toEqual(expect.arrayContaining([expect.objectContaining({dataset:'ORG03',subject:{id:subject.id,version:subject.version},campus:{id:campus.id,version:campus.version}})]));
 const restore=revoke('organization_master.operating_access',`actor='maker' AND subject_id=${quote(subject.id)}::uuid AND campus_id=${quote(campus.id)}::uuid AND permission='READ'`);
 try{
  await expect(workspace.readDraft('maker',saved.id)).rejects.toThrow('ACCESS_DENIED');
  await expect(workspace.saveDraft('maker',{...draft,id:saved.id,expectedVersion:saved.version,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');
  await expect(workspace.submitDraft('maker',{id:saved.id,expectedVersion:saved.version,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');
 }finally{restore();}
 expect((await workspace.readDraft('maker',saved.id)).content).toMatchObject({domain:'BUNDLE'});
});
