import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {peer} from './lineage.mjs';
import {operatingScenario} from './operating-scenario.js';
import {workspaceManualFixture} from './workspace-manual-fixture.js';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationWorkspace,type DraftContent} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {licenseDependencyOptions} from '../../apps/admin-web/src/vnext/workspace-license-dependencies.js';

const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const from='2026-01-01T00:00:00',cut='2027-01-01T00:00:00';
let catalog:Awaited<ReturnType<typeof openCatalog>>,workspace:ReturnType<typeof openOrganizationWorkspace>,scenario:Awaited<ReturnType<typeof operatingScenario>>,manual:Awaited<ReturnType<typeof workspaceManualFixture>>,app:Awaited<ReturnType<typeof buildCatalogServer>>;
type License=Awaited<ReturnType<typeof scenario.org.readLicenses>>[number];
const reference=(license:License)=>({owner:'organization-master/license' as const,id:license.id,version:license.version,versionId:license.versionId});
const counts=()=>peer(receipt.name,'SELECT jsonb_build_array((SELECT count(*) FROM governance_catalog.apply_candidate),(SELECT count(*) FROM governance_catalog.apply_commit))::text');
const post=(url:string,payload:Record<string,unknown>)=>app.inject({method:'POST',url,headers:{'x-catalog-actor':'maker'},payload});
const draft=(domain:'ORG01'|'ORG03',command:Record<string,unknown>):DraftContent=>{
 const contract=domain==='ORG01'?manual.contract:scenario.codeSet.published;
 return {domain,campus:'NORTH',transport:{contractId:contract.id,contractVersionId:contract.versionId},command:{...scenario.common,validTo:cut,...command}};
};
async function submit(content:DraftContent){
 const saved=await post('/api/vnext/organization-workspace/drafts/save',{...content,requestId:randomUUID()});expect(saved.statusCode,saved.body).toBe(200);
 const value=saved.json<{id:string;version:string}>(),input={id:value.id,expectedVersion:value.version,requestId:randomUUID()};
 const response=await post('/api/vnext/organization-workspace/drafts/submit',input);expect(response.statusCode,response.body).toBe(200);
 const replay=await post('/api/vnext/organization-workspace/drafts/submit',input);expect(replay.statusCode,replay.body).toBe(200);expect(replay.json()).toEqual(response.json());
 return response.json<{inputId:string}>().inputId;
}
async function apply(domain:'ORG01'|'ORG03',content:DraftContent){
 const inputId=await submit(content),owner=domain==='ORG01'?scenario.org:scenario.operating;
 expect(await workspace.preflight('maker',{domain,inputId})).toMatchObject({status:'ELIGIBLE_FOR_CANDIDATE',codes:[]});
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId,requestId});
 await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 const result=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(result.status).toBe('COMMITTED');
 if(result.status!=='COMMITTED')throw new Error('DEPENDENCY_NOT_COMMITTED');
 expect(await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).toEqual(result);
 return result.facts[0]!;
}
async function revokedHistory(){
 const subject=await scenario.createSubject(),license=await scenario.addLicense(subject);
 await scenario.orgApply({...scenario.common,action:'REVOKE_LICENSE',validFrom:cut,target:{id:subject.id,version:subject.version},licenseTarget:{id:license.id,version:license.version},reason:'DEMO_FUTURE_REVOCATION'});
 const response=await post('/api/vnext/organizations/licenses/query',{id:subject.id,mode:'HISTORY'});expect(response.statusCode,response.body).toBe(200);
 const history=response.json<License[]>();expect(history).toHaveLength(2);
 const revoked=history.find(row=>row.revoked)!,eligible=licenseDependencyOptions(history);
 expect(revoked).toMatchObject({id:license.id,version:'2',revoked:true});
 expect(eligible).toEqual([expect.objectContaining({id:license.id,version:'1',revoked:false})]);
 return {subject,history,revoked,eligible};
}
beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);workspace=openOrganizationWorkspace(connection,provider);
 scenario=await operatingScenario(receipt,connection,provider,catalog);manual=await workspaceManualFixture(catalog);
 expect(manual.source.versionId).toBe(scenario.source.versionId);
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',{owner:scenario.org,actor:r=>actor(r.headers)},undefined,{owner:scenario.operating,actor:r=>actor(r.headers)},undefined,{owner:workspace,actor:r=>actor(r.headers)});
});
afterAll(async()=>{await app?.close();await scenario?.close();await workspace?.close();await catalog?.close();});

test('registration rejects a revoked assertion but accepts its non-revoked predecessor for the earlier covered period',async()=>{
 const {subject,history,revoked,eligible}=await revokedHistory();
 const command={action:'VERIFY_REGISTRATION',target:{id:subject.id,version:subject.version},creditCodeStatus:'NOT_APPLICABLE',evidence:scenario.artifact.artifactId};
 const before=await scenario.org.historyDetails('maker',subject.id),beforeCounts=counts();
 const invalid=await submit(draft('ORG01',{...command,licenseTargets:[{id:revoked.id,version:revoked.version}]}));
 expect(await workspace.preflight('maker',{domain:'ORG01',inputId:invalid})).toMatchObject({status:'BLOCKED',codes:['STALE_VALIDATION']});
 await expect(scenario.org.plan('maker',{inputId:invalid,requestId:randomUUID()})).rejects.toThrow('STALE_VALIDATION');
 expect(await scenario.org.historyDetails('maker',subject.id)).toEqual(before);expect(counts()).toBe(beforeCounts);
 const selected=eligible.map(({id,version})=>({id,version}));
 const result=await apply('ORG01',draft('ORG01',{...command,licenseTargets:selected}));expect(result.owner).toBe('organization-master/verification');
 const after=await scenario.org.historyDetails('maker',subject.id);expect(after.licenses).toEqual(history);expect(after.verifications).toHaveLength(before.verifications.length+1);
});
test('scope verification rejects a revoked exact reference but commits using the historical non-revoked dependency',async()=>{
 const {subject,history,revoked,eligible}=await revokedHistory(),campus=await scenario.createCampus();scenario.grantPair(subject.id,campus.id);
 const command={action:'VERIFY_SCOPE',...scenario.endpoints(subject,campus),evidence:scenario.artifact.artifactId};
 const facts={catalog:scenario.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO historical verified scope'};
 const query={kind:'SCOPE' as const,mode:'LIST' as const,subjectId:subject.id,campusId:campus.id,businessAt:from};
 const before=await scenario.operating.read('maker',query),beforeCounts=counts();
 const invalid=await submit(draft('ORG03',{...command,facts:{...facts,license:reference(revoked)}}));
 expect(await workspace.preflight('maker',{domain:'ORG03',inputId:invalid})).toMatchObject({status:'BLOCKED',codes:['BLOCKED_DEPENDENCY']});
 await expect(scenario.operating.plan('maker',{inputId:invalid,requestId:randomUUID()})).rejects.toThrow('BLOCKED_DEPENDENCY');
 expect(await scenario.operating.read('maker',query)).toEqual(before);expect(counts()).toBe(beforeCounts);
 const selected=reference(eligible[0]!);
 const result=await apply('ORG03',draft('ORG03',{...command,facts:{...facts,license:selected}}));expect(result.owner).toBe('organization-master/license-scope');
 const committed=await scenario.operating.read('maker',{kind:'SCOPE',mode:'EXACT',id:result.id,version:result.version});
 expect(committed[0]!.facts).toMatchObject({license:selected});
 expect((await scenario.org.historyDetails('maker',subject.id)).licenses).toEqual(history);
});
