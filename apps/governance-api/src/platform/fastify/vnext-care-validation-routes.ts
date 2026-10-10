import type {FastifyInstance,FastifyRequest} from 'fastify';
import {Type} from 'typebox';
import {Check} from 'typebox/value';
import {CareValidationSchema,CareValidationResultSchema,CareUnitImpactSchema,LifecycleAssessmentResultSchema,type CareValidation,type CareValidationOwner} from '../../modules/care-organization/index.js';
import {parseStrictJson} from './strict-json.js';
export interface CareValidationHttpContext {owner:CareValidationOwner;actor:(r:FastifyRequest)=>string}
export function registerCareValidationRoutes(app:FastifyInstance,context?:CareValidationHttpContext){
 app.register(async app=>{
 app.removeContentTypeParser('application/json');app.addContentTypeParser('application/json',{parseAs:'string'},(_request,body,done)=>{try{if(typeof body!=='string')throw new Error('CLOSED_INPUT_REQUIRED');done(null,parseStrictJson(body));}catch{done(new Error('CLOSED_INPUT_REQUIRED'));}});
 const error=Type.Object({code:Type.String(),message:Type.String(),field:Type.Optional(Type.String())},{additionalProperties:false});
 app.post<{Body:CareValidation}>('/api/vnext/care-organization/validate-bundle',{schema:{operationId:'validateCareOrganizationBundle',body:CareValidationSchema,response:{200:CareValidationResultSchema,400:error,403:error,409:error,500:error,503:error}}},async request=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');const result=await context.owner.validateCareOrganizationBundle(context.actor(request),request.body);if(!Check(CareValidationResultSchema,result))throw new Error('OWNER_RESPONSE_INVALID');return result;});
 app.post<{Body:{id:string;validFrom:string;validTo:string|null;recordAsOf?:string}}>('/api/vnext/care-organization/assess-unit-impact',{schema:{operationId:'assessUnitImpact',body:CareUnitImpactSchema,response:{200:LifecycleAssessmentResultSchema,400:error,403:error,404:error,500:error,503:error}}},async request=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');const result=await context.owner.assessUnitImpact(context.actor(request),request.body);if(!Check(LifecycleAssessmentResultSchema,result))throw new Error('OWNER_RESPONSE_INVALID');return result;});
 });
}
