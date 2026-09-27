import { Type, type Static } from 'typebox';
import type { FastifyInstance } from 'fastify';
import type { Catalog, Command } from '../../modules/governance-catalog/index.js';

const Scope=Type.Union([Type.Literal('BASELINE'),Type.Literal('SYNTHETIC')]);
const Kind=Type.Union([Type.Literal('DATASET'),Type.Literal('SOURCE'),Type.Literal('RESPONSIBILITY')]);
const Status=Type.Union(['DRAFT','REVIEW','PUBLISHED','RETIRED'].map(v=>Type.Literal(v)));
const Text=Type.String({maxLength:2000});
const Time=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
const OriginalField=Type.Object({code:Type.String(),label:Type.String(),type:Type.String(),required:Type.String(),ref:Type.String(),definition:Type.String(),privacy:Type.String(),business:Type.Boolean(),max_length_or_format:Type.String(),conditional_requirement:Type.String(),source_trace:Type.String()},{additionalProperties:false});
const Field=Type.Object({original:OriginalField,pointer:Type.String(),routing:Type.Record(Type.String(),Type.String())});
const Payload=Type.Object({fields:Type.Optional(Type.Array(Field)),adopted:Type.Optional(Type.Object({name:Type.String(),explanation:Type.String()})),original:Type.Optional(Type.Record(Type.String(),Type.String())),domain:Type.Optional(Type.String()),dependencies:Type.Optional(Type.Array(Type.Record(Type.String(),Type.Unknown()))),model:Type.Optional(Type.Record(Type.String(),Type.Unknown())),name:Type.Optional(Type.String()),dataset:Type.Optional(Type.String()),authorityScope:Type.Optional(Type.String()),fieldGroup:Type.Optional(Type.String()),role:Type.Optional(Type.String()),assigneeRole:Type.Optional(Type.String()),sourceEvidence:Type.Optional(Type.String())},{additionalProperties:true});
const Item=Type.Object({id:Type.String(),kind:Kind,scope:Scope,code:Type.String(),version:Type.Integer(),versionId:Type.String(),head:Type.String(),status:Status,payload:Payload,reviewDigest:Type.String(),validFrom:Type.String(),validTo:Type.Union([Type.String(),Type.Null()]),recordedAt:Type.String()});
const Outcome=Type.Object({id:Type.String(),head:Type.String(),version:Type.Integer(),versionId:Type.String(),status:Status,reviewDigest:Type.String(),recordedAt:Type.String()});
const literalValues=<T extends string>(...values:T[])=>Type.Union(values.map(value=>Type.Literal(value)));
const Values=Type.Object({...Object.fromEntries(['name','explanation','vendor','systemVersion','businessOwnerRole','technicalRole','interfaceContractRef','dataset'].map(k=>[k,Type.Optional(Text)])),
  environment:Type.Optional(Type.Literal('SYNTHETIC')),sourceKind:Type.Optional(literalValues('MANUAL','SOFTWARE')),
  deploymentScope:Type.Optional(literalValues('UNRESOLVED_DECLARATION','SYNTHETIC_ALL')),
  sourceEvidence:Type.Optional(Type.Union([Type.Literal('SYNTHETIC_BOOTSTRAP'),Type.String({format:'uuid'})])),
  authorityScope:Type.Optional(literalValues('ALL','NORTH','SOUTH')),fieldGroup:Type.Optional(literalValues('ALL','IDENTITY','CONTACT')),
  role:Type.Optional(literalValues('OWNER','STEWARD','COLLABORATOR')),assigneeRole:Type.Optional(literalValues('SYNTHETIC_OWNER_A','SYNTHETIC_OWNER_B','SYNTHETIC_STEWARD')),
},{additionalProperties:false});
const RequiredText=Type.String({minLength:1,maxLength:2000});
const SourceReference=Type.Union([Type.Literal('SYNTHETIC_BOOTSTRAP'),Type.String({format:'uuid'})]);
const DatasetValues=Type.Object({name:Type.Optional(RequiredText),explanation:Type.Optional(Text)},{additionalProperties:false});
const SourceFields={name:RequiredText,environment:Type.Literal('SYNTHETIC'),deploymentScope:literalValues('UNRESOLVED_DECLARATION','SYNTHETIC_ALL'),businessOwnerRole:RequiredText,technicalRole:RequiredText,sourceEvidence:SourceReference,interfaceContractRef:Type.Optional(Text)};
const SourceValues=Type.Union([
 Type.Object({...SourceFields,sourceKind:Type.Literal('MANUAL'),vendor:Type.Optional(Text),systemVersion:Type.Optional(Text)},{additionalProperties:false}),
 Type.Object({...SourceFields,sourceKind:Type.Literal('SOFTWARE'),vendor:RequiredText,systemVersion:RequiredText},{additionalProperties:false}),
]);
const ResponsibilityValues=Type.Object({dataset:RequiredText,authorityScope:literalValues('ALL','NORTH','SOUTH'),fieldGroup:literalValues('ALL','IDENTITY','CONTACT'),role:literalValues('OWNER','STEWARD','COLLABORATOR'),assigneeRole:literalValues('SYNTHETIC_OWNER_A','SYNTHETIC_OWNER_B','SYNTHETIC_STEWARD')},{additionalProperties:false});
const CommandBase={scope:Scope,requestId:Type.String({format:'uuid'}),reason:Type.String({pattern:'^[A-Z0-9_]{1,64}$'})};
const Target={target:Type.String({format:'uuid'}),expectedHead:Type.String({pattern:'^[0-9]+$'})};
const Revision={values:Values,validFrom:Time,validTo:Type.Optional(Type.Union([Time,Type.Null()]))};
export const CatalogCommandSchema=Type.Union([
  Type.Object({...CommandBase,...Revision,action:Type.Literal('CREATE'),kind:Type.Literal('DATASET'),code:Type.String({pattern:'^[A-Z0-9_]{2,64}$'}),values:DatasetValues},{additionalProperties:false}),
  Type.Object({...CommandBase,...Revision,action:Type.Literal('CREATE'),kind:Type.Literal('SOURCE'),code:Type.String({pattern:'^[A-Z0-9_]{2,64}$'}),values:SourceValues},{additionalProperties:false}),
  Type.Object({...CommandBase,...Revision,action:Type.Literal('CREATE'),kind:Type.Literal('RESPONSIBILITY'),code:Type.String({pattern:'^[A-Z0-9_]{2,64}$'}),values:ResponsibilityValues},{additionalProperties:false}),
  Type.Object({...CommandBase,action:Type.Literal('REVISE'),...Target,...Revision},{additionalProperties:false}),
  Type.Object({...CommandBase,action:Type.Union([Type.Literal('SUBMIT'),Type.Literal('REJECT')]),...Target},{additionalProperties:false}),
  Type.Object({...CommandBase,action:Type.Literal('PUBLISH'),...Target,reviewDigest:Type.String(),impactDigest:Type.Optional(Type.String())},{additionalProperties:false}),
  Type.Object({...CommandBase,action:Type.Literal('RETIRE'),...Target,reviewDigest:Type.String(),impactDigest:Type.Optional(Type.String())},{additionalProperties:false}),
]);
const Query=Type.Object({scope:Scope,asOf:Type.Optional(Time),page:Type.Optional(Type.Integer({minimum:1,maximum:100})),domain:Type.Optional(Type.String()),owner:Type.Optional(Type.String()),status:Type.Optional(Status),kind:Type.Optional(Kind)},{additionalProperties:false});
const ErrorSchema=Type.Object({code:Type.String(),message:Type.String(),field:Type.Optional(Type.String())});
const errors={400:ErrorSchema,403:ErrorSchema,404:ErrorSchema,409:ErrorSchema,500:ErrorSchema};
export async function registerCatalogRoutes(app:FastifyInstance,catalog?:Catalog) {
  const owner=()=>{if(!catalog)throw new Error('CATALOG_RUNTIME_REQUIRED');return catalog;};
  const EffectiveQuery=Type.Object({scope:Scope,businessAt:Time,asOf:Type.Optional(Time)},{additionalProperties:false});
  app.get<{Querystring:Static<typeof EffectiveQuery>}>('/api/vnext/catalog/effective',{schema:{operationId:'listEffectiveCatalog',querystring:EffectiveQuery,response:{200:Type.Object({items:Type.Array(Item),domains:Type.Array(Type.Object({code:Type.String(),name:Type.String(),datasets:Type.Array(Type.String())}))}),...errors}}},async request=>owner().readEffective(actor(request.headers),request.query));
  app.get<{Querystring:Static<typeof Query>}>('/api/vnext/catalog',{schema:{operationId:'listCatalog',querystring:Query,response:{200:Type.Object({items:Type.Array(Item),total:Type.Integer(),page:Type.Integer(),domains:Type.Array(Type.Object({code:Type.String(),name:Type.String(),datasets:Type.Array(Type.String())}))}),...errors}}},async request=>{
    const q=request.query; const data=await owner().read(actor(request.headers),{scope:q.scope,...(q.asOf?{asOf:q.asOf}:{})});
    const filtered=data.items.filter(item=>(!q.kind||item.kind===q.kind)&&(!q.domain||item.payload.domain===q.domain)&&(!q.owner||(item.kind==='RESPONSIBILITY'?item.payload.assigneeRole:item.kind==='SOURCE'?item.payload['businessOwnerRole']:item.payload.original?.['owner'])?.includes(q.owner))&&(!q.status||item.status===q.status));
    const page=q.page??1;return {...data,total:filtered.length,page,items:filtered.slice((page-1)*10,page*10)};
  });
  app.get<{Params:{id:string};Querystring:{scope:'BASELINE'|'SYNTHETIC';asOf?:string}}>('/api/vnext/catalog/:id',{schema:{operationId:'getCatalogEntry',params:Type.Object({id:Type.String({format:'uuid'})}),querystring:Type.Object({scope:Scope,asOf:Type.Optional(Time)},{additionalProperties:false}),response:{200:Item,...errors}}},async request=>{
    const data=await owner().read(actor(request.headers),request.query);const item=data.items.find(item=>item.id===request.params.id);if(!item)throw new Error('NOT_FOUND');return item;
  });
  app.post<{Body:Command}>('/api/vnext/catalog/commands',{schema:{operationId:'catalogCommand',body:CatalogCommandSchema,response:{200:Outcome,...errors}}},async request=>owner().command(actor(request.headers),request.body));
  app.get<{Params:{id:string};Querystring:{scope:string}}>('/api/vnext/catalog/:id/history',{schema:{operationId:'catalogHistory',params:Type.Object({id:Type.String({format:'uuid'})}),querystring:Type.Object({scope:Scope},{additionalProperties:false}),response:{200:Type.Array(Type.Object({head:Type.String(),status:Status,version:Type.Integer(),payload:Payload,validFrom:Type.String(),validTo:Type.Union([Type.String(),Type.Null()]),recordedAt:Type.String()})),...errors}}},async request=>owner().history(actor(request.headers),request.query.scope,request.params.id));
  app.get<{Params:{id:string};Querystring:{scope:string;businessAt:string}}>('/api/vnext/sources/:id/qualification',{schema:{operationId:'sourceQualification',params:Type.Object({id:Type.String({format:'uuid'})}),querystring:Type.Object({scope:Scope,businessAt:Time},{additionalProperties:false}),response:{200:Type.Record(Type.String(),Type.String()),...errors}}},async request=>owner().resolveSource(actor(request.headers),request.query.scope,request.params.id,request.query.businessAt));
  app.get<{Params:{id:string};Querystring:{scope:string;action:'PUBLISH'|'RETIRE'}}>('/api/vnext/sources/:id/change-impact',{schema:{operationId:'sourceChangeImpact',params:Type.Object({id:Type.String({format:'uuid'})}),querystring:Type.Object({scope:Scope,action:literalValues('PUBLISH','RETIRE')},{additionalProperties:false}),response:{200:Type.Object({impactDigest:Type.String(),effectiveMode:Type.Literal('ON_COMMIT'),target:Type.String(),head:Type.String(),action:literalValues('PUBLISH','RETIRE'),asOf:Time,catalogHead:Type.String(),candidateVersionId:Type.String(),definitionVersionId:Type.Union([Type.String(),Type.Null()]),definitionDigest:Type.Union([Type.String(),Type.Null()]),contractHead:Type.String(),contractCurrent:Type.Array(Type.Record(Type.String(),Type.Unknown())),contractHistory:Type.Array(Type.Record(Type.String(),Type.Unknown())),contractOpening:Type.Array(Type.Record(Type.String(),Type.Unknown())),contractClosing:Type.Array(Type.Record(Type.String(),Type.Unknown())),targetDefinitions:Type.Array(Type.Record(Type.String(),Type.Unknown())),current:Type.Array(Type.Record(Type.String(),Type.Unknown())),history:Type.Array(Type.Record(Type.String(),Type.Unknown())),opening:Type.Array(Type.Record(Type.String(),Type.Unknown())),closing:Type.Array(Type.Record(Type.String(),Type.Unknown()))},{additionalProperties:false}),...errors}}},async request=>owner().sourceImpact(actor(request.headers),request.query.scope,request.params.id,request.query.action));
  app.get<{Params:{id:string};Querystring:{scope:string}}>('/api/vnext/sources/:id/impact-cases',{schema:{operationId:'sourceImpactCases',params:Type.Object({id:Type.String({format:'uuid'})}),querystring:Type.Object({scope:Scope},{additionalProperties:false}),response:{200:Type.Array(Type.Record(Type.String(),Type.Unknown())),...errors}}},async request=>owner().impactCases(actor(request.headers),request.query.scope,request.params.id));
}
export function actor(headers:Record<string,string|string[]|undefined>):string {
  const value=headers['x-catalog-actor'];if(typeof value!=='string'||!['maker','maker-alias','reviewer','outsider','bundle-admin','workspace-reviewer','workspace-steward'].includes(value))throw new Error('ACCESS_DENIED');return value;
}
