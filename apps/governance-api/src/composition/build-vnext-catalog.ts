import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import swagger from '@fastify/swagger';
import type { Catalog } from '../modules/governance-catalog/index.js';
import { registerCatalogRoutes } from '../platform/fastify/vnext-catalog-routes.js';
import { validCatalogLocalTime } from '../platform/fastify/vnext-local-time.js';

export async function buildCatalogServer(catalog?:Catalog) {
  const app=Fastify({logger:false,genReqId:()=>randomUUID(),requestIdHeader:false,bodyLimit:300000,ajv:{customOptions:{removeAdditional:false}}});
  const started=new WeakMap<object,number>();
  app.addHook('onRequest',async request=>{if(request.method==='GET')started.set(request,performance.now());});
  app.addHook('onResponse',async(request,reply)=>{
    const route=request.routeOptions.url;
    if(request.method==='GET'&&route?.startsWith('/api/vnext/'))process.stdout.write(JSON.stringify({event:'VNEXT_REFERENCE_READ',requestId:request.id,route,status:reply.statusCode,completedAt:new Date().toISOString(),elapsedMs:Math.max(0,Math.round(performance.now()-(started.get(request)??performance.now())))})+'\n');
    started.delete(request);
  });
  await app.register(swagger,{openapi:{openapi:'3.1.0',info:{title:'SYNTHETIC vNext governance catalog',version:'P0-01'}}});
  app.addHook('preValidation',async request=>{
    for(const input of [request.body,request.query]){
      if(typeof input!=='object'||input===null)continue;
      for(const [field,value] of Object.entries(input))if(['validFrom','validTo','asOf','businessAt'].includes(field)&&value!==undefined&&value!==null&&!validCatalogLocalTime(value))throw Object.assign(new Error('LOCAL_TIME_REQUIRED'),{field});
      if('validFrom' in input&&'validTo' in input&&typeof input.validFrom==='string'&&typeof input.validTo==='string'&&(input.validTo.includes('.')?input.validTo:input.validTo+'.').padEnd(26,'0')<=(input.validFrom.includes('.')?input.validFrom:input.validFrom+'.').padEnd(26,'0'))throw Object.assign(new Error('INVALID_BUSINESS_PERIOD'),{field:'validTo'});
    }
  });
  app.setErrorHandler((error,_request,reply)=>{
    const candidate=error instanceof Error?error.message:'';
    const invalidSource=typeof error==='object'&&error!==null&&'validation' in error&&Array.isArray(error.validation)&&error.validation.some((v:unknown)=>typeof v==='object'&&v!==null&&'instancePath' in v&&v.instancePath==='/values/sourceEvidence');
    const code=invalidSource?'SOURCE_REFERENCE_INVALID':/^[A-Z][A-Z0-9_]+$/u.test(candidate)?candidate:(typeof error==='object'&&error!==null&&'validation' in error?'CLOSED_INPUT_REQUIRED':'CATALOG_REQUEST_FAILED');
    const status=code==='CATALOG_CODE_CONFLICT'?409:code==='ACCESS_DENIED'?403:code==='NOT_FOUND'?404:code==='CATALOG_REQUEST_FAILED'?500:400;
    const messages:Record<string,string>={LOCAL_TIME_REQUIRED:'请输入真实有效的本地日历日期和时间，不附加时区。',SOURCE_REFERENCE_INVALID:'来源证据必须是首次合成根标记或有效的来源 UUID。',BOOTSTRAP_ROOT_IMMUTABLE:'首次合成根必须保留根来源标记。',SOURCE_REFERENCE_CYCLE:'来源证据不能形成循环依赖。',OWNER_PERIOD_CONFLICT:'责任期间与已有权威 Owner 冲突，请核对覆盖范围。',SELF_REVIEW_FORBIDDEN:'提交人与复核人必须是不同身份。',STALE_HEAD:'目录已变更，请刷新后重新核对。',SOURCE_NOT_READY:'来源尚未批准、已废止或不在有效期间。',ACCESS_DENIED:'当前身份没有此范围的权限。'};
    messages['INVALID_BUSINESS_PERIOD']='业务结束时间必须晚于业务起始时间；不设结束请留空。';messages['IMPACT_REVIEW_MISMATCH']='来源引用影响已变化或尚未核对，请重新载入变更影响摘要。';
    messages['CATALOG_CODE_CONFLICT']='此范围和类型中的技术码已存在，请使用原对象或选择其他技术码。';
    const field=code==='CATALOG_CODE_CONFLICT'?'code':code==='SOURCE_REFERENCE_INVALID'?'sourceEvidence':code==='INVALID_BUSINESS_PERIOD'?'validTo':code==='LOCAL_TIME_REQUIRED'&&typeof error==='object'&&error!==null&&'field' in error&&typeof error.field==='string'&&['validFrom','validTo','asOf','businessAt'].includes(error.field)?error.field:undefined;
    void reply.code(status).send({code,...(field?{field}:{}),message:messages[code]??'请求未被接受，请检查字段、范围、版本和治理状态。'});
  });
  await registerCatalogRoutes(app,catalog);
  return app;
}
