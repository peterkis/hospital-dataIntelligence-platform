import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
export async function fixture(catalog:Awaited<ReturnType<typeof openCatalog>>,options:{businessKey?:boolean;textField?:boolean}={}) {
  const cmd=<A extends string>(action:A,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'SYNTHETIC_JOB',...extra});
  const publish=async(draft:Awaited<ReturnType<typeof catalog.command>>)=>{
    const review=await catalog.command('maker',cmd('SUBMIT',{target:draft.id,expectedHead:draft.head}));
    return catalog.command('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:review.head,reviewDigest:review.reviewDigest}));
  };
  const used=(await catalog.read('reviewer',{scope:'SYNTHETIC'})).items.filter(item=>item.kind==='DATASET').map(item=>item.code);
  const code=(await catalog.read('maker',{scope:'BASELINE'})).items.find(item=>item.kind==='DATASET'&&!used.includes(item.code))?.code;
  assert.ok(code,'a synthetic dataset fixture is available');
  const dataset=await publish(await catalog.command('maker',cmd('CREATE',{kind:'DATASET',code,values:{name:'合成作业目录'},validFrom:'2026-01-01T00:00:00'})));
  const datasetItem=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.id===dataset.id)!;
  const field=datasetItem.payload.fields!.find(item=>item.original.required==='R'&&(!options.textField||(item.original.type==='text'&&!item.original.ref)))!.original;
  let source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.kind==='SOURCE'&&item.status==='PUBLISHED'&&item.validTo===null);
  const sourceVersion=source?.versionId??(await publish(await catalog.command('maker',cmd('CREATE',{kind:'SOURCE',code:'JOB_SOURCE',values:{name:'合成作业来源',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00'})))).versionId;
  const draft=await catalog.contractCommand('maker',cmd('CREATE',{datasetVersionId:dataset.versionId,profile:'CORE',validFrom:'2026-01-01T00:00:00',validTo:null,definition:{ruleVersion:'JOB_V1',templateVersion:'JOB_V1',sourceVersionId:sourceVersion,fields:[{code:field.code,type:field.type,required:'R',privacy:field.privacy,condition:'ALWAYS',enumValues:[]}],rules:[],references:[],codeSets:[],...(options.businessKey?{businessKey:[field.code]}:{})}}));
  const create={...cmd('CREATE'),contractId:draft.id,contractVersionId:draft.versionId,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}};
  await assert.rejects(catalog.importJobCommand('maker',create),/EXACT_CONTRACT_UNAVAILABLE/,'draft is never an execution contract');
  const approved=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest}));
  const contract=await catalog.contractCommand('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest}));
  return {create,contract,dataset,cmd};
}
