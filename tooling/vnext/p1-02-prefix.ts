import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganization} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {fixture} from './protected-fixture.js';
import {peer,quote} from './lineage.mjs';
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const catalog=await openCatalog(connection,provider),org=openOrganization(connection,provider);
try{
 const f=await fixture(catalog,{textField:true,ruleVersion:'P1_02_PREFIX_'+(process.env['VNEXT_UPGRADE_PREFIX']??'56')}),job=await catalog.importJobCommand('maker',{...f.create,requestId:randomUUID()});
 peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
 const evidence=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO_PREFIX_EVIDENCE'));
 const source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(v=>v.kind==='SOURCE'&&v.status==='PUBLISHED')!;
 const input=await org.stage('maker',{requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',command:{action:'CREATE',validFrom:'2026-01-01T00:00:00',validTo:null,source:{systemId:source.id,versionId:source.versionId,alias:'DEMO_PREFIX',versionNo:1,recordLocator:'DEMO_ROW',recordedAt:'2026-01-01T00:00:00',recordStatus:'PUBLISHED',approvalRef:'DEMO_APPROVAL'},facts:{legalName:'DEMO 升级前主体',entityNature:'DEMO',authority:'DEMO',legalAddress:null,registrationEvidence:evidence.artifactId},identifiers:[]}});
 const requestId=randomUUID(),candidate=await org.plan('maker',{inputId:input.inputId,requestId});await org.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await org.approveApplyUnit('reviewer',candidate);const result=await org.applyUnit('maker',{candidateId:candidate.candidateId,requestId});assert.equal(result.status,'COMMITTED');console.log(JSON.stringify({status:'PREFIX_BUSINESS_FACT_COMMITTED',prefix:process.env['VNEXT_UPGRADE_PREFIX']??'56'}));
}finally{await org.close();await catalog.close();}
