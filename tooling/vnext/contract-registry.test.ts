import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openCatalog } from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import { buildCatalogServer } from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {Client} from 'pg';
const require=createRequire(import.meta.url);
const {peer,quote}=await import('./lineage.mjs');
const testReceipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
assert.equal(testReceipt.purpose,'TEMPORARY_VALIDATION');

test('53 source contracts remain unapproved and readable through the current owner', async () => {
  const catalog=await openCatalog();
  try {
    const drafts=await catalog.contractRead('maker',{scope:'BASELINE',mode:'CURRENT'});
    assert.equal(drafts.length,53);
    assert.ok(drafts.every(draft=>draft['status']==='DRAFT'));
    await assert.rejects(catalog.contractRead('outsider',{scope:'BASELINE',mode:'CURRENT'}),/ACCESS_DENIED/);
    const app=await buildCatalogServer(catalog);
    try {
      const response=await app.inject({method:'GET',url:'/api/vnext/contracts?scope=BASELINE&mode=CURRENT',headers:{'x-catalog-actor':'maker'}});
      assert.equal(response.statusCode,200);
      assert.equal(response.json().total,53);
      assert.ok(response.json().items[0].schemas,'persisted schemas are part of the current response contract');
      assert.equal((await app.inject({method:'GET',url:'/api/vnext/contracts?scope=BASELINE&mode=CURRENT',headers:{'x-catalog-actor':'outsider'}})).statusCode,403);
    } finally { await app.close(); }
  } finally { await catalog.close(); }
});

test('P0-02-AC-01: contract definition rejects unknown fields', async () => {
  const catalog = await openCatalog();
  try {
    await assert.rejects(catalog.contractCommand('maker', {
      action: 'CREATE', scope: 'SYNTHETIC', requestId: randomUUID(),
      reason: 'SYNTHETIC_CONTRACT', arbitrary: true,
    }), /CLOSED_INPUT_REQUIRED/);
  } finally { await catalog.close(); }
});

