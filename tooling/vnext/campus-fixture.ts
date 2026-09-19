import {randomUUID} from 'node:crypto';
import type {Catalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {conditionMappings} from '../../apps/governance-api/src/modules/governance-catalog/validation-sources.generated.js';
/** Explicit synthetic adoption, never an official administrative division release. */
export async function campusCodeSet(catalog:Catalog,sourceVersionId:string){
 const cmd=<A extends string>(action:A,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'SYNTHETIC_CAMPUS',...extra});
 let dataset=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='DATASET'&&i.code==='ORG02'&&i.status==='PUBLISHED');
 if(!dataset){const d=await catalog.command('maker',cmd('CREATE',{kind:'DATASET',code:'ORG02',values:{name:'DEMO 物理院区'},validFrom:'2026-01-01T00:00:00'}));const r=await catalog.command('maker',cmd('SUBMIT',{target:d.id,expectedHead:d.head}));await catalog.command('reviewer',cmd('PUBLISH',{target:d.id,expectedHead:r.head,reviewDigest:r.reviewDigest}));dataset=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.id===d.id)!;}
 const rule=conditionMappings.find(r=>r.id==='SRC-COND-006')!;
 const definition={ruleVersion:'CAMPUS_'+randomUUID().replaceAll('-','').toUpperCase(),templateVersion:'ORG02_MANUAL_CORE_V1',sourceVersionId,businessKey:['campus_code'],fields:[{code:'campus_code',type:'text',required:'R',privacy:'INTERNAL',condition:'ALWAYS',enumValues:[]},{code:'admin_division_code',type:'text',required:'C',privacy:'INTERNAL',condition:'EVALUATED',enumValues:['DEMO_DIVISION_A','DEMO_DIVISION_B']}],rules:[{id:rule.id,field:rule.field,text:rule.text,status:'MACHINE',version:rule.version}],references:[],codeSets:[{field:'admin_division_code',codeSystem:'SYNTHETIC_ADMIN_DIVISION',version:'DEMO_1',status:'SYNTHETIC_ADOPTED',codes:['DEMO_DIVISION_A','DEMO_DIVISION_B'],validFrom:'2026-01-01T00:00:00',validTo:null,sourceVersionId}]};
 const old=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(c=>c.dataset==='ORG02'&&c.profile==='CORE');
 const draft=await catalog.contractCommand('maker',cmd(old?'REVISE':'CREATE',{...(old?{target:old.id,expectedHead:old.head}:{profile:'CORE'}),datasetVersionId:dataset.versionId,definition,validFrom:'2026-01-01T00:00:00',validTo:null}));
 const approved=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest}));
 const impact=await catalog.contractImpact('reviewer','SYNTHETIC',draft.id,'PUBLISH');
 const published=await catalog.contractCommand('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest,impactDigest:impact.impactDigest}));
 return {reference:{contractId:published.id,contractVersionId:published.versionId,codeSystem:'SYNTHETIC_ADMIN_DIVISION',version:'DEMO_1',code:'DEMO_DIVISION_A',sourceVersionId},published};
}
