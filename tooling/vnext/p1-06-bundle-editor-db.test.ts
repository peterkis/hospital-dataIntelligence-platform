import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Check} from 'typebox/value';
import {organizationBundleFixture} from './organization-bundle-fixture.js';
import {openCatalog,LocalSyntheticKeyProvider,parseOrganizationWorkbookBounded,type ImportContractItem,type OrganizationSheet,type ParserField} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationWorkspace,openOrganizationImport,type DraftContent} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {BundleManifest,type ReceiveOrganizationBundleInput} from '../../apps/governance-api/src/modules/organization-master/import/contracts.js';
import {compileOrganizationBundle} from '../../apps/governance-api/src/modules/organization-master/import/compiler.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {createOrganizationBundleClient} from '../../packages/generated-api-client/src/vnext-client.js';
import {bundleRowSourceVersions,bundleRowIntentPatch,bundleLicenseIntentPatch,bundleLicenseSelected,BundleLicenseTargetField} from '../../apps/admin-web/src/vnext/workspace-bundle-row-fields.js';
import {Children,isValidElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Awaited<ReturnType<typeof openCatalog>>,workspace:ReturnType<typeof openOrganizationWorkspace>,bundle:ReturnType<typeof openOrganizationImport>,fixture:Awaited<ReturnType<typeof organizationBundleFixture>>,app:Awaited<ReturnType<typeof buildCatalogServer>>;
let contracts:ImportContractItem[],base:string;
type BundleDraft=Extract<DraftContent,{domain:'BUNDLE'}>;
type Row=Record<string,unknown>;
const wire=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const post=(url:string,payload:Record<string,unknown>)=>app.inject({method:'POST',url,headers:{'x-catalog-actor':'maker'},payload});
const draft=(metadata:ReceiveOrganizationBundleInput):BundleDraft=>({domain:'BUNDLE',campus:'NORTH',metadata,bytesBase64:fixture.workbook().toString('base64')});
async function save(content:BundleDraft,prior?:{id:string;version:string}){
 const requestId=randomUUID();
 const result=await post('/api/vnext/organization-workspace/drafts/save',{...content,requestId,...(prior?{id:prior.id,expectedVersion:prior.version}:{})});expect(result.statusCode,result.body).toBe(200);
 return {...result.json<{id:string;version:string}>(),requestId};
}
beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);workspace=openOrganizationWorkspace(connection,provider);bundle=openOrganizationImport(connection,provider);
 fixture=await organizationBundleFixture(receipt,connection,provider,catalog);
 contracts=await Promise.all(fixture.input.contracts.map(async binding=>{
  const rows=await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:binding.contractId,versionId:binding.contractVersionId});
  const contract=rows.filter(row=>row.status==='PUBLISHED').at(-1);if(!contract)throw new Error('EXACT_FILE_CONTRACT_REQUIRED');return contract;
 }));
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,{owner:bundle,actor:r=>actor(r.headers)},{owner:workspace,actor:r=>actor(r.headers)});
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('SERVER_ADDRESS_REQUIRED');base='http://127.0.0.1:'+address.port;
});
afterAll(async()=>{await app?.close();await workspace?.close();await bundle?.close();await fixture?.close();await catalog?.close();});

