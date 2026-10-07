import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
export async function fixture(catalog:Awaited<ReturnType<typeof openCatalog>>,options:{businessKey?:boolean;textField?:boolean;twoTextFields?:boolean;optionalTextField?:boolean;ruleVersion?:string;reusePublishedContract?:boolean}={}) {
  const cmd=<A extends string>(action:A,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'SYNTHETIC_JOB',...extra});
  if(options.reusePublishedContract){
    // Persistent smoke fixtures reuse exact published input bindings without revising old evidence.
    const items=(await catalog.read('maker',{scope:'SYNTHETIC'})).items;
    const contracts=await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'});
    const coversFixtureWindow=(item:{validFrom:string;validTo:string|null})=>{
      const [seconds,fraction='']=item.validFrom.split('.');
      return item.validTo===null&&`${seconds}.${fraction.padEnd(6,'0')}`<='2026-01-01T00:00:00.000000';
    };
    const ruleVersion=options.ruleVersion??'JOB_V1';
    for(const dataset of items){
      if(dataset.kind!=='DATASET'||dataset.scope!=='SYNTHETIC'||dataset.status!=='PUBLISHED'||dataset.payload.adopted?.name!=='合成作业目录'||!coversFixtureWindow(dataset))continue;
      const fields=dataset.payload.fields??[];
      if(options.optionalTextField&&!fields.some(f=>f.original.type==='text'&&f.original.required==='O'&&!f.original.ref))continue;
      if(options.twoTextFields&&(fields.filter(f=>f.original.type==='text'&&f.original.required!=='C'&&!f.original.ref).length<2||!fields.some(f=>f.original.type==='text'&&f.original.required==='R'&&!f.original.ref)))continue;
      const field=fields.find(f=>f.original.required==='R'&&(!options.textField||(f.original.type==='text'&&!f.original.ref)))?.original;
      if(!field)continue;
      const contract=contracts.find(c=>{
        const definition=c.definition,binding=definition.fields[0];
        return c.status==='PUBLISHED'&&c.profile==='CORE'&&c.dataset===dataset.code&&c.datasetVersionId===dataset.versionId&&coversFixtureWindow(c)
          &&definition.ruleVersion===ruleVersion&&definition.templateVersion===ruleVersion
          &&definition.fields.length===1&&binding?.code===field.code&&binding.type===field.type&&binding.privacy===field.privacy&&binding.required==='R'&&binding.condition==='ALWAYS'&&binding.enumValues.length===0
          &&definition.rules.length===0&&definition.references.length===0&&definition.codeSets.length===0
          &&(options.businessKey===false?definition.businessKey===undefined:definition.businessKey?.length===1&&definition.businessKey[0]===field.code)
          &&items.some(source=>source.kind==='SOURCE'&&source.scope==='SYNTHETIC'&&source.status==='PUBLISHED'&&source.payload.environment==='SYNTHETIC'&&source.versionId===definition.sourceVersionId&&coversFixtureWindow(source));
      });
      if(!contract)continue;
      const create={...cmd('CREATE'),contractId:contract.id,contractVersionId:contract.versionId,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}};
      return {create,contract,dataset,cmd,sourceVersionId:contract.definition.sourceVersionId,draftExecution:{status:'NOT_RUN',decision:'REUSED_PUBLISHED_CONTRACT'}};
    }
    throw new Error('PUBLISHED_SYNTHETIC_FIXTURE_UNAVAILABLE');
  }
  const publish=async(draft:Awaited<ReturnType<typeof catalog.command>>)=>{
    const review=await catalog.command('maker',cmd('SUBMIT',{target:draft.id,expectedHead:draft.head}));
    return catalog.command('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:review.head,reviewDigest:review.reviewDigest}));
  };
  const used=(await catalog.read('reviewer',{scope:'SYNTHETIC'})).items.filter(item=>item.kind==='DATASET').map(item=>item.code);
  const code=(await catalog.read('maker',{scope:'BASELINE'})).items.find(item=>item.kind==='DATASET'&&!used.includes(item.code)&&(!options.optionalTextField||(item.payload.fields??[]).some(f=>f.original.type==='text'&&f.original.required==='O'&&!f.original.ref))&&(!options.twoTextFields||((item.payload.fields??[]).filter(f=>f.original.type==='text'&&f.original.required!=='C'&&!f.original.ref).length>=2&&(item.payload.fields??[]).some(f=>f.original.type==='text'&&f.original.required==='R'&&!f.original.ref))))?.code;
  assert.ok(code,'a synthetic dataset fixture is available');
  const dataset=await publish(await catalog.command('maker',cmd('CREATE',{kind:'DATASET',code,values:{name:'合成作业目录'},validFrom:'2026-01-01T00:00:00'})));
  const datasetItem=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.id===dataset.id)!;
  const field=datasetItem.payload.fields!.find(item=>item.original.required==='R'&&(!options.textField||(item.original.type==='text'&&!item.original.ref)))!.original;
  let source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.kind==='SOURCE'&&item.status==='PUBLISHED'&&item.validTo===null);
  const sourceVersion=source?.versionId??(await publish(await catalog.command('maker',cmd('CREATE',{kind:'SOURCE',code:'JOB_SOURCE',values:{name:'合成作业来源',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00'})))).versionId;
  const draft=await catalog.contractCommand('maker',cmd('CREATE',{datasetVersionId:dataset.versionId,profile:'CORE',validFrom:'2026-01-01T00:00:00',validTo:null,definition:{ruleVersion:options.ruleVersion??'JOB_V1',templateVersion:options.ruleVersion??'JOB_V1',sourceVersionId:sourceVersion,fields:[{code:field.code,type:field.type,required:'R',privacy:field.privacy,condition:'ALWAYS',enumValues:[]}],rules:[],references:[],codeSets:[],...(options.businessKey!==false?{businessKey:[field.code]}:{})}}));
  const create={...cmd('CREATE'),contractId:draft.id,contractVersionId:draft.versionId,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}};
  await assert.rejects(catalog.importJobCommand('maker',create),/EXACT_CONTRACT_UNAVAILABLE/,'draft is never an execution contract');
  const approved=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest}));
  const contract=await catalog.contractCommand('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest}));
  return {create,contract,dataset,cmd,sourceVersionId:sourceVersion,draftExecution:{status:'PASS',decision:'EXACT_CONTRACT_UNAVAILABLE'}};
}
