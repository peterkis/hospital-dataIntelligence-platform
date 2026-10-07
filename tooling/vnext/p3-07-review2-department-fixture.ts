import {randomUUID} from 'node:crypto';
import type {Catalog,ImportContractItem} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import type {DepartmentStageInput} from '../../apps/governance-api/src/modules/department-master/index.js';
import type {LocationUseScope} from '../../apps/governance-api/src/modules/location-master/index.js';
import type {locationUseFixture} from './p3-07-fixture.js';

type Fixture=Awaited<ReturnType<typeof locationUseFixture>>;
type DepartmentEntry=DepartmentStageInput['entries'][number];
const command=<A extends string>(action:A,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'TEST_REVIEW_DEPARTMENT_SOURCE',...extra});

/** Real ORG04 writes; the caller owns grant revocation, assertions and database disposal. */
export async function createReview2DepartmentFixture(f:Fixture,catalog:Catalog){
 const currentContract=async():Promise<ImportContractItem>=>{
  const contract=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(c=>c.id===f.base.dep.contract.id&&c.status==='PUBLISHED');
  if(!contract||contract.definition.templateVersion!=='ORG04_CORE_V1')throw new Error('REVIEW2_ORG04_CONTRACT_REQUIRED');
  return contract;
 };
 const initialContract=await currentContract(),originalEntry=f.base.dep.entry();
 if(initialContract.definition.sourceVersionId!==f.source.versionId||originalEntry.row.source_system_id!==f.source.id)throw new Error('REVIEW2_INITIAL_SOURCE_MISMATCH');
 const publishDepartment=async(contract:ImportContractItem,entry:DepartmentEntry)=>{
  const job=await catalog.importJobCommand('maker',command('CREATE',{profile:'CORE',contractId:contract.id,contractVersionId:contract.versionId,input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}}));
  const artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:7200},Buffer.from('TEST POLICY ONLY independently reviewed ORG04 source '+entry.row.version_no));
  const value:DepartmentStageInput={requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',profile:'CORE',timePolicy:'LOCAL',entries:[{...entry,evidenceId:artifact.artifactId}]},staged=await f.base.department.stage('maker',value);
  await f.base.department.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'TEST independently verified Department identity and source',evidenceId:artifact.artifactId}]});
  const preview=await f.base.department.preview('maker',{inputId:staged.inputId});
  if(preview.issues.length)throw new Error('REVIEW2_DEPARTMENT_PREVIEW_'+preview.issues.map(issue=>issue.code).join(','));
  const requestId=randomUUID(),candidate=await f.base.department.plan('maker',{inputId:staged.inputId,requestId});
  await f.base.department.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});
  await f.base.department.approveApplyUnit('reviewer',candidate);
  const outcome=await f.base.department.applyUnit('maker',{candidateId:candidate.candidateId,requestId});
  if(outcome.status!=='COMMITTED'||outcome.facts.length!==1)throw new Error('REVIEW2_DEPARTMENT_COMMIT_REQUIRED');
  return outcome;
 };
 const originalDepartmentOutcome=await publishDepartment(initialContract,originalEntry),departmentId=originalDepartmentOutcome.facts[0]!.id,campus:LocationUseScope['campus']={owner:'organization-master/campus',id:await f.locations.newCampus()},purpose=await f.purpose();
 const scope:LocationUseScope={targetType:'ORG',target:{owner:'department-master',id:departmentId},campus,location:await f.newLocation(campus.id),usageType:{owner:'location-master/usage-type',id:purpose.id}};
 const earlyEntry=await f.entry(scope);earlyEntry.row.valid_to='2026-02-01T00:00:00';
 const early=await f.apply(await f.input([earlyEntry])),lateEntry=await f.entry(scope);lateEntry.row.valid_from='2026-04-01T00:00:00';lateEntry.row.valid_to='2026-12-01T00:00:00';
 const late=await f.apply(await f.input([lateEntry]));
 const draftSourceA=await catalog.command('maker',command('CREATE',{kind:'SOURCE',code:'TEST_REVIEW_DEPT_A_'+randomUUID().replaceAll('-','').toUpperCase(),values:{name:'TEST historical Department property source',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:f.source.id},validFrom:'2026-01-01T00:00:00',validTo:null})),submittedSourceA=await catalog.command('maker',command('SUBMIT',{target:draftSourceA.id,expectedHead:draftSourceA.head}));
 const sourceA=await catalog.command('reviewer',command('PUBLISH',{target:draftSourceA.id,expectedHead:submittedSourceA.head,reviewDigest:submittedSourceA.reviewDigest}));
 const reviseContract=async(sourceVersionId:string,label:string)=>{
  const current=await currentContract(),definition={...initialContract.definition,ruleVersion:'ORG04_REVIEW_'+label+'_'+randomUUID().replaceAll('-','').toUpperCase(),sourceVersionId,codeSets:initialContract.definition.codeSets.map(codeSet=>({...codeSet,sourceVersionId}))};
  const draft=await catalog.contractCommand('maker',command('REVISE',{target:current.id,expectedHead:current.head,datasetVersionId:initialContract.datasetVersionId,definition,validFrom:'2026-01-01T00:00:00',validTo:null})),preImpact=await catalog.contractImpact('reviewer','SYNTHETIC',draft.id,'PUBLISH');
  const approved=await catalog.contractCommand('reviewer',command('APPROVE',{target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest,impactDigest:preImpact.impactDigest})),impact=await catalog.contractImpact('reviewer','SYNTHETIC',draft.id,'PUBLISH');
  await catalog.contractCommand('reviewer',command('PUBLISH',{target:draft.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest,impactDigest:impact.impactDigest}));
  return currentContract();
 };
 const reviseDepartmentSource=async(source:{id:string;versionId:string},from:string,to:string,sourceVersion:string,sourceRecordedAt:string)=>{
  const contract=await reviseContract(source.versionId,sourceVersion),history=await f.base.department.history('maker',departmentId),head=history.versions.at(-1);
  if(!head)throw new Error('REVIEW2_DEPARTMENT_HEAD_REQUIRED');
  const entry:DepartmentEntry={...originalEntry,intent:'REVISE',target:{owner:'department-master',id:departmentId,expectedVersion:head.number},row:{...originalEntry.row,source_system_id:source.id,valid_from:from,valid_to:to,version_no:sourceVersion,recorded_at:sourceRecordedAt}};
  const outcome=await publishDepartment(contract,entry);
  if(outcome.facts[0]!.id!==departmentId)throw new Error('REVIEW2_DEPARTMENT_ID_CHANGED');
  return outcome;
 };
 const sourceAOutcome=await reviseDepartmentSource(sourceA,'2026-01-01T00:00:00','','10','2026-01-03T00:00:00');
 const sourceBOutcome=await reviseDepartmentSource(f.source,'2026-03-01T00:00:00.000001','2026-08-01T00:00:00','11','2026-03-02T00:00:00');
 const changeLifecycle=async(action:'SUSPEND'|'RESUME'|'DEPRECATE',effectiveAt:string)=>{
  const contract=await currentContract();
  if(contract.definition.sourceVersionId!==f.source.versionId)throw new Error('REVIEW2_LIFECYCLE_SOURCE_MISMATCH');
  const job=await catalog.importJobCommand('maker',command('CREATE',{profile:'CORE',contractId:contract.id,contractVersionId:contract.versionId,input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}}));
  const artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:7200},Buffer.from('TEST POLICY ONLY independently reviewed Department lifecycle '+action));
  const department=await f.base.department.history('maker',departmentId),lifecycle=await f.wards.lifecycle.history('maker',{id:departmentId}),head=department.versions.at(-1);
  if(!head)throw new Error('REVIEW2_DEPARTMENT_HEAD_REQUIRED');
  type LifecycleInput=Parameters<typeof f.wards.lifecycle.stage>[1];
  const value:LifecycleInput={requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',profile:'CORE',commands:[{action,department:{owner:'department-master',id:departmentId,expectedVersion:head.number,expectedLifecycleHead:lifecycle.lifecycle.at(-1)?.number??'0'},effectiveAt,reason:'TEST independently reviewed Department lifecycle '+action,evidenceId:artifact.artifactId}],impacts:f.base.impacts.map((impact):LifecycleInput['impacts'][number]=>({...impact,determination:'AFFECTED',evidenceId:artifact.artifactId}))};
  const staged=await f.wards.lifecycle.stage('maker',value);
  await f.wards.lifecycle.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST complete independent lifecycle impact attestation',policyApproved:true,materialsAccepted:true,impactReviews:f.base.impactReviews});
  const requestId=randomUUID(),candidate=await f.wards.lifecycle.plan('maker',{inputId:staged.inputId,requestId});
  await f.wards.lifecycle.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});
  await f.wards.lifecycle.approveApplyUnit('reviewer',candidate);
  const outcome=await f.wards.lifecycle.applyUnit('maker',{candidateId:candidate.candidateId,requestId});
  if(outcome.status!=='COMMITTED')throw new Error('REVIEW2_LIFECYCLE_COMMIT_REQUIRED');
  return outcome;
 };
 return {scope,early,late,sourceA,sourceAOutcome,sourceBOutcome,departmentId,originalDepartmentOutcome,originalEntry,currentContract,reviseDepartmentSource,changeLifecycle};
}
