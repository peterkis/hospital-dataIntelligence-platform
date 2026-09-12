import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import type { Catalog } from '../modules/governance-catalog/index.js';
import { registerCatalogRoutes } from '../platform/fastify/vnext-catalog-routes.js';

export async function buildCatalogServer(catalog?:Catalog) {
  const app=Fastify({logger:false,bodyLimit:300000,ajv:{customOptions:{removeAdditional:false}}});
  await app.register(swagger,{openapi:{openapi:'3.1.0',info:{title:'SYNTHETIC vNext governance catalog',version:'P0-01'}}});
  app.setErrorHandler((error,_request,reply)=>{
    const candidate=error instanceof Error?error.message:'';
    const invalidSource=typeof error==='object'&&error!==null&&'validation' in error&&Array.isArray(error.validation)&&error.validation.some((v:unknown)=>typeof v==='object'&&v!==null&&'instancePath' in v&&v.instancePath==='/values/sourceEvidence');
    const code=invalidSource?'SOURCE_REFERENCE_INVALID':/^[A-Z][A-Z0-9_]+$/u.test(candidate)?candidate:(typeof error==='object'&&error!==null&&'validation' in error?'CLOSED_INPUT_REQUIRED':'CATALOG_REQUEST_FAILED');
    const status=code==='ACCESS_DENIED'?403:code==='NOT_FOUND'?404:code==='CATALOG_REQUEST_FAILED'?500:400;
    const messages:Record<string,string>={SOURCE_REFERENCE_INVALID:'来源证据必须是首次合成根标记或有效的来源 UUID。',BOOTSTRAP_ROOT_IMMUTABLE:'首次合成根必须保留根来源标记。',SOURCE_REFERENCE_CYCLE:'来源证据不能形成循环依赖。',OWNER_PERIOD_CONFLICT:'责任期间与已有权威 Owner 冲突，请核对覆盖范围。',SELF_REVIEW_FORBIDDEN:'提交人与复核人必须是不同身份。',STALE_HEAD:'目录已变更，请刷新后重新核对。',SOURCE_NOT_READY:'来源尚未批准、已废止或不在有效期间。',ACCESS_DENIED:'当前身份没有此范围的权限。'};
    void reply.code(status).send({code,...(code==='SOURCE_REFERENCE_INVALID'?{field:'sourceEvidence'}:{}),message:messages[code]??'请求未被接受，请检查字段、范围、版本和治理状态。'});
  });
  await registerCatalogRoutes(app,catalog);
  return app;
}
