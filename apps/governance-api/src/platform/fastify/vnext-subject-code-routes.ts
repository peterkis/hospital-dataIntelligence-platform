import type {FastifyInstance,FastifyRequest} from 'fastify';
import {Type} from 'typebox';
import {SubjectCodeCommandSchema,SubjectCodeReadSchema,SubjectCodeItemSchema,subjectCheck,type SubjectCodeOwner} from '../../modules/governance-catalog/index.js';
export interface SubjectCodeHttpContext {owner:SubjectCodeOwner;actor:(request:FastifyRequest)=>string}
export function registerSubjectCodeRoutes(app:FastifyInstance,context?:SubjectCodeHttpContext){
 const ErrorSchema=Type.Object({code:Type.String(),message:Type.String(),field:Type.Optional(Type.String())},{additionalProperties:false}),errors={400:ErrorSchema,403:ErrorSchema,404:ErrorSchema,409:ErrorSchema,503:ErrorSchema};
 app.post<{Body:Parameters<SubjectCodeOwner['command']>[1]}>('/api/vnext/subject-codes/command',{validatorCompiler:({schema})=>value=>{try{subjectCheck(schema,value);return {value};}catch(error){return {error:error as Error};}},schema:{operationId:'commandSubjectCodeSnapshot',body:SubjectCodeCommandSchema,response:{200:SubjectCodeItemSchema,...errors}}},r=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');return context.owner.command(context.actor(r),r.body);});
 app.post<{Body:Parameters<SubjectCodeOwner['read']>[1]}>('/api/vnext/subject-codes/query',{validatorCompiler:({schema})=>value=>{try{subjectCheck(schema,value);return {value};}catch(error){return {error:error instanceof Error?error:new Error('CLOSED_INPUT_REQUIRED')};}},schema:{operationId:'querySubjectCodeSnapshots',body:SubjectCodeReadSchema,response:{200:Type.Array(SubjectCodeItemSchema),...errors}}},r=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');return context.owner.read(context.actor(r),r.body);});
}
