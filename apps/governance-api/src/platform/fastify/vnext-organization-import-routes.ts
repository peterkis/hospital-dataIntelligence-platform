import {Type,type Static} from 'typebox';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {ReceiveOrganizationBundleSchema,BundleRevisionSchema,BundlePlanSchema,BundlePreauthorizeSchema,BundleLegalSchema,BundleManifest,BundleContract,Dataset,Id,Time,type openOrganizationImport} from '../../modules/organization-master/index.js';
import {ApplyUnitSchema,ApproveApplyUnitSchema} from '../../modules/governance-catalog/index.js';
const closed={additionalProperties:false} as const,Text=Type.String();
const ErrorSchema=Type.Object({code:Text,message:Text,field:Type.Optional(Text)},closed),errors={400:ErrorSchema,403:ErrorSchema,404:ErrorSchema,409:ErrorSchema,413:ErrorSchema,500:ErrorSchema,503:ErrorSchema};
const Bytes=Type.String({maxLength:1398104,pattern:'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'});
const Receive=Type.Object({metadata:ReceiveOrganizationBundleSchema,bytesBase64:Bytes},closed);
const Revision=Type.Object({...BundleRevisionSchema.properties,currentRevisionId:Id,manifest:BundleManifest,contracts:Type.Array(BundleContract)},closed);
const Issue=Type.Object({dataset:Type.Union([Dataset,Type.Null()]),row:Type.Integer(),field:Text,code:Text,status:Type.Enum(['FAIL','BLOCKED'])},closed);
const Validation=Type.Object({...BundleRevisionSchema.properties,commandCount:Type.Integer(),decision:Type.Enum(['PASS','FAIL','BLOCKED']),issues:Type.Array(Issue),runId:Type.Union([Id,Type.Null()])},closed);
const Cell=Type.Object({sheet:Dataset,row:Type.Integer(),sourceRow:Type.Integer(),column:Type.Integer(),field:Text,value:Text,sourceType:Type.Enum(['CSV','JSON','inlineStr','s'])},closed);
const Legal=Type.Object({...BundleRevisionSchema.properties,digest:Text,manifest:BundleManifest,cells:Type.Array(Cell),materialBindings:Type.Array(Type.Object({step:Text,id:Id,digest:Text},closed)),materials:Type.Array(Type.Object({id:Id,contentBase64:Bytes},closed),{maxItems:100})},closed);
const Control=Type.Object({eventId:Id,status:Type.Enum(['READ','VERIFIED','AUTHORIZED'])},closed);
const Candidate=Type.Object({candidateId:Id},closed);
const Fact=Type.Object({owner:Text,id:Id,version:Text,source:Type.Object({dataset:Dataset,row:Type.Integer(),step:Text},closed)},closed);
const Outcome=Type.Object({status:Type.Enum(['COMMITTED','COMMIT_UNKNOWN']),candidateId:Id,requestId:Id,facts:Type.Optional(Type.Array(Fact)),recordedAt:Type.Optional(Time),responseStatus:Type.Optional(Type.Enum(['DELIVERED','POST_COMMIT_FAILED']))},closed);
export interface OrganizationImportHttpContext {owner:ReturnType<typeof openOrganizationImport>;actor:(request:FastifyRequest)=>string}
export function registerOrganizationImportRoutes(app:FastifyInstance,context?:OrganizationImportHttpContext){
 const owner=()=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');return context.owner;},actor=(request:FastifyRequest)=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');return context.actor(request);};
 const path='/api/vnext/import/organization-bundles';
 app.post<{Body:Static<typeof Receive>}>(path+'/receive',{bodyLimit:2097152,schema:{operationId:'receiveOrganizationBundle',body:Receive,response:{200:Type.Object({...BundleRevisionSchema.properties,rawArtifactId:Id,manifestArtifactId:Id},closed),...errors}}},async r=>{
  const bytes=Buffer.from(r.body.bytesBase64,'base64');try{if(bytes.toString('base64')!==r.body.bytesBase64)throw new Error('FILE_SIZE_OR_ENCODING');return await owner().receive(actor(r),r.body.metadata,bytes);}finally{bytes.fill(0);}
 });
 app.post<{Body:Static<typeof BundleRevisionSchema>}>(path+'/revision',{schema:{operationId:'readOrganizationBundleRevision',body:BundleRevisionSchema,response:{200:Revision,...errors}}},r=>owner().readRevision(actor(r),r.body));
 for(const dataset of ['ORG01','ORG02','ORG03','bundle'] as const)app.post<{Body:Static<typeof BundlePlanSchema>}>(path+'/validate/'+dataset,{schema:{operationId:dataset==='bundle'?'validateOrganizationBundle':'validate'+dataset,body:BundlePlanSchema,response:{200:Validation,...errors}}},async r=>{const result=await owner().validate(actor(r),r.body);return {jobId:result.jobId,revisionId:result.revisionId,commandCount:result.commandCount,decision:result.decision,issues:result.issues.filter(i=>dataset==='bundle'||i.dataset===null||i.dataset===dataset),runId:result.run?.runId??null};});
 app.post<{Body:Static<typeof BundlePreauthorizeSchema>}>(path+'/preauthorize',{schema:{operationId:'preauthorizeOrganizationBundle',body:BundlePreauthorizeSchema,response:{200:Control,...errors}}},r=>owner().preauthorize(actor(r),r.body));
 app.post<{Body:Static<typeof BundleRevisionSchema>}>(path+'/legal-review',{schema:{operationId:'readOrganizationBundleLegalReview',body:BundleRevisionSchema,response:{200:Legal,...errors}}},async r=>{const result=await owner().readLegalReview(actor(r),r.body);return {jobId:result.jobId,revisionId:result.revisionId,digest:result.digest,manifest:result.manifest,cells:Object.values(result.parsed.sheets).flatMap(s=>s.cells),materialBindings:result.materialBindings,materials:result.materials};});
 app.post<{Body:Static<typeof BundleLegalSchema>}>(path+'/verify',{schema:{operationId:'verifyOrganizationBundle',body:BundleLegalSchema,response:{200:Control,...errors}}},r=>owner().verifyLegalReview(actor(r),r.body));
 app.post<{Body:Static<typeof BundlePlanSchema>}>(path+'/plan',{schema:{operationId:'planOrganizationBundle',body:BundlePlanSchema,response:{200:Type.Object({candidateId:Id,digest:Text},closed),...errors}}},r=>owner().plan(actor(r),r.body));
 app.post<{Body:Static<typeof Candidate>}>(path+'/review',{schema:{operationId:'reviewOrganizationBundle',body:Candidate,response:{200:Type.Object({candidateId:Id,digest:Text,approvedBy:Type.Union([Text,Type.Null()]),commands:Type.Array(Type.Object({sequence:Type.Integer(),owner:Text,interpretation:Text},closed))},closed),...errors}}},async r=>{const result=await owner().readApplyCandidate(actor(r),r.body);return {candidateId:result.candidateId,digest:result.digest,approvedBy:result.approvedBy,commands:result.unit.commands.map(c=>({sequence:c.row,owner:c.owner,interpretation:c.value['step']!}))};});
 app.post<{Body:Static<typeof ApproveApplyUnitSchema>}>(path+'/approve',{schema:{operationId:'approveOrganizationBundle',body:ApproveApplyUnitSchema,response:{200:Type.Object({candidateId:Id,approvedBy:Text},closed),...errors}}},r=>owner().approveApplyUnit(actor(r),r.body));
 app.post<{Body:Static<typeof ApplyUnitSchema>}>(path+'/apply',{schema:{operationId:'applyOrganizationBundle',body:ApplyUnitSchema,response:{200:Outcome,...errors}}},r=>owner().applyUnit(actor(r),r.body));
 app.post<{Body:Static<typeof ApplyUnitSchema>}>(path+'/resume',{schema:{operationId:'resumeOrganizationBundle',body:ApplyUnitSchema,response:{200:Type.Union([Outcome,Type.Null()]),...errors}}},r=>owner().resumeOutcome(actor(r),r.body));
}