test('source-scoped CREATE rows remove stale targets and complete saved workbook approval and Apply',async()=>{
 const rawBefore=JSON.stringify(fixture.values),bytesBefore=fixture.workbook().toString('base64');
 const fields=Object.fromEntries(contracts.map(contract=>[contract.dataset,contract.definition.fields.map(field=>({code:field.code,type:field.type}))])) as Record<OrganizationSheet,ParserField[]>;
 const parsed=await parseOrganizationWorkbookBounded(Buffer.from(bytesBefore,'base64'),fields);
 expect(parsed.structuralStatus).toBe('PARSED');
 const owners={ORG01:'organization-master',ORG02:'organization-master/campus',ORG03:'organization-master/operating-relation'} as const;
 const stale=structuredClone(fixture.input);
 stale.manifest.rows=stale.manifest.rows.map(row=>({...row,target:{owner:owners[row.dataset],id:randomUUID(),expectedVersion:'1'}}));
 const broken=compileOrganizationBundle(parsed,stale.manifest,contracts);
 expect(broken.issues.filter(issue=>issue.code==='EXPLICIT_TARGET_REQUIRED')).toHaveLength(stale.manifest.rows.length);
 const metadata=structuredClone(stale);metadata.requestId=randomUUID();
 metadata.manifest.rows=metadata.manifest.rows.map(row=>wire({...row,...bundleRowIntentPatch({...row,intent:'REVISE'},'CREATE'),sourceVersionId:bundleRowSourceVersions(row.dataset,metadata.contracts,contracts)[0]})) as ReceiveOrganizationBundleInput['manifest']['rows'];
 expect(Check(BundleManifest,metadata.manifest)).toBe(true);
 const compiled=compileOrganizationBundle(parsed,metadata.manifest,contracts);expect(compiled.issues).toEqual([]);expect(compiled.steps).toHaveLength(12);
 for(const step of compiled.steps)expect(step.command['source']).toMatchObject({systemId:fixture.x.source.id,versionId:bundleRowSourceVersions(step.dataset,metadata.contracts,contracts)[0]});
 const content={...draft(metadata),bytesBase64:bytesBefore},saved=await save(content);
 const restored=await workspace.readDraft('maker',saved.id);expect(restored.content).toEqual({...content,requestId:saved.requestId});
 const request={id:saved.id,expectedVersion:saved.version,requestId:randomUUID()};
 const response=await post('/api/vnext/organization-workspace/drafts/submit',request);expect(response.statusCode,response.body).toBe(200);
 const submitted=response.json<{jobId:string;revisionId:string}>(),ref={jobId:submitted.jobId,revisionId:submitted.revisionId};
 const replay=await post('/api/vnext/organization-workspace/drafts/submit',request);expect(replay.json()).toEqual(response.json());
 expect((await bundle.readRevision('maker',ref)).manifest).toEqual(metadata.manifest);
 const writer=createOrganizationBundleClient(base,'maker'),reviewer=createOrganizationBundleClient(base,'reviewer'),admin=createOrganizationBundleClient(base,'bundle-admin');
 const preauth=await admin.preauthorize({...ref,requestId:randomUUID(),grants:[2,3,4].flatMap(row=>['maker','reviewer'].map(actor=>({row,actor,permissions:['READ','CREATE','REVIEW'] as const})))});expect(preauth.response.status,JSON.stringify(preauth.error)).toBe(200);
 const legal=await reviewer.legalReview(ref);expect(legal.response.status,JSON.stringify(legal.error)).toBe(200);
 const verified=await reviewer.verify({...ref,requestId:randomUUID(),digest:legal.data!.digest});expect(verified.response.status,JSON.stringify(verified.error)).toBe(200);
 const requestId=randomUUID(),plan=await writer.plan({...ref,requestId});expect(plan.response.status,JSON.stringify(plan.error)).toBe(200);
 const candidate=plan.data!,review=await reviewer.review({candidateId:candidate.candidateId});expect(review.response.status,JSON.stringify(review.error)).toBe(200);expect(review.data!.commands).toHaveLength(12);
 expect((await reviewer.approve(candidate)).response.status).toBe(200);
 const applied=await writer.apply({candidateId:candidate.candidateId,requestId});expect(applied.response.status,JSON.stringify(applied.error)).toBe(200);expect(applied.data).toMatchObject({status:'COMMITTED'});expect(applied.data!.facts).toHaveLength(12);
 expect((await writer.apply({candidateId:candidate.candidateId,requestId})).data).toEqual(applied.data);
 expect(JSON.stringify(fixture.values)).toBe(rawBefore);expect(restored.content).toHaveProperty('bytesBase64',bytesBefore);
});
test('a persisted incomplete license revision restores its exact target and can explicitly clear and save it',async()=>{
 const subject=await fixture.x.createSubject(),license=await fixture.x.addLicense(subject);
 const metadata=structuredClone(fixture.input);metadata.requestId=randomUUID();
 const row=metadata.manifest.rows.find(row=>row.dataset==='ORG01')!;if(row.dataset!=='ORG01'||!row.license)throw new Error('ORG01_LICENSE_REQUIRED');
 row.intent='REVISE';row.target={owner:'organization-master',id:subject.id,expectedVersion:subject.version};row.license.intent='REVISE';row.license.target=license;
 const content=draft(metadata),saved=await save(content),reopened=openOrganizationWorkspace(connection,provider);
 let restored:BundleDraft;
 try{const value=(await reopened.readDraft('maker',saved.id)).content;if(value.domain!=='BUNDLE')throw new Error('BUNDLE_REQUIRED');restored=value;}finally{await reopened.close();}
 const restoredRows=(restored.metadata['manifest'] as {rows:Row[]}).rows,current=restoredRows.find(row=>row['dataset']==='ORG01')!;
 expect(bundleLicenseSelected(current)).toEqual([{id:license.id,version:license.version}]);
 let patch:Row|undefined;
 const element=BundleLicenseTargetField({actor:'maker',current,disabled:false,onChange:value=>{patch=value;}});
 expect(renderToStaticMarkup(element)).toContain(license.id);
 function clear(node:ReactNode):boolean{
  for(const child of Children.toArray(node))if(isValidElement<{children?:ReactNode;onClick?:()=>void}>(child)){
   if(child.type==='button'){child.props.onClick!();return true;}
   if(child.props.children&&clear(child.props.children))return true;
  }return false;
 }
 expect(clear(element)).toBe(true);expect(patch).toBeDefined();
 const next=wire({...current,...patch});expect(next['license']).not.toHaveProperty('target');expect(next['license']).toMatchObject({intent:'REVISE',namespace:row.license.namespace,evidence:row.license.evidence});
 const nextMetadata=wire({...restored.metadata,manifest:{policy:'ORG_BUNDLE_V1',rows:restoredRows.map(value=>value===current?next:value)}});
 const updated=await save({...restored,metadata:nextMetadata},saved),read=await workspace.readDraft('maker',updated.id);
 expect(read.state).toBe('EDITING');expect((read.content as BundleDraft).metadata).toEqual(nextMetadata);
 const before=await fixture.x.org.historyDetails('maker',subject.id);
 const submitted=await post('/api/vnext/organization-workspace/drafts/submit',{id:updated.id,expectedVersion:updated.version,requestId:randomUUID()});expect(submitted.statusCode,submitted.body).toBe(200);
 const ref=submitted.json<{jobId:string;revisionId:string}>(),validated=await createOrganizationBundleClient(base,'maker').validate({jobId:ref.jobId,revisionId:ref.revisionId,requestId:randomUUID()});
 expect(validated.response.status,JSON.stringify(validated.error)).toBe(200);expect(validated.data!.decision).toBe('FAIL');
 expect(validated.data!.issues).toContainEqual(expect.objectContaining({dataset:'ORG01',code:'EXPLICIT_TARGET_REQUIRED',status:'FAIL'}));
 expect(await fixture.x.org.historyDetails('maker',subject.id)).toEqual(before);
});
test('switching a license sub-operation to CREATE removes the nested target accepted by the strict compiler',async()=>{
 const metadata=structuredClone(fixture.input),row=metadata.manifest.rows.find(row=>row.dataset==='ORG01')!;
 if(row.dataset!=='ORG01'||!row.license)throw new Error('ORG01_LICENSE_REQUIRED');
 row.license.target={owner:'organization-master/license',id:randomUUID(),version:'1',versionId:randomUUID()};
 const fields=Object.fromEntries(contracts.map(contract=>[contract.dataset,contract.definition.fields.map(field=>({code:field.code,type:field.type}))])) as Record<OrganizationSheet,ParserField[]>;
 const parsed=await parseOrganizationWorkbookBounded(fixture.workbook(),fields);
 expect(compileOrganizationBundle(parsed,metadata.manifest,contracts).issues).toContainEqual(expect.objectContaining({dataset:'ORG01',code:'EXPLICIT_TARGET_REQUIRED'}));
 Object.assign(row,bundleLicenseIntentPatch({...row,license:{...row.license,intent:'REVISE'}},'CREATE'));
 const serialized=wire(metadata);expect(serialized.manifest.rows[0]).not.toHaveProperty('license.target');
 expect(compileOrganizationBundle(parsed,serialized.manifest,contracts).issues).toEqual([]);
});
