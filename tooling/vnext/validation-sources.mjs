import {writeFileSync,readFileSync} from 'node:fs';
import {contractSources} from './contract-sources.mjs';
const sources=contractSources();
const conditions=sources.conditions.filter(c=>c.scope==='IN_SCOPE_ORG_PER').map(c=>{
 const raw=JSON.parse(readFileSync(`db/vnext/sources/contract-inputs/${c.source.dataset}.contract.json`,'utf8'));
 return {id:c.id,dataset:c.source.dataset,field:c.source.field,text:c.source.rule,handler:c.id==='SRC-COND-061'?'ACCOUNT_HUMAN_V1':'MANUAL_EVIDENCE_V1',requirementId:c.id+'_EVIDENCE_V1',version:'P0_05_SOURCE_V1',evidenceOwner:raw.sourceModel.owner,evidenceClaim:c.source.rule,inputs:c.id==='SRC-COND-061'?['account_kind',c.source.field]:[c.source.field,'CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE'],dispositionReason:c.id==='SRC-COND-061'?'Exact HUMAN/SERVICE code only; unknown/unadopted codes remain UNKNOWN':`${raw.sourceModel.owner} must establish the applicability and evidence required by ${c.source.dataset}.${c.source.field}; row presence cannot prove: ${c.source.rule}`,whenTrue:'REQUIRE_VALUE_AND_SOURCE_EVIDENCE',whenFalse:'ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE',whenUnknown:'BLOCK',evidenceCapability:'NOT_READY'};
});
if(conditions.length!==77||sources.conditions.length!==196)throw new Error('CONDITION_SOURCE_DRIFT');
const limits={};
for(const draft of sources.drafts){
 const raw=JSON.parse(readFileSync(`db/vnext/sources/contract-inputs/${draft.dataset}.contract.json`,'utf8'));
 limits[draft.dataset]=Object.fromEntries(raw.sourceModel.fields.map(f=>{
  const decimal=/^DECIMAL\((\d+),(\d+)\)$/.exec(f.max_length_or_format);
  return [f.code,{maxLength:/^\d+$/.test(f.max_length_or_format)?Number(f.max_length_or_format):8192,reference:f.ref??'',precision:decimal?Number(decimal[1]):null,scale:decimal?Number(decimal[2]):null,int32:f.max_length_or_format==='32位整数'}];
 }));
}
const target='apps/governance-api/src/modules/governance-catalog/validation-sources.generated.ts';
const text='// Generated from checksum-verified v3 inputs; do not edit source package.\nexport const conditionMappings = '+JSON.stringify(conditions,null,2)+' as const;\nexport const sourceFieldLimits:Record<string,Record<string,{maxLength:number;reference:string;precision:number|null;scale:number|null;int32:boolean}>> = '+JSON.stringify(limits,null,2)+';\n';
if(process.argv.includes('--verify')){if(readFileSync(target,'utf8')!==text)throw new Error('VALIDATION_SOURCE_GENERATION_DRIFT');}
else writeFileSync(target,text);
console.log(JSON.stringify({conditions:77,outsideScope:119,status:'PASS'}));