test('GOV09 registers immutable parameter definitions under an actual source owner permission',async()=>{
 const catalog=await openCatalog();
 const cmd=(action:string,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_PARAMETER',...extra});
 try{
  const source=await catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_PARAMETER',kind:'SOURCE',code:'GOV09_SYSTEM',values:{name:'合成参数系统',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'SYNTHETIC_PARAMETER_OWNER',technicalRole:'TEST',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00',validTo:null});
  const review=await catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_PARAMETER',target:source.id,expectedHead:source.head});
  const published=await catalog.command('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_PARAMETER',target:source.id,expectedHead:review.head,reviewDigest:review.reviewDigest});
  const input=cmd('CREATE',{systemVersionId:published.versionId,parameterKey:'WARD_RULE',group:'CARE',campus:'SYNTHETIC_ALL',definition:{kind:'VALUE_SCHEMA_V1',valueType:'INTEGER',enumValues:[],description:'仅定义参数值结构，不保存运营参数值'},validFrom:'2026-01-01T00:00:00',validTo:'2026-07-01T00:00:00'});
  const draft=await catalog.parameterCommand('maker',input);
  assert.equal(draft.status,'DRAFT');
  await assert.rejects(catalog.parameterCommand('maker-alias',cmd('APPROVE',{target:draft.id,versionId:draft.versionId,reviewDigest:draft.reviewDigest})),/SELF_REVIEW_FORBIDDEN/);
  const approved=await catalog.parameterCommand('reviewer',cmd('APPROVE',{target:draft.id,versionId:draft.versionId,reviewDigest:draft.reviewDigest}));
  assert.equal(approved.status,'APPROVED');
  assert.equal((await catalog.parameterRead('maker',{scope:'SYNTHETIC',versionId:approved.versionId}))[0]?.ownerRole,'SYNTHETIC_PARAMETER_OWNER');
  const api=await buildCatalogServer(catalog);
  try{
   assert.equal((await api.inject({method:'POST',url:'/api/vnext/parameter-definitions/commands',headers:{'x-catalog-actor':'maker'},payload:input})).statusCode,200);
   const response=await api.inject({method:'GET',url:'/api/vnext/parameter-definitions?scope=SYNTHETIC&versionId='+approved.versionId,headers:{'x-catalog-actor':'reviewer'}});
   assert.equal(response.statusCode,200);assert.equal(response.json().items[0].ownerRole,'SYNTHETIC_PARAMETER_OWNER');
  }finally{await api.close();}
  await assert.rejects(catalog.parameterCommand('maker',{...input,requestId:randomUUID(),parameterKey:'UNSAFE',value:'runtime value'}),/CLOSED_INPUT_REQUIRED/);
  await assert.rejects(catalog.parameterCommand('maker',{...input,requestId:randomUUID(),parameterKey:'DUPLICATE_CODES',definition:{kind:'VALUE_SCHEMA_V1',valueType:'INTEGER',enumValues:['1','1'],description:'合成重复枚举'}}),/DUPLICATE_ENUM/);
  await assert.rejects(catalog.parameterRead('outsider',{scope:'SYNTHETIC',versionId:approved.versionId}),/ACCESS_DENIED/);
  const datasetDraft=await catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_PARAMETER',kind:'DATASET',code:'ORG16',values:{name:'合成参数引用目录'},validFrom:'2026-01-01T00:00:00'});
  const datasetReview=await catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_PARAMETER',target:datasetDraft.id,expectedHead:datasetDraft.head});
  const dataset=await catalog.command('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_PARAMETER',target:datasetDraft.id,expectedHead:datasetReview.head,reviewDigest:datasetReview.reviewDigest});
  const reference={field:'rule_ref',target:'GOV09.config_id',status:'DECLARED_PARAMETER',parameterVersionId:approved.versionId,parameterDigest:approved.reviewDigest};
  const contractInput=cmd('CREATE',{datasetVersionId:dataset.versionId,profile:'CORE',validFrom:'2026-01-01T00:00:00',validTo:'2026-06-01T00:00:00',definition:{ruleVersion:'PARAMETER_REF_1',templateVersion:'PARAMETER_REF_1',sourceVersionId:published.versionId,fields:[{code:'rule_ref',type:'id',required:'O',privacy:'INTERNAL',condition:'OPTIONAL',enumValues:[]}],rules:[],codeSets:[],references:[reference]}});
  const otherParameter=await catalog.parameterCommand('maker',{...input,requestId:randomUUID(),parameterKey:'OTHER_WARD_RULE'});
  const otherApproval=await catalog.parameterCommand('reviewer',cmd('APPROVE',{target:otherParameter.id,versionId:otherParameter.versionId,reviewDigest:otherParameter.reviewDigest}));
  const otherReference={...reference,parameterVersionId:otherApproval.versionId,parameterDigest:otherApproval.reviewDigest};
  const duplicateDefinition={...(contractInput['definition'] as Record<string,unknown>),references:[reference,otherReference]};
  await assert.rejects(catalog.contractCommand('maker',{...contractInput,requestId:randomUUID(),definition:duplicateDefinition}),/DUPLICATE_REFERENCE_FIELD/,'two valid parameter versions cannot govern one reference field');
  await assert.rejects(catalog.contractCommand('maker',{...contractInput,requestId:randomUUID(),validTo:'2026-08-01T00:00:00'}),/PARAMETER_PERIOD_NOT_COVERED/);
  const contract=await catalog.contractCommand('maker',contractInput);
  await assert.rejects(catalog.contractCommand('maker',cmd('REVISE',{target:contract.id,expectedHead:contract.head,validFrom:contractInput['validFrom'],validTo:contractInput['validTo'],definition:{...duplicateDefinition,ruleVersion:'DUPLICATE_REF_2'}})),/DUPLICATE_REFERENCE_FIELD/);
  // Owned fresh database only: emulate a candidate accepted before migration 0015.
  const fixtureDefinition=(definition:Record<string,unknown>)=>peer(testReceipt.name,`BEGIN; ALTER TABLE governance_catalog.import_contract_version DISABLE TRIGGER import_contract_version_immutable; UPDATE governance_catalog.import_contract_version SET definition=${quote(JSON.stringify(definition))}::jsonb WHERE id=${quote(contract.versionId)}::uuid; ALTER TABLE governance_catalog.import_contract_version ENABLE TRIGGER import_contract_version_immutable; COMMIT;`);
  fixtureDefinition(duplicateDefinition);
  try{
   const oldCandidate=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT',target:contract.id}))[0]!;
   const validation=await catalog.contractCommand('maker',cmd('VALIDATE',{target:contract.id,expectedHead:contract.head,reviewDigest:oldCandidate.reviewDigest}));
   assert.ok(validation.blockers.includes('DUPLICATE_REFERENCE_FIELD'));
   await assert.rejects(catalog.contractCommand('reviewer',cmd('APPROVE',{target:contract.id,expectedHead:contract.head,reviewDigest:oldCandidate.reviewDigest})),/CONTRACT_VALIDATION_BLOCKED/);
  }finally{fixtureDefinition(contractInput['definition'] as Record<string,unknown>);}
  const contractApproval=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:contract.id,expectedHead:contract.head,reviewDigest:contract.reviewDigest}));
  await catalog.contractCommand('reviewer',cmd('PUBLISH',{target:contract.id,expectedHead:contractApproval.head,reviewDigest:contractApproval.reviewDigest}));
  await catalog.parameterCommand('maker',cmd('REVISE',{target:draft.id,expectedCurrentVersion:draft.versionId,systemVersionId:published.versionId,group:'CARE',campus:'SYNTHETIC_ALL',definition:{kind:'VALUE_SCHEMA_V1',valueType:'INTEGER',enumValues:['1','2'],description:'新的未批准参数结构'},validFrom:'2026-01-01T00:00:00',validTo:'2026-07-01T00:00:00'}));
  assert.equal((await catalog.parameterRead('maker',{scope:'SYNTHETIC',target:draft.id,mode:'APPROVED'}))[0]?.versionId,approved.versionId,'an unapproved parameter candidate does not replace the accepted definition');
  const pinned=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT',target:contract.id}))[0]!;
  assert.equal(pinned.definition.references[0]?.['parameterVersionId'],approved.versionId);
  const newerContract=await catalog.contractCommand('maker',cmd('REVISE',{target:contract.id,expectedHead:pinned.head,validFrom:contractInput['validFrom'],validTo:contractInput['validTo'],definition:{...(contractInput['definition'] as Record<string,unknown>),ruleVersion:'PARAMETER_REF_2',references:[otherReference]}}));
  peer(testReceipt.name,`DELETE FROM governance_catalog.parameter_grant WHERE parameter_id=${quote(otherParameter.id)}::uuid AND actor_code='maker' AND permission='READ';`);
  const schemaApi=await buildCatalogServer(catalog);
  try{
   const schemaResponse=await schemaApi.inject({method:'GET',url:`/api/vnext/contracts/${contract.id}/schema?scope=SYNTHETIC&versionId=${contract.versionId}`,headers:{'x-catalog-actor':'maker'}});
   assert.equal(schemaResponse.statusCode,200,'an inaccessible newer parameter must not block an authorized exact-version schema');
   assert.equal(schemaResponse.json().contractVersionId,contract.versionId);
   assert.equal((await schemaApi.inject({method:'GET',url:`/api/vnext/contracts/${contract.id}/schema?scope=SYNTHETIC&versionId=${newerContract.versionId}`,headers:{'x-catalog-actor':'maker'}})).statusCode,403);
   assert.equal((await schemaApi.inject({method:'GET',url:`/api/vnext/contracts/${randomUUID()}/schema?scope=SYNTHETIC&versionId=${contract.versionId}`,headers:{'x-catalog-actor':'maker'}})).statusCode,404,'version must belong to the requested contract');
  }finally{await schemaApi.close();}
  peer(testReceipt.name,`DELETE FROM governance_catalog.parameter_grant WHERE parameter_id=${quote(draft.id)}::uuid AND actor_code='maker' AND permission='READ';`);
  await assert.rejects(catalog.contractCommand('maker',contractInput),/ACCESS_DENIED/,'source ownership alone does not bypass an exact parameter read revocation');
 }finally{await catalog.close();}
});

