import {Type,type Static} from 'typebox';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {OperatingStageSchema,OperatingCommandSchema,OperatingReadSchema,EvaluateOperatingSchema,ScopeFacts,RelationFacts,ScopeRef,LicenseRef,CatalogRef,SubjectRef,CampusRef,kindOf,type OperatingOwner} from '../../modules/organization-master/index.js';
import {Id,Time,InputSchema} from '../../modules/organization-master/index.js';
import {ApproveApplyUnitSchema,ApplyUnitSchema} from '../../modules/governance-catalog/index.js';
const closed={additionalProperties:false} as const,Text=Type.String(),End=Type.Union([Time,Type.Null()]);
const ErrorSchema=Type.Object({code:Text,message:Text,field:Type.Optional(Text)},closed),errors={400:ErrorSchema,403:ErrorSchema,404:ErrorSchema,409:ErrorSchema,500:ErrorSchema,503:ErrorSchema};
const Ref=Type.Object({owner:Type.Enum(['organization-master/operating-relation','organization-master/license-scope']),id:Id,version:Text},closed);
const Outcome=Type.Object({status:Type.Enum(['COMMITTED','COMMIT_UNKNOWN']),candidateId:Id,requestId:Id,facts:Type.Optional(Type.Array(Ref)),recordedAt:Type.Optional(Time),responseStatus:Type.Optional(Type.Enum(['DELIVERED','POST_COMMIT_FAILED']))},closed);
const Version=Type.Object({id:Id,kind:Type.Enum(['RELATION','SCOPE']),head:Text,subject:SubjectRef,campus:CampusRef,version:Text,versionId:Id,action:Type.Enum(['VERIFY_SCOPE','REVISE_SCOPE','REVOKE_SCOPE','ESTABLISH','REVISE_RELATION','REVALIDATE','CLOSE']),validFrom:Time,validTo:End,recordedAt:Time,facts:Type.Union([ScopeFacts,RelationFacts,Type.Null()]),scopeDependencies:Type.Array(Type.Object({reference:ScopeRef,license:LicenseRef,catalog:CatalogRef},closed)),reviewer:Text},closed);
const Span=Type.Object({from:Time,to:End},closed),Status=Type.Enum(['SATISFIED','NOT_SATISFIED','REVIEW_REQUIRED','NOT_EVALUABLE']);
const Evaluation=Type.Object({policy:Type.Literal('ORG03_SYNTHETIC_V1'),status:Status,observedAt:Time,asOf:Time,subject:SubjectRef,campus:CampusRef,validFrom:Time,validTo:End,services:Type.Array(Type.Object({code:Text,status:Status,segments:Type.Array(Type.Object({from:Time,to:End,relation:Type.Object({owner:Type.Literal('organization-master/operating-relation'),id:Id,version:Text,versionId:Id},closed),scope:ScopeRef,license:LicenseRef},closed)),gaps:Type.Array(Span),reviewRequired:Type.Array(Span),reasons:Type.Array(Text)},closed))},closed);
export interface OperatingHttpContext {owner:OperatingOwner;actor:(r:FastifyRequest)=>string}
export const OperatingEvaluationResponseSchema=Evaluation;
export function registerOperatingRoutes(app:FastifyInstance,context?:OperatingHttpContext){
 const owner=()=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');return context.owner;};
 const actor=(r:FastifyRequest)=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');return context.actor(r);};
 for(const [path,kind,name] of [['operating-relations','RELATION','OperatingRelation'],['license-scope-evidence','SCOPE','LicenseScope']] as const){
  const url='/api/vnext/'+path;
  app.post<{Body:Static<typeof OperatingStageSchema>}>(url+'/inputs',{schema:{operationId:'stage'+name,body:OperatingStageSchema,response:{200:Type.Object({inputId:Id,revisionId:Id},closed),...errors}}},r=>{if(kindOf(r.body.command.action)!==kind)throw new Error('ACCESS_DENIED');return owner().stage(actor(r),r.body);});
  app.post<{Body:Static<typeof InputSchema>}>(url+'/plan',{schema:{operationId:'plan'+name,body:InputSchema,response:{200:Type.Object({candidateId:Id,digest:Text},closed),...errors}}},async r=>{await owner().requireInputKind(actor(r),r.body.inputId,kind);return owner().plan(actor(r),r.body);});
  app.post<{Body:Static<typeof InputSchema>}>(url+'/withdraw',{schema:{operationId:'withdraw'+name,body:InputSchema,response:{200:Type.Object({inputId:Id,status:Type.Literal('WITHDRAWN')},closed),...errors}}},async r=>{await owner().requireInputKind(actor(r),r.body.inputId,kind);return owner().withdraw(actor(r),r.body);});
  const Candidate=Type.Object({candidateId:Id},closed);
  app.post<{Body:Static<typeof Candidate>}>(url+'/review',{schema:{operationId:'review'+name,body:Candidate,response:{200:Type.Object({candidateId:Id,digest:Text,approvedBy:Type.Union([Text,Type.Null()]),command:OperatingCommandSchema,blockingIssues:Type.Array(Text)},closed),...errors}}},async r=>{await owner().requireCandidateKind(actor(r),r.body.candidateId,kind);const c=await owner().readApplyCandidate(actor(r),r.body);return {candidateId:c.candidateId,digest:c.digest,approvedBy:c.approvedBy,command:JSON.parse(c.unit.commands[0]!.value['original']!),blockingIssues:c.unit.basis['blockingIssues']??[]};});
  app.post<{Body:Static<typeof ApproveApplyUnitSchema>}>(url+'/approve',{schema:{operationId:'approve'+name,body:ApproveApplyUnitSchema,response:{200:Type.Object({candidateId:Id,approvedBy:Text},closed),...errors}}},async r=>{await owner().requireCandidateKind(actor(r),r.body.candidateId,kind);return owner().approveApplyUnit(actor(r),r.body);});
  app.post<{Body:Static<typeof ApplyUnitSchema>}>(url+'/apply',{schema:{operationId:'apply'+name,body:ApplyUnitSchema,response:{200:Outcome,...errors}}},async r=>{await owner().requireCandidateKind(actor(r),r.body.candidateId,kind);return owner().applyUnit(actor(r),r.body);});
  app.post<{Body:Static<typeof ApplyUnitSchema>}>(url+'/resume',{schema:{operationId:'resume'+name,body:ApplyUnitSchema,response:{200:Type.Union([Outcome,Type.Null()]),...errors}}},async r=>{await owner().requireCandidateKind(actor(r),r.body.candidateId,kind);return owner().resumeOutcome(actor(r),r.body);});
  app.post<{Body:Static<typeof OperatingReadSchema>}>(url+'/query',{schema:{operationId:'read'+name,body:OperatingReadSchema,response:{200:Type.Array(Version),...errors}}},r=>{if(r.body.kind!==kind)throw new Error('ACCESS_DENIED');return owner().read(actor(r),r.body);});
  const Input=Type.Object({id:Id},closed);
  app.post<{Body:Static<typeof Input>}>(url+'/restricted-input',{schema:{operationId:'restricted'+name,body:Input,response:{200:OperatingStageSchema,...errors}}},async r=>{await owner().requireInputKind(actor(r),r.body.id,kind);return owner().readRestrictedInput(actor(r),r.body.id);});
 }
 app.post<{Body:Static<typeof EvaluateOperatingSchema>}>('/api/vnext/operating-relations/evaluate',{schema:{operationId:'evaluateOperatingWindow',body:EvaluateOperatingSchema,response:{200:Evaluation,...errors}}},r=>owner().evaluateOperatingWindow(actor(r),r.body));
}
