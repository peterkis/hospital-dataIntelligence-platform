import { Type, type Static } from 'typebox';
import type { FastifyInstance } from 'fastify';
import type { Catalog } from '../../modules/governance-catalog/index.js';
import { ContractCommandSchema,ContractItemSchema,ContractOutcomeSchema,ContractScopeSchema,contractInputSchemas,ParameterCommandSchema,ParameterItemSchema,ParameterOutcomeSchema } from '../../modules/governance-catalog/index.js';
import { actor } from './vnext-catalog-routes.js';

const ErrorSchema=Type.Object({code:Type.String(),message:Type.String(),field:Type.Optional(Type.String())});
const errors={400:ErrorSchema,403:ErrorSchema,404:ErrorSchema,409:ErrorSchema,500:ErrorSchema};
const Query=Type.Object({scope:ContractScopeSchema,mode:Type.Union([Type.Literal('CURRENT'),Type.Literal('HISTORY'),Type.Literal('EFFECTIVE')]),target:Type.Optional(Type.String({format:'uuid'})),businessAt:Type.Optional(Type.String()),asOf:Type.Optional(Type.String()),page:Type.Optional(Type.Integer({minimum:1,maximum:100}))},{additionalProperties:false});
export async function registerContractRoutes(app:FastifyInstance,catalog?:Catalog) {
  const owner=()=>{if(!catalog)throw new Error('CATALOG_RUNTIME_REQUIRED');return catalog;};
  app.get<{Querystring:Static<typeof Query>}>('/api/vnext/contracts',{schema:{operationId:'listImportContracts',querystring:Query,response:{200:Type.Object({items:Type.Array(ContractItemSchema),total:Type.Integer(),page:Type.Integer()}),...errors}}},async request=>{
    const {page=1,...query}=request.query;
    const items=await owner().contractRead(actor(request.headers),query);
    return {items:items.slice((page-1)*10,page*10),total:items.length,page};
  });
  app.post<{Body:Static<typeof ContractCommandSchema>}>('/api/vnext/contracts/commands',{schema:{operationId:'importContractCommand',body:ContractCommandSchema,response:{200:ContractOutcomeSchema,...errors}}},request=>owner().contractCommand(actor(request.headers),request.body));
  const ParameterQuery=Type.Object({scope:ContractScopeSchema,target:Type.Optional(Type.String({format:'uuid'})),versionId:Type.Optional(Type.String({format:'uuid'})),asOf:Type.Optional(Type.String()),mode:Type.Optional(Type.Union([Type.Literal('CURRENT'),Type.Literal('APPROVED')])),page:Type.Optional(Type.Integer({minimum:1,maximum:100}))},{additionalProperties:false});
  app.get<{Querystring:Static<typeof ParameterQuery>}>('/api/vnext/parameter-definitions',{schema:{operationId:'listParameterDefinitions',querystring:ParameterQuery,response:{200:Type.Object({items:Type.Array(ParameterItemSchema),total:Type.Integer(),page:Type.Integer()}),...errors}}},async request=>{
    const {page=1,...query}=request.query;const items=await owner().parameterRead(actor(request.headers),query);
    return {items:items.slice((page-1)*10,page*10),total:items.length,page};
  });
  app.post<{Body:Static<typeof ParameterCommandSchema>}>('/api/vnext/parameter-definitions/commands',{schema:{operationId:'parameterDefinitionCommand',body:ParameterCommandSchema,response:{200:ParameterOutcomeSchema,...errors}}},request=>owner().parameterCommand(actor(request.headers),request.body));
  const ImpactQuery=Type.Object({scope:ContractScopeSchema,action:Type.Union([Type.Literal('PUBLISH'),Type.Literal('RETIRE')])},{additionalProperties:false});
  app.get<{Params:{id:string};Querystring:Static<typeof ImpactQuery>}>('/api/vnext/contracts/:id/change-impact',{schema:{operationId:'importContractChangeImpact',params:Type.Object({id:Type.String({format:'uuid'})}),querystring:ImpactQuery,response:{200:Type.Object({impactDigest:Type.String(),head:Type.String(),contractId:Type.String(),contractVersionId:Type.String(),action:Type.String(),closing:Type.Array(Type.Record(Type.String(),Type.Unknown()))}),...errors}}},request=>owner().contractImpact(actor(request.headers),request.query.scope,request.params.id,request.query.action));
  app.get<{Params:{id:string};Querystring:{scope:'BASELINE'|'SYNTHETIC'}}>('/api/vnext/contracts/:id/impact-cases',{schema:{operationId:'importContractImpactCases',params:Type.Object({id:Type.String({format:'uuid'})}),querystring:Type.Object({scope:ContractScopeSchema},{additionalProperties:false}),response:{200:Type.Array(Type.Record(Type.String(),Type.Unknown())),...errors}}},request=>owner().contractImpactCases(actor(request.headers),request.query.scope,request.params.id));
  const SchemaQuery=Type.Object({scope:ContractScopeSchema,versionId:Type.String({format:'uuid'})},{additionalProperties:false});
  app.get<{Params:{id:string};Querystring:Static<typeof SchemaQuery>}>('/api/vnext/contracts/:id/schema',{schema:{operationId:'getImportContractSchema',params:Type.Object({id:Type.String({format:'uuid'})}),querystring:SchemaQuery,response:{200:Type.Record(Type.String(),Type.Unknown()),...errors}}},async request=>{
    const items=await owner().contractRead(actor(request.headers),{scope:request.query.scope,mode:'HISTORY',target:request.params.id});
    const item=items.find(item=>item.versionId===request.query.versionId);
    if(!item)throw new Error('NOT_FOUND');
    return contractInputSchemas(item);
  });
}