test('published complete versions select at R before checking B, with no fallback to an older interval',async()=>{
 const catalog=await openCatalog();
 const cmd=(action:string,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_TEMPORAL',...extra});
 try{
  const draft=await catalog.command('maker',cmd('CREATE',{kind:'DATASET',code:'ORG02',values:{name:'合成期间契约目录'},validFrom:'2026-01-01T00:00:00'}));
  const review=await catalog.command('maker',cmd('SUBMIT',{target:draft.id,expectedHead:draft.head}));
  const dataset=await catalog.command('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:review.head,reviewDigest:review.reviewDigest}));
  const source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.code==='GOV09_SYSTEM')!;
  const definition={ruleVersion:'TIME_1',templateVersion:'TIME_1',sourceVersionId:source.versionId,fields:[{code:'campus_code',type:'text',required:'R',privacy:'INTERNAL',condition:'ALWAYS',enumValues:[]}],rules:[],references:[],codeSets:[]};
  const publish=async(item:Awaited<ReturnType<typeof catalog.contractCommand>>)=>{
   const approved=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:item.id,expectedHead:item.head,reviewDigest:item.reviewDigest}));
   return catalog.contractCommand('reviewer',cmd('PUBLISH',{target:item.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest}));
  };
  const first=await publish(await catalog.contractCommand('maker',cmd('CREATE',{datasetVersionId:dataset.versionId,profile:'CORE',definition,validFrom:'2026-01-01T00:00:00',validTo:null})));
  const read=(businessAt:string,asOf?:string)=>catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'EFFECTIVE',target:first.id,businessAt,...(asOf?{asOf}:{})});
  const futureDraft=await catalog.contractCommand('maker',cmd('REVISE',{target:first.id,expectedHead:first.head,definition:{...definition,ruleVersion:'TIME_2'},validFrom:'2026-07-01T00:00:00',validTo:null}));
  assert.equal((await read('2026-06-01T00:00:00'))[0]?.versionId,first.versionId);
  const future=await publish(futureDraft);
  assert.equal((await read('2026-06-01T00:00:00')).length,0,'future replacement is not scheduled activation preserving the predecessor');
  assert.equal((await read('2026-07-01T00:00:00'))[0]?.versionId,future.versionId);
  const shortened=await publish(await catalog.contractCommand('maker',cmd('REVISE',{target:first.id,expectedHead:future.head,definition:{...definition,ruleVersion:'TIME_3'},validFrom:'2026-07-01T00:00:00',validTo:'2026-08-01T00:00:00'})));
  assert.equal((await read('2026-07-31T23:59:59'))[0]?.versionId,shortened.versionId);
  assert.equal((await read('2026-08-01T00:00:00')).length,0,'exclusive end does not fall back to the older open interval');
  assert.equal((await read('2026-06-01T00:00:00',first.recordedAt))[0]?.versionId,first.versionId);
  assert.equal((await read('2026-09-01T00:00:00',future.recordedAt))[0]?.versionId,future.versionId);
 }finally{await catalog.close();}
});

