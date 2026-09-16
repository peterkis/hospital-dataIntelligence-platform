import {createHash} from 'node:crypto';
import type {RuleStatus,ValidationEvaluation} from './validation-rules.js';

export interface QualityIssueCandidate {
 sourceKind:'RULE'|'LAYER'; sourceStatus:Exclude<RuleStatus,'PASS'>; classification:'ERROR'|'REVIEW'|'BLOCKED_DEPENDENCY';
 layer:number; rule:string; requirementId:string; row:number; field:string; ownerRef:string; relatedRefs:string[]; boundedCode:string;
}

const dependencyCodes=new Set(['BLOCKED_DEPENDENCY','FIELD_SOURCE_UNRESOLVED','RULE_SOURCE_UNRESOLVED','REFERENCE_WINDOW_REQUIRED']);
function classification(status:Exclude<RuleStatus,'PASS'>,code:string):QualityIssueCandidate['classification']{
 if(status==='FAIL')return 'ERROR';
 return status==='NOT_EVALUATED'||dependencyCodes.has(code)?'BLOCKED_DEPENDENCY':'REVIEW';
}
function candidateKey(candidate:QualityIssueCandidate){return JSON.stringify([candidate.sourceKind,candidate.rule,candidate.requirementId,candidate.row,candidate.field,candidate.boundedCode]);}

/** Converts only signed, bounded evaluation metadata into ledger candidates. No row values cross this boundary. */
export function buildQualityIssueCandidates(evaluation:ValidationEvaluation):QualityIssueCandidate[]{
 const byKey=new Map<string,QualityIssueCandidate>();
 const add=(candidate:QualityIssueCandidate)=>{const key=candidateKey(candidate);const previous=byKey.get(key);if(previous){if(candidate.requirementId)previous.requirementId=candidate.requirementId;if(candidate.ownerRef)previous.ownerRef=candidate.ownerRef;previous.relatedRefs=[...new Set([...previous.relatedRefs,...candidate.relatedRefs])].sort();if(candidate.classification==='BLOCKED_DEPENDENCY')previous.classification='BLOCKED_DEPENDENCY';if(candidate.sourceStatus==='NOT_EVALUATED')previous.sourceStatus='NOT_EVALUATED';return;}byKey.set(key,candidate);};
 for(const issue of evaluation.issues){
  if(issue.status==='PASS')continue;
  const status=issue.status as Exclude<RuleStatus,'PASS'>;
  add({sourceKind:'RULE',sourceStatus:status,classification:classification(status,issue.code),layer:issue.layer,rule:issue.rule,requirementId:'',row:issue.row,field:issue.field,ownerRef:'',relatedRefs:[],boundedCode:issue.code});
 }
 for(const requirement of evaluation.evidenceRequirements){
  const matching=[...byKey.values()].find(candidate=>candidate.sourceKind==='RULE'&&candidate.rule===requirement.rule&&candidate.row===requirement.row&&candidate.field===requirement.field);
  const details=requirement.details;
  const candidate={sourceKind:'RULE' as const,sourceStatus:'NOT_EVALUATED' as const,classification:'BLOCKED_DEPENDENCY' as const,layer:2,rule:requirement.rule,requirementId:requirement.requirementId,row:requirement.row,field:requirement.field,ownerRef:details?.evidenceOwner??'',relatedRefs:details?[details.sourceDataset,details.sourceField,details.sourceVersion,requirement.requirementId]:[requirement.requirementId],boundedCode:'BLOCKED_DEPENDENCY'};
  if(matching){matching.requirementId=candidate.requirementId;matching.ownerRef=candidate.ownerRef;matching.classification='BLOCKED_DEPENDENCY';matching.sourceStatus='NOT_EVALUATED';matching.relatedRefs=[...new Set([...matching.relatedRefs,...candidate.relatedRefs])].sort();}
  else add(candidate);
 }
 if(evaluation.layers.some(layer=>layer.layer===6&&layer.status==='NOT_EVALUATED'))add({sourceKind:'LAYER',sourceStatus:'NOT_EVALUATED',classification:'BLOCKED_DEPENDENCY',layer:6,rule:'L6',requirementId:'',row:0,field:'',ownerRef:'',relatedRefs:[],boundedCode:'DOMAIN_OWNER_UNAVAILABLE'});
 return [...byKey.values()].sort((a,b)=>a.layer-b.layer||a.row-b.row||a.field.localeCompare(b.field,'en')||a.rule.localeCompare(b.rule,'en')||a.boundedCode.localeCompare(b.boundedCode,'en'));
}

type FrameValue=string|number|readonly FrameValue[];
function frame(value:FrameValue):string{
 if(Array.isArray(value))return `A${value.length}[${value.map(frame).join('')}]`;
 const text=String(value);return `${text.length}:${text}`;
}

/** Stable length-framed digest shared by validation acceptance and the quality-ingest Owner. */
function candidateFrame(candidates:readonly QualityIssueCandidate[],dimensions:{campus:'NORTH'|'SOUTH';purpose:'IDENTITY_VERIFY'|'CONTACT_VERIFY'|'HR_RESTRICTED'}):string{
 return frame([dimensions.campus,dimensions.purpose])+candidates.map(candidate=>frame([
  candidate.sourceKind,candidate.sourceStatus,candidate.classification,candidate.layer,candidate.rule,candidate.requirementId,
  candidate.row,candidate.field,candidate.ownerRef,candidate.relatedRefs,candidate.boundedCode,
 ])).join('');
}

export function qualityCandidateDigest(candidates:readonly QualityIssueCandidate[],dimensions:{campus:'NORTH'|'SOUTH';purpose:'IDENTITY_VERIFY'|'CONTACT_VERIFY'|'HR_RESTRICTED'}):string{
 return createHash('sha256').update(candidateFrame(candidates,dimensions)).digest('hex');
}

export function qualityEligibilityDigest(candidates:readonly QualityIssueCandidate[],notRunLayers:readonly number[],dimensions:{campus:'NORTH'|'SOUTH';purpose:'IDENTITY_VERIFY'|'CONTACT_VERIFY'|'HR_RESTRICTED'}):string{
 return createHash('sha256').update(candidateFrame(candidates,dimensions)+frame(notRunLayers)).digest('hex');
}
