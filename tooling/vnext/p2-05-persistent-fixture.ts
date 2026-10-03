import type {Catalog,KeyProviderPort} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openDepartment,EVOLUTION_IMPACT_DOMAINS,type DepartmentStageInput,type EvolutionStageInput} from '../../apps/governance-api/src/modules/department-master/index.js';
import {catalogClockTime} from '../../apps/governance-api/src/platform/fastify/vnext-local-time.js';
import {evolutionContractDefinition} from './p2-05-fixture.js';
import {peer,quote,identitySQL} from './lineage.mjs';

/** Append synthetic event evidence; reuse the installed Department policy. */
export async function persistentEvolutionFixture(receipt:{name:string;oid:string},catalog:Catalog,provider:KeyProviderPort,connection:string,requestId:(name:string)=>string,freeze:<T extends Record<string,unknown>>(name:string,value:T)=>T){
 const policies=await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'EFFECTIVE',businessAt:catalogClockTime()});
 const departmentPolicy=policies.find(policy=>policy.dataset==='ORG04'&&policy.profile==='CORE'&&policy.status==='PUBLISHED'&&policy.definition.templateVersion==='ORG04_CORE_V1');
 if(!departmentPolicy?.definition.sourceVersionId)throw new Error('P2_01_CURRENT_POLICY_REQUIRED');
 const items=(await catalog.read('maker',{scope:'SYNTHETIC'})).items,source=items.find(item=>item.kind==='SOURCE'&&item.versionId===departmentPolicy.definition.sourceVersionId&&item.status==='PUBLISHED');
 if(!source)throw new Error('SOURCE_NOT_READY');
 const command=<A extends string>(action:A,name:string,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:requestId(name),reason:'SYNTHETIC_ORGANIZATION_EVOLUTION',...extra});
 const publish=async(code:'ORG26'|'ORG27')=>{
  const prior=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.kind==='DATASET'&&item.code===code);let dataset:{id:string;versionId:string};
  if(prior?.status==='PUBLISHED')dataset=prior;
  else{
   const draft=await catalog.command('maker',freeze(code+'-dataset-draft',prior?command('REVISE',code+'-dataset-draft',{target:prior.id,expectedHead:prior.head,values:{name:'TEST POLICY ONLY '+code},validFrom:'2026-01-01T00:00:00'}):command('CREATE',code+'-dataset-draft',{kind:'DATASET',code,values:{name:'TEST POLICY ONLY '+code},validFrom:'2026-01-01T00:00:00'})));
   const submitted=await catalog.command('maker',freeze(code+'-dataset-submit',command('SUBMIT',code+'-dataset-submit',{target:draft.id,expectedHead:draft.head})));
   dataset=await catalog.command('reviewer',freeze(code+'-dataset-publish',command('PUBLISH',code+'-dataset-publish',{target:draft.id,expectedHead:submitted.head,reviewDigest:submitted.reviewDigest})));
  }
  const datasetVersion=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.id===dataset.id)!;
  const fields=datasetVersion.payload.fields!.map(field=>field.original);
  const definition={...evolutionContractDefinition(code,fields,source.versionId),ruleVersion:'ORG_EVOLUTION_CORE_PERIOD_V2'},priorContract=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(policy=>policy.dataset===code&&policy.profile==='CORE');
  let contract=priorContract;
  if(contract?.status!=='PUBLISHED'){
   const name=code+'-contract-exact-period-v2';
   const draft=await catalog.contractCommand('maker',freeze(name+'-draft',priorContract?command('REVISE',name+'-draft',{target:priorContract.id,expectedHead:priorContract.head,datasetVersionId:dataset.versionId,validFrom:datasetVersion.validFrom,validTo:datasetVersion.validTo,definition}):command('CREATE',name+'-draft',{datasetVersionId:dataset.versionId,profile:'CORE',validFrom:datasetVersion.validFrom,validTo:datasetVersion.validTo,definition})));
   const validation=await catalog.contractCommand('maker',command('VALIDATE',name+'-validate',{target:draft.id,expectedHead:draft.head}));
   if(validation.blockers.length)throw new Error(code+': '+validation.blockers.join(','));
   const approved=await catalog.contractCommand('reviewer',freeze(name+'-approve',command('APPROVE',name+'-approve',{target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest})));
   const impact=await catalog.contractImpact('reviewer','SYNTHETIC',draft.id,'PUBLISH');
   const published=await catalog.contractCommand('reviewer',freeze(name+'-publish',command('PUBLISH',name+'-publish',{target:draft.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest,impactDigest:impact.impactDigest})));
   contract=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT',target:published.id}))[0];
  }
  if(!contract||contract.definition.templateVersion!==definition.templateVersion||contract.definition.sourceVersionId!==source.versionId)throw new Error('STALE_VALIDATION');
  peer(receipt.name,identitySQL(receipt)+` INSERT INTO vnext_control.protected_grant SELECT a,${quote(dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
  return {dataset,contract};
 };
 const eventPolicy=await publish('ORG26'),successionPolicy=await publish('ORG27');
 const departmentDataset=items.find(item=>item.kind==='DATASET'&&item.code==='ORG04');if(!departmentDataset)throw new Error('P2_01_CURRENT_POLICY_REQUIRED');
 peer(receipt.name,identitySQL(receipt)+` INSERT INTO vnext_control.protected_grant SELECT a,${quote(departmentDataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
 const departmentJob=await catalog.importJobCommand('maker',freeze('predecessor-job',command('CREATE','predecessor-job',{contractId:departmentPolicy.id,contractVersionId:departmentPolicy.versionId,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}})));
 const departmentProof=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:requestId('predecessor-evidence'),jobId:departmentJob.id,revisionId:departmentJob.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:2592000},Buffer.from('TEST POLICY ONLY new synthetic identity, approval and creation evidence; no patient, HR or consumer facts'));
 const entry=(name:string,from:string):DepartmentStageInput['entries'][number]=>({intent:'CREATE',target:null,origin:'NEW',evidenceId:departmentProof.artifactId,row:{org_id:requestId(name+'-alias'),org_code:'P2_05_TEST_'+requestId(name+'-code'),org_name:'TEST POLICY ONLY '+name,org_short_name:'',org_type:'CLINICAL',established_on:from.slice(0,10),abolished_on:'',establishment_doc:'TEST_CREATION',description:'TEST POLICY ONLY synthetic Department identity',is_virtual:'N',version_no:'1',valid_from:from,valid_to:'',record_status:'ACTIVE',source_system_id:source.id,source_record_id:'TEST/ORG04/'+name,approval_ref:'TEST_APPROVAL',recorded_at:'2026-01-02T00:00:00'}});
 const department=openDepartment(connection,provider);let predecessorId='';
 try{
  const predecessorInput=freeze('predecessor-input',{requestId:requestId('predecessor-input'),jobId:departmentJob.id,revisionId:departmentJob.revisionId,campus:'NORTH' as const,profile:'CORE' as const,timePolicy:'LOCAL' as const,entries:[entry('PREDECESSOR','2026-01-01T00:00:00')]});
  const staged=await department.stage('maker',predecessorInput);
  await department.verify('reviewer',{requestId:requestId('predecessor-verify'),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'TEST POLICY ONLY independent identity creation',evidenceId:departmentProof.artifactId}]});
  const validated=await department.validate('maker',{inputId:staged.inputId});if(validated.decision!=='PASS')throw new Error('PREDECESSOR_VALIDATION: '+JSON.stringify(validated.issues));
  const request=requestId('predecessor-apply'),candidate=await department.plan('maker',{inputId:staged.inputId,requestId:request});
  const prior=await department.resumeOutcome('maker',{candidateId:candidate.candidateId,requestId:request});
  if(!prior){await department.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await department.approveApplyUnit('reviewer',candidate);}
  const result=await department.applyUnit('maker',{candidateId:candidate.candidateId,requestId:request});if(result.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');predecessorId=result.facts[0]!.id;
 }finally{await department.close();}
 // Assessment reads of the permanent code require explicit target/namespace
 // authority, independently of Department write permissions.
 peer(receipt.name,identitySQL(receipt)+` INSERT INTO department_master.mapping_target_access SELECT a,'ORG',${quote(predecessorId)}::uuid,'NORTH' FROM unnest(ARRAY['maker','reviewer']) a ON CONFLICT DO NOTHING;INSERT INTO department_master.identifier_access SELECT a,'SYNTHETIC_DEPARTMENT_CODE','NORTH','READ' FROM unnest(ARRAY['maker','reviewer']) a ON CONFLICT DO NOTHING;`);
 const eventJob=await catalog.importJobCommand('maker',freeze('evolution-job',command('CREATE','evolution-job',{contractId:eventPolicy.contract.id,contractVersionId:eventPolicy.contract.versionId,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}})));
 const proof=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:requestId('evolution-evidence'),jobId:eventJob.id,revisionId:eventJob.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:2592000},Buffer.from('TEST POLICY ONLY explicit Department split, independent external Owner attestations for eight impact domains and destination rules; no automatic migration authorized'));
 const eventAlias=requestId('event-alias'),effectiveAt='2026-06-01T00:00:00',successors=[entry('SUCCESSOR_B',effectiveAt),entry('SUCCESSOR_C',effectiveAt)];
 const input:EvolutionStageInput={requestId:requestId('evolution-stage'),jobId:eventJob.id,revisionId:eventJob.revisionId,campus:'NORTH',profile:'CORE',event:{org_event_id:eventAlias,change_type:'SPLIT',effective_at:effectiveAt,decision_ref:'TEST_P2_05_DECISION',reason:'TEST POLICY ONLY two new identities replacing one synthetic predecessor',historical_reporting_rule:'Keep original assertions and frozen reports; no restatement executed',migration_plan_ref:'',recorded_at:'2026-05-01T00:00:00'},relations:successors.map((successor,index)=>({succession_id:requestId('relation-'+index),org_event_id:eventAlias,from_target_type:'ORG',from_target_id:predecessorId,to_target_type:'ORG',to_target_id:successor.row.org_id,transfer_scope:index?'INPATIENT':'OUTPATIENT',context_rule:index?'TEST POLICY ONLY future inpatient destination C':'TEST POLICY ONLY future outpatient destination B',recorded_at:'2026-05-01T00:00:00'})),predecessors:[{owner:'department-master',id:predecessorId,expectedVersion:'1'}],successors,rename:null,contracts:{successionContractId:successionPolicy.contract.id,successionContractVersionId:successionPolicy.contract.versionId,departmentContractId:departmentPolicy.id,departmentContractVersionId:departmentPolicy.versionId},sourceSystemId:source.id,decisionEvidenceId:proof.artifactId,migrationEvidenceId:null,contextEvidenceId:proof.artifactId,impacts:EVOLUTION_IMPACT_DOMAINS.map(domain=>({domain,determination:'UNAFFECTED',ownerRole:'TEST_ONLY_'+domain,ownerSignatory:'TEST_ONLY_'+domain+'_OWNER',ownerDecisionRef:'TEST_ONLY_'+domain+'_DECISION',requiredAction:'',reason:'TEST POLICY ONLY no operational facts exist for this new synthetic predecessor',evidenceId:proof.artifactId}))};
 Object.assign(input.impacts.find(i=>i.domain==='IDENTIFIER')!,{determination:'AFFECTED',requiredAction:'TEST explicit Identifier Owner closure'});
 return {input:freeze('evolution-input',input),impactReviews:EVOLUTION_IMPACT_DOMAINS.map(domain=>({domain,ownerAttestationAccepted:true,dispositionAccepted:true,reason:'TEST POLICY ONLY independent external Owner material accepted'})),sourceId:source.id,predecessorId};
}