test('contract draft fixes an existing dataset version and allocates its stable identity on the server', async () => {
  const catalog = await openCatalog();
  try {
    const publishCatalog = async (draft:Awaited<ReturnType<typeof catalog.command>>) => {
      const review=await catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_CONTRACT',target:draft.id,expectedHead:draft.head});
      return catalog.command('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_CONTRACT',target:review.id,expectedHead:review.head,reviewDigest:review.reviewDigest});
    };
    const dataset = await publishCatalog(await catalog.command('maker', { action:'CREATE', kind:'DATASET', code:'ORG01', scope:'SYNTHETIC', requestId:randomUUID(), reason:'SYNTHETIC_CONTRACT', values:{name:'合成契约测试目录'}, validFrom:'2026-01-01T00:00:00' }));
    const rootSource=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.kind==='SOURCE'&&item.code==='GOV09_SYSTEM');
    const source = await publishCatalog(await catalog.command('maker',{action:'CREATE',kind:'SOURCE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_CONTRACT',code:'CONTRACT_SOURCE',values:{name:'合成契约来源',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:rootSource?.id??'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00'}));
    const input = { action:'CREATE', scope:'SYNTHETIC', requestId:randomUUID(), reason:'SYNTHETIC_CONTRACT', datasetVersionId:dataset.versionId, profile:'CORE', validFrom:'2026-01-01T00:00:00', validTo:null,
      definition:{ruleVersion:'SYNTHETIC_1',templateVersion:'SYNTHETIC_1',fields:[{code:'legal_name',type:'text',required:'R',privacy:'INTERNAL',condition:'ALWAYS',enumValues:[]}],codeSets:[],rules:[],references:[],sourceVersionId:source.versionId} };
    await assert.rejects(catalog.contractCommand('maker',{...input,requestId:randomUUID(),impactDigest:'0'.repeat(64)}),/CLOSED_INPUT_REQUIRED/);
    await assert.rejects(catalog.contractCommand('maker',{...input,requestId:randomUUID(),definition:{...input.definition,fields:[{...input.definition.fields[0],enumValues:['A','A']}],codeSets:[{field:'legal_name',codeSystem:'SYNTHETIC_CODES',version:'SYNTHETIC_1',status:'SYNTHETIC_ADOPTED',codes:['A','A'],validFrom:input.validFrom,validTo:null,sourceVersionId:source.versionId}]}}),/DUPLICATE_ENUM/);
    for(const [code,type,literal,required] of [['version_no','integer','A','R'],['license_valid_to','date','2026-02-30','O'],['valid_from','datetime','2026-01-01T24:00:00','R']]){
     await assert.rejects(catalog.contractCommand('maker',{...input,requestId:randomUUID(),definition:{...input.definition,fields:[{code,type,required,privacy:'INTERNAL',condition:required==='R'?'ALWAYS':'OPTIONAL',enumValues:[literal]}],codeSets:[{field:code,codeSystem:'SYNTHETIC_CODES',version:'SYNTHETIC_1',status:'SYNTHETIC_ADOPTED',codes:[literal],validFrom:input.validFrom,validTo:null,sourceVersionId:source.versionId}]}}),/ENUM_LITERAL_TYPE_MISMATCH/);
    }
    for(const [type,literal,valid] of [['integer','1',true],['integer','01',false],['decimal','1.25',true],['decimal','A',false],['decimal','1e3',false],['date','2024-02-29',true],['date','2026-02-30',false],['datetime','2026-01-01T00:00:00.123456',true],['datetime','2026-01-01T00:00:00Z',false]] as const){
     assert.equal(peer(testReceipt.name,`SELECT governance_catalog.contract_enum_types_valid(${quote(JSON.stringify({fields:[{type,enumValues:[literal]}]}))}::jsonb);`),valid?'t':'f');
    }
    const api=await buildCatalogServer(catalog);
    try {
      const created=await api.inject({method:'POST',url:'/api/vnext/contracts/commands',headers:{'x-catalog-actor':'maker'},payload:input});
      assert.equal(created.statusCode,200,'valid maintenance CREATE must not require server-generated fields');
    }finally{await api.close();}
    const result = await catalog.contractCommand('maker',input);
    assert.equal(result['status'],'DRAFT');
    assert.equal(result.head,'1','new contract lifecycle starts at sequence 1 despite unrelated events');
    assert.match(String(result['id']), /^[a-f0-9-]{36}$/);
    assert.equal(result['datasetVersionId'],dataset.versionId);
    assert.deepEqual(await catalog.contractCommand('maker-alias',input),result);
    const command = (action:string, current:Record<string,unknown>) => ({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_CONTRACT',target:current['id'],expectedHead:current['head'],reviewDigest:current['reviewDigest']});
    const validation = await catalog.contractCommand('maker',command('VALIDATE',result));
    assert.equal(validation['decision'],'ACCEPT');
    await assert.rejects(catalog.contractCommand('maker-alias',command('APPROVE',validation)), /SELF_REVIEW_FORBIDDEN/);
    const approved = await catalog.contractCommand('reviewer',command('APPROVE',validation));
    assert.equal(approved['status'],'APPROVED');
    const published = await catalog.contractCommand('reviewer',command('PUBLISH',approved));
    assert.equal(published['status'],'PUBLISHED');
    assert.equal(published.head,'3','draft/approval/publication allocate within this contract only');
    assert.equal(published['adapterReadiness'],'NOT_READY');
    const retry = await catalog.contractCommand('reviewer',command('PUBLISH',published));
    assert.equal(retry['head'],published['head'],'P0-02-AC-03: same rule version publication creates no second event');
    const impact=await catalog.sourceImpact('reviewer','SYNTHETIC',source.id,'RETIRE');
    assert.ok(impact.contractOpening.some(row=>row['contractId']===published['id']),'source impact preview includes a published contract consumer');
    const retireSource={action:'RETIRE' as const,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'SYNTHETIC_CONTRACT',target:source.id,expectedHead:source.head,reviewDigest:source.reviewDigest};
    await assert.rejects(catalog.command('reviewer',retireSource),/IMPACT_REVIEW_MISMATCH/);
    await catalog.command('reviewer',{...retireSource,impactDigest:impact.impactDigest});
    const cases=await catalog.contractImpactCases('reviewer','SYNTHETIC',String(published['id']));
    assert.equal(cases.filter(row=>row['eventSequence']===1).length,1);
    const revise = (definition:Record<string,unknown>,current:Record<string,unknown>=published) => ({action:'REVISE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_CONTRACT',target:current['id'],expectedHead:current['head'],validFrom:input.validFrom,validTo:null,definition});
    await assert.rejects(catalog.contractCommand('maker',revise({...input.definition,ruleVersion:'BAD_UNKNOWN',fields:[{...input.definition.fields[0],code:'unknown_field'}]})),/UNKNOWN_FIELD/);
    await assert.rejects(catalog.contractCommand('maker',revise({...input.definition,ruleVersion:'BAD_ENUM',fields:[{...input.definition.fields[0],required:'BAD'}]})),/INVALID_FIELD_ENUM/);
    await assert.rejects(catalog.contractCommand('maker',revise(input.definition)),/IMMUTABLE_RULE_VERSION/,'P0-02-AC-04: an existing rule version cannot be overwritten');
    const conditional = await catalog.contractCommand('maker',revise({...input.definition,ruleVersion:'SYNTHETIC_2',fields:[...input.definition.fields,{code:'unified_credit_code',type:'text',required:'C',privacy:'INTERNAL',condition:'UNRESOLVED',enumValues:[]}]}));
    const unresolved = await catalog.contractCommand('maker',command('VALIDATE',conditional));
    assert.ok((unresolved['blockers'] as string[]).includes('UNRESOLVED_REQUIRED_CONDITION'));
    await assert.rejects(catalog.contractCommand('reviewer',command('APPROVE',unresolved)),/CONTRACT_VALIDATION_BLOCKED/,'P0-02-AC-02');
    const candidate = await catalog.contractCommand('maker',revise({...input.definition,ruleVersion:'SYNTHETIC_3',fields:[{...input.definition.fields[0],enumValues:['A','B']}],codeSets:[{field:'legal_name',codeSystem:'SYNTHETIC_CODES',version:'DRAFT_1',status:'CANDIDATE',codes:['A','B'],validFrom:input.validFrom,validTo:null,sourceVersionId:source.versionId}]},conditional));
    const candidateValidation = await catalog.contractCommand('maker',command('VALIDATE',candidate));
    assert.ok((candidateValidation['blockers'] as string[]).includes('CODESET_NOT_ADOPTED'));
    await assert.rejects(catalog.contractCommand('reviewer',command('APPROVE',candidateValidation)),/CONTRACT_VALIDATION_BLOCKED/,'P0-02-AC-05');
    const history=await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:String(published['id'])});
    assert.ok(history.some(event=>event['status']==='PUBLISHED'&&event['versionId']===published['versionId']));
    const effective=await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'EFFECTIVE',target:String(published['id']),businessAt:'2026-06-01T00:00:00'});
    assert.equal(effective[0]?.['versionId'],published['versionId'],'an unapproved candidate cannot replace the published contract');
    const current=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT',target:String(published['id'])}))[0]!;
    const ajv=new Ajv({strict:false});require('ajv-formats')(ajv);
    const validate=ajv.compile(current.schemas['sourceRowSchema'] as object);
    assert.equal(validate({legal_name:'A'}),true);
    assert.equal(validate({legal_name:'C'}),false,'P0-02-AC-01: generated enum rejects a wrong value');
    assert.equal(validate({legal_name:'A',unknown:'value'}),false,'closed generated schema rejects unknown fields');
    assert.equal(ajv.compile(current.schemas['createSchema'] as object)({operation:'CREATE',platformRef:randomUUID(),values:{legal_name:'A'}}),false,'source create alias and existing platform reference are separate');
    const old=history.find(event=>event.versionId===published['versionId'])!;
    assert.deepEqual(old.schemas,effective[0]?.schemas,'published schema is the persisted historical artifact');
    const before=await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:String(published['id'])});
    const concurrent=await Promise.allSettled([1,2].map(number=>catalog.contractCommand('maker',revise({...input.definition,ruleVersion:'CONCURRENT_'+number},candidate))));
    assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(concurrent.filter(result=>result.status==='rejected'&&/STALE_HEAD/.test(String(result.reason))).length,1);
    assert.equal((await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:String(published['id'])})).length,before.length+1,'losing transaction leaves no partial version or event');
    peer(testReceipt.name,`BEGIN; DELETE FROM vnext_control.object_grant WHERE actor_code='maker-alias' AND object_id=${quote(source.id)}::uuid AND purpose='SYNTHETIC_REFERENCE'; COMMIT;`);
    await assert.rejects(catalog.contractCommand('maker-alias',input),/ACCESS_DENIED/,'replay must check current access to the originally pinned source');
    const active=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT',target:String(published['id'])}))[0]!;
    const sqlClient=new Client({connectionString:process.env['VNEXT_DATABASE_URL']});await sqlClient.connect();
    try{
      await assert.rejects(sqlClient.query('UPDATE governance_catalog.import_contract_version SET definition=definition WHERE id=$1',[published['versionId']]),error=>typeof error==='object'&&error!==null&&'code' in error&&error.code==='42501');
      assert.equal((await sqlClient.query('SELECT count(*)::integer AS count FROM governance_catalog.import_contract_version')).rows[0].count,0,'application role cannot bypass the owner with direct table reads');
    }finally{await sqlClient.end();}
    peer(testReceipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='maker' AND object_id=${quote(dataset.id)}::uuid AND permission='WRITE'; INSERT INTO vnext_control.object_grant(actor_code,object_id,scope,object_kind,campus,purpose,field_group,permission) VALUES('maker',${quote(dataset.id)}::uuid,'SYNTHETIC','DATASET','N_A','METADATA','CONTACT','WRITE');`);
    await assert.rejects(catalog.contractCommand('maker',revise({...input.definition,ruleVersion:'WRONG_FIELD_GROUP'},active)),/ACCESS_DENIED/);
    peer(testReceipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='maker' AND object_id=${quote(dataset.id)}::uuid AND permission='WRITE'; INSERT INTO vnext_control.object_grant(actor_code,object_id,scope,object_kind,campus,purpose,field_group,permission) VALUES('maker',${quote(dataset.id)}::uuid,'SYNTHETIC','DATASET','N_A','METADATA','DEFINITION','WRITE');`);
    await assert.rejects(catalog.contractCommand('maker',{...revise({...input.definition,ruleVersion:'WRONG_SCOPE'},active),scope:'BASELINE'}),/ACCESS_DENIED/);
    const counts=()=>peer(testReceipt.name,"SELECT jsonb_build_object('versions',(SELECT count(*) FROM governance_catalog.import_contract_version),'events',(SELECT count(*) FROM governance_catalog.import_contract_event),'outcomes',(SELECT count(*) FROM vnext_control.outcome),'requests',(SELECT count(*) FROM vnext_control.request_identity),'audit',(SELECT count(*) FROM vnext_control.audit),'chain',(SELECT count(*) FROM vnext_control.audit_chain))::text;");
    peer(testReceipt.name,"CREATE FUNCTION governance_catalog.contract_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason='SYNTHETIC_FAULT' THEN RAISE EXCEPTION 'SYNTHETIC_AUDIT_FAULT'; END IF; RETURN NEW; END $$; CREATE TRIGGER contract_test_fault BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION governance_catalog.contract_test_fault();");
    try {
      const beforeFault=counts();
      await assert.rejects(catalog.contractCommand('maker',{...revise({...input.definition,ruleVersion:'FAULT_1'},active),reason:'SYNTHETIC_FAULT'}),/SYNTHETIC_AUDIT_FAULT/);
      assert.equal(counts(),beforeFault,'version, event, outcome, request and audit roll back together after the final audit write fails');
    } finally {peer(testReceipt.name,'DROP TRIGGER contract_test_fault ON vnext_control.audit; DROP FUNCTION governance_catalog.contract_test_fault();');}
    const retirementImpact=await catalog.contractImpact('reviewer','SYNTHETIC',String(published['id']),'RETIRE');
    peer(testReceipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='reviewer' AND object_id=${quote(source.id)}::uuid AND purpose='SYNTHETIC_REFERENCE';`);
    await assert.rejects(catalog.contractCommand('reviewer',{...command('RETIRE',active),reviewDigest:published['reviewDigest'],impactDigest:retirementImpact.impactDigest}),/ACCESS_DENIED/,'retirement still requires current access, independent of source effectiveness');
    peer(testReceipt.name,`INSERT INTO vnext_control.object_grant(actor_code,object_id,scope,object_kind,campus,purpose,field_group,permission) VALUES('reviewer',${quote(source.id)}::uuid,'SYNTHETIC','SOURCE','SYNTHETIC_ALL','SYNTHETIC_REFERENCE','DEFINITION','READ');`);
    const retired=await catalog.contractCommand('reviewer',{...command('RETIRE',active),reviewDigest:published['reviewDigest'],impactDigest:retirementImpact.impactDigest});
    assert.equal(retired.status,'RETIRED','retirement targets the active publication even when a newer candidate exists');
    assert.equal(retired.versionId,published['versionId']);
    assert.equal((await catalog.contractImpactCases('reviewer','SYNTHETIC',String(published['id']))).filter(row=>row['eventSequence']===2).length,1,'retirement appends a closure without rewriting the frozen obligation');
    assert.equal((await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'EFFECTIVE',target:String(published['id']),businessAt:'2026-06-01T00:00:00'})).length,0);
    assert.equal((await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'EFFECTIVE',target:String(published['id']),businessAt:'2026-06-01T00:00:00',asOf:String(published['recordedAt'])}))[0]?.versionId,published['versionId']);
    peer(testReceipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='reviewer' AND object_id=${quote(dataset.id)}::uuid AND permission='READ';`);
    await assert.rejects(catalog.command('reviewer',{...retireSource,impactDigest:impact.impactDigest}),/ACCESS_DENIED/,'a replayed source approval rechecks its original contract consumer access');
  } finally { await catalog.close(); }
});

