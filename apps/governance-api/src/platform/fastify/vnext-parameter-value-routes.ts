import type {FastifyInstance,FastifyRequest} from 'fastify';
import {Type,type Static,type TSchema} from 'typebox';
import {Check} from 'typebox/value';
import {ParameterValueCommandSchema,ParameterValueReadSchema,ParameterValueWindowSchema,ParameterValueItemSchema,ParameterValueWindowResultSchema,type ParameterValueOwner} from '../../modules/governance-catalog/index.js';
const ErrorSchema=Type.Object({code:Type.String(),message:Type.String(),field:Type.Optional(Type.String())});
export interface ParameterValueHttpContext {owner:ParameterValueOwner;actor:(request:FastifyRequest)=>string}
export function registerParameterValueRoutes(app:FastifyInstance,context?:ParameterValueHttpContext){
 const route=<S extends TSchema>(path:string,operationId:string,body:S,response:TSchema,handle:(owner:ParameterValueOwner,actor:string,input:Static<S>)=>Promise<unknown>)=>app.post<{Body:Static<S>}>('/api/vnext/parameter-values/'+path,{validatorCompiler:({schema})=>input=>Check(schema as never,input)?{value:input}:{error:new Error('CLOSED_INPUT_REQUIRED')},schema:{operationId,body,response:{200:response,400:ErrorSchema,403:ErrorSchema,404:ErrorSchema,409:ErrorSchema,503:ErrorSchema}}},r=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');return handle(context.owner,context.actor(r),r.body as Static<S>);});
 route('commands','commandParameterValue',ParameterValueCommandSchema,ParameterValueItemSchema,(o,a,b)=>o.command(a,b));
 route('query','getParameterValue',ParameterValueReadSchema,ParameterValueItemSchema,(o,a,b)=>o.read(a,b));
 route('history','getParameterValueHistory',ParameterValueReadSchema,Type.Array(ParameterValueItemSchema),(o,a,b)=>o.history(a,b));
 route('evaluate','evaluateParameterValueWindow',ParameterValueWindowSchema,ParameterValueWindowResultSchema,(o,a,b)=>o.evaluateWindow(a,b));
}
