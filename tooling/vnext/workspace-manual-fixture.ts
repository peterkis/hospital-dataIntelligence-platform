import {randomUUID} from 'node:crypto';
import type {Catalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';

/** Publishes an explicit synthetic ORG01 transport through the public catalog. */
export async function workspaceManualFixture(catalog:Catalog,options:{ruleVersion?:string}={}){
 const cmd=<A extends string>(action:A,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'SYNTHETIC_WORKSPACE_TRANSPORT',...extra});
 const publish=async(draft:Awaited<ReturnType<Catalog['command']>>)=>{const review=await catalog.command('maker',cmd('SUBMIT',{target:draft.id,expectedHead:draft.head}));return catalog.command('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:review.head,reviewDigest:review.reviewDigest}));};
 let source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='SOURCE'&&i.status==='PUBLISHED'&&i.validTo===null);
 if(!source){await publish(await catalog.command('maker',cmd('CREATE',{kind:'SOURCE',code:'WORKSPACE_SOURCE',values:{name:'合成维护来源',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00'})));source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='SOURCE'&&i.status==='PUBLISHED'&&i.validTo===null);}
 if(!source)throw new Error('WORKSPACE_FIXTURE_SOURCE_REQUIRED');
 let dataset=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='DATASET'&&i.code==='ORG01'&&i.status==='PUBLISHED');
 if(!dataset){await publish(await catalog.command('maker',cmd('CREATE',{kind:'DATASET',code:'ORG01',values:{name:'DEMO 机构登记主体'},validFrom:'2026-01-01T00:00:00'})));dataset=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='DATASET'&&i.code==='ORG01'&&i.status==='PUBLISHED');}
 if(!dataset)throw new Error('WORKSPACE_FIXTURE_DATASET_REQUIRED');
 const old=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(c=>c.dataset==='ORG01'&&c.profile==='CORE'&&!c.definition.templateVersion.endsWith('_BUNDLE_CORE_V1'));
 const field=dataset.payload.fields!.find(f=>f.original.required==='R'&&f.original.type==='text'&&!f.original.ref)!.original;
 const definition={ruleVersion:options.ruleVersion??'ORG01_MANUAL_TEST_'+randomUUID().replaceAll('-','').toUpperCase(),templateVersion:'ORG01_MANUAL_CORE_V1',sourceVersionId:source.versionId,businessKey:[field.code],fields:[{code:field.code,type:field.type,required:'R',privacy:field.privacy,condition:'ALWAYS',enumValues:[]}],rules:[],references:[],codeSets:[]};
 const draft=await catalog.contractCommand('maker',cmd(old?'REVISE':'CREATE',{...(old?{target:old.id,expectedHead:old.head}:{profile:'CORE'}),datasetVersionId:dataset.versionId,definition,validFrom:'2026-01-01T00:00:00',validTo:null}));
 const approval=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest}));
 const impact=await catalog.contractImpact('reviewer','SYNTHETIC',draft.id,'PUBLISH');
 const contract=await catalog.contractCommand('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:approval.head,reviewDigest:approval.reviewDigest,impactDigest:impact.impactDigest}));
 const create={...cmd('CREATE'),contractId:contract.id,contractVersionId:contract.versionId,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}};
 return {dataset,source,contract,create};
}