test('collection reads omit inaccessible dependencies without hiding unrelated contracts',async()=>{
 const catalog=await openCatalog();const api=await buildCatalogServer(catalog);
 try{
  for(const mode of ['CURRENT','EFFECTIVE'] as const){
   const response=await api.inject({method:'GET',url:`/api/vnext/contracts?scope=SYNTHETIC&mode=${mode}${mode==='EFFECTIVE'?'&businessAt=2026-07-15T00:00:00':''}`,headers:{'x-catalog-actor':'maker'}});
   assert.equal(response.statusCode,200,'one revoked parameter must not abort an untargeted collection');
   assert.ok(response.json().items.some((item:{dataset:string})=>item.dataset==='ORG02'));
   assert.ok(response.json().items.every((item:{dataset:string})=>item.dataset!=='ORG16'));
  }
 }finally{await api.close();await catalog.close();}
});

test('parameter collections omit revoked sources, preserve exact-read denial and order equal keys',async()=>{
 const catalog=await openCatalog();const api=await buildCatalogServer(catalog);
 const cmd=(action:string,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_PARAMETER_LIST',...extra});
 try{
  const root=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.code==='GOV09_SYSTEM')!;
  const source=await catalog.command('maker',cmd('CREATE',{kind:'SOURCE',code:'PARAMETER_LIST_SOURCE',values:{name:'合成参数列表来源',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:root.id},validFrom:'2026-01-01T00:00:00'}));
  const sourceReview=await catalog.command('maker',cmd('SUBMIT',{target:source.id,expectedHead:source.head}));
  const sourcePublished=await catalog.command('reviewer',cmd('PUBLISH',{target:source.id,expectedHead:sourceReview.head,reviewDigest:sourceReview.reviewDigest}));
  const parameters=[];
  for(const systemVersionId of [root.versionId,sourcePublished.versionId]){
   const parameter=await catalog.parameterCommand('maker',cmd('CREATE',{systemVersionId,parameterKey:'SAME_KEY',group:'SYNTHETIC',campus:'SYNTHETIC_ALL',definition:{kind:'VALUE_SCHEMA_V1',valueType:'TEXT',enumValues:[],description:'合成同名参数'},validFrom:'2026-01-01T00:00:00',validTo:null}));
   parameters.push(await catalog.parameterCommand('reviewer',cmd('APPROVE',{target:parameter.id,versionId:parameter.versionId,reviewDigest:parameter.reviewDigest})));
  }
  const before=await catalog.parameterRead('maker',{scope:'SYNTHETIC',mode:'APPROVED'});
  assert.deepEqual(before.filter(item=>item.parameterKey==='SAME_KEY').map(item=>item.id),parameters.map(item=>item.id).sort());
  for(let index=0;index<11;index++){
   const parameter=await catalog.parameterCommand('maker',cmd('CREATE',{systemVersionId:root.versionId,parameterKey:'ZZ_OPTION_'+index,group:'SYNTHETIC',campus:'SYNTHETIC_ALL',definition:{kind:'VALUE_SCHEMA_V1',valueType:'TEXT',enumValues:[],description:'合成完整参数选项'},validFrom:'2026-01-01T00:00:00',validTo:null}));
   await catalog.parameterCommand('reviewer',cmd('APPROVE',{target:parameter.id,versionId:parameter.versionId,reviewDigest:parameter.reviewDigest}));
  }
  peer(testReceipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='maker' AND object_id=${quote(source.id)}::uuid AND permission='READ';`);
  for(const mode of ['CURRENT','APPROVED'] as const){
   const response=await api.inject({method:'GET',url:`/api/vnext/parameter-definitions?scope=SYNTHETIC&mode=${mode}`,headers:{'x-catalog-actor':'maker'}});
   assert.equal(response.statusCode,200,'revoked source must not abort all parameter options');
   assert.equal(response.json().items.length,response.json().total,'all authorized options come from one transaction, without page limits');
   assert.ok(response.json().items.some((item:{id:string})=>item.id===parameters[0]!.id));
   assert.ok(response.json().items.every((item:{id:string})=>item.id!==parameters[1]!.id));
  }
  for(const query of [`target=${parameters[1]!.id}`,`versionId=${parameters[1]!.versionId}`])assert.equal((await api.inject({method:'GET',url:`/api/vnext/parameter-definitions?scope=SYNTHETIC&${query}`,headers:{'x-catalog-actor':'maker'}})).statusCode,403);
 }finally{await api.close();await catalog.close();}
});
