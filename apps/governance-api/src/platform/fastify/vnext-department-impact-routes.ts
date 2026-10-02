import type {FastifyInstance} from 'fastify';
import {Type,type Static,type TSchema} from 'typebox';
import {Check} from 'typebox/value';
import {AssessDepartmentChangeSchema,StoredDepartmentAssessmentSchema,ImpactCaseListSchema,ImpactCaseListResultSchema,
 ImpactCaseReadSchema,ImpactCaseDetailSchema,AssignImpactCaseSchema,RecordDispositionSchema,ApproveDispositionSchema,
 ReadDepartmentAssessmentSchema,ListDepartmentAssessmentsSchema,ListDepartmentAssessmentsResultSchema,RecheckImpactSchema,RecordMigrationReceiptSchema,ImpactCommandResultSchema,ServiceImpactHandoffSchema,
} from '../../modules/department-master/index.js';
import type {OrganizationEvolutionHttpContext} from './vnext-organization-evolution-routes.js';

const ErrorSchema=Type.Object({code:Type.String(),message:Type.String(),field:Type.Optional(Type.String())},{additionalProperties:false});
const errors={400:ErrorSchema,403:ErrorSchema,404:ErrorSchema,409:ErrorSchema,413:ErrorSchema,500:ErrorSchema,503:ErrorSchema};
export function registerDepartmentImpactRoutes(app:FastifyInstance,context?:OrganizationEvolutionHttpContext){
 const route=<S extends TSchema>(path:string,operationId:string,body:S,response:TSchema,handler:(owner:OrganizationEvolutionHttpContext['owner'],actor:string,input:Static<S>)=>Promise<unknown>)=>app.post<{Body:Static<S>}>('/api/vnext/department-impacts/'+path,{schema:{operationId,body,response:{200:response,...errors}},preValidation:async request=>{if(!Check(body,request.body))throw new Error('CLOSED_INPUT_REQUIRED');}},request=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');return handler(context.owner,context.actor(request),request.body as Static<S>);});
 route('assess','assessDepartmentChange',AssessDepartmentChangeSchema,StoredDepartmentAssessmentSchema,(o,a,b)=>o.assessDepartmentChange(a,b));
 route('assessments/read','readDepartmentAssessment',ReadDepartmentAssessmentSchema,StoredDepartmentAssessmentSchema,(o,a,b)=>o.readDepartmentAssessment(a,b));
 route('assessments','listDepartmentAssessments',ListDepartmentAssessmentsSchema,ListDepartmentAssessmentsResultSchema,(o,a,b)=>o.listDepartmentAssessments(a,b));
 route('cases','listDepartmentImpactCases',ImpactCaseListSchema,ImpactCaseListResultSchema,(o,a,b)=>o.listImpactCases(a,b));
 route('cases/read','readDepartmentImpactCase',ImpactCaseReadSchema,ImpactCaseDetailSchema,(o,a,b)=>o.readImpactCase(a,b));
 route('assign','assignDepartmentImpactCase',AssignImpactCaseSchema,ImpactCommandResultSchema,(o,a,b)=>o.assignImpactCase(a,b));
 route('dispositions','recordDepartmentImpactDisposition',RecordDispositionSchema,ImpactCommandResultSchema,(o,a,b)=>o.recordDisposition(a,b));
 route('dispositions/approve','approveDepartmentImpactDisposition',ApproveDispositionSchema,ImpactCommandResultSchema,(o,a,b)=>o.approveDisposition(a,b));
 route('recheck','recheckDepartmentImpact',RecheckImpactSchema,ImpactCommandResultSchema,(o,a,b)=>o.recheckImpact(a,b));
 route('receipts','recordDepartmentMigrationReceipt',RecordMigrationReceiptSchema,ImpactCommandResultSchema,(o,a,b)=>o.recordMigrationReceipt(a,b));
 route('handoffs/read','readDepartmentMigrationHandoff',ImpactCaseReadSchema,ServiceImpactHandoffSchema,(o,a,b)=>o.readMigrationHandoff(a,b));
}
