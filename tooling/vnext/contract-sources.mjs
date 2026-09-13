import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { root } from './lineage.mjs';

export function contractSources() {
  const directory = root + '/db/vnext/sources/contract-inputs/';
  const manifest = JSON.parse(readFileSync(directory + 'manifest.json','utf8'));
  const inputs = new Map();
  for (const entry of manifest) {
    if (!/^[a-zA-Z0-9_.-]+$/u.test(entry.file)) throw new Error('SOURCE_PATH_INVALID');
    const bytes = readFileSync(directory + entry.file);
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('CONTRACT_SOURCE_DRIFT');
    inputs.set(entry.file, JSON.parse(bytes));
  }
  const conditions = inputs.get('conditional-rule-disposition.json');
  const drafts = [...inputs.entries()].filter(([name])=>name.endsWith('.contract.json')).map(([,draft])=>({
    dataset:draft.datasetId, profile:'FULL', approval:draft.status, adapterReadiness:'NOT_READY',
    conditionIds:draft.conditionalRuleRefs, sourceContract:draft.contractId,
    definition:{
      ruleVersion:'SOURCE_DRAFT_1', templateVersion:'SOURCE_DRAFT_1', sourceVersionId:null,
      fields:draft.sourceModel.fields.map(field=>({code:field.code,type:field.type,required:field.required,privacy:field.privacy,
        condition:field.required==='C'?'UNRESOLVED':field.required==='R'?'ALWAYS':'OPTIONAL',enumValues:[]})),
      rules:conditions.filter(condition=>condition.source.dataset===draft.datasetId).map(condition=>({
        id:condition.id,field:condition.source.field,text:condition.source.rule,status:'UNRESOLVED',version:'SOURCE_DRAFT_1',
      })),
      codeSets:[],
      references:draft.sourceModel.fields.filter(field=>field.ref).map(field=>({field:field.code,target:field.ref,status:'BLOCKED_DEPENDENCY'})),
    },
    sourcePolicies:{format:draft.formatPolicy,time:draft.timePolicy,identity:draft.identityPolicy,apply:draft.applyPolicy},
    fieldRouting:draft.fieldRouting,
  }));
  return { manifest, drafts, conditions, standardReviewQueue:inputs.get('standard_review_queue.json') };
}
