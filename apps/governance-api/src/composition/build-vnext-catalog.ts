import {registerDepartmentRoutes,type DepartmentHttpContext} from '../platform/fastify/vnext-department-routes.js';
import {registerOrganizationWorkspaceRoutes,type OrganizationWorkspaceHttpContext} from '../platform/fastify/vnext-organization-workspace-routes.js';
import {registerOperatingRoutes,type OperatingHttpContext} from '../platform/fastify/vnext-operating-routes.js';
import {registerOrganizationImportRoutes,type OrganizationImportHttpContext} from '../platform/fastify/vnext-organization-import-routes.js';
import {registerCampusRoutes,type CampusHttpContext} from '../platform/fastify/vnext-campus-routes.js';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import swagger from '@fastify/swagger';
import type { Catalog } from '../modules/governance-catalog/index.js';
import { registerCatalogRoutes } from '../platform/fastify/vnext-catalog-routes.js';
import { registerContractRoutes } from '../platform/fastify/vnext-contract-routes.js';
import { registerWorkbenchRoutes } from '../platform/fastify/vnext-workbench-routes.js';
import { validCatalogLocalTime, catalogClockTime } from '../platform/fastify/vnext-local-time.js';
import {registerOrganizationRoutes,type OrganizationHttpContext} from '../platform/fastify/vnext-organization-routes.js';
import {registerHierarchyRoutes,type HierarchyHttpContext} from '../platform/fastify/vnext-hierarchy-routes.js';
import {registerOrganizationMappingRoutes,type OrganizationMappingHttpContext} from '../platform/fastify/vnext-organization-mapping-routes.js';
import {registerOrganizationIdentifierRoutes,type OrganizationIdentifierHttpContext} from '../platform/fastify/vnext-organization-identifier-routes.js';

// Closing with unread upload bytes can reset the socket before the client receives 413.
// Discard a bounded remainder without buffering; hostile/unfinished uploads still close.
async function discardRejectedUpload(request:IncomingMessage):Promise<void> {
  if(request.readableEnded||request.destroyed)return;
  await new Promise<void>(resolve=>{
    let bytes=0;
    let finished=false;
    const finish=()=>{
      if(finished)return;
      finished=true;
      clearTimeout(timer);
      request.off('data',onData);
      request.off('end',finish);
      request.off('error',finish);
      request.off('aborted',finish);
      request.pause();
      resolve();
    };
    const onData=(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>=4*1024*1024)finish();};
    const timer=setTimeout(finish,1000);
    timer.unref();
    request.on('data',onData);
    request.once('end',finish);
    request.once('error',finish);
    request.once('aborted',finish);
    request.resume();
  });
}

export async function buildCatalogServer(catalog?:Catalog,workbenchMode:'CONTROL_PLANE'|'FINITE_E2E'='CONTROL_PLANE',organization?:OrganizationHttpContext,campus?:CampusHttpContext,operating?:OperatingHttpContext,organizationImport?:OrganizationImportHttpContext,workspace?:OrganizationWorkspaceHttpContext,department?:DepartmentHttpContext,hierarchy?:HierarchyHttpContext,mapping?:OrganizationMappingHttpContext,identifiers?:OrganizationIdentifierHttpContext) {
  const app=Fastify({logger:false,genReqId:()=>randomUUID(),requestIdHeader:false,bodyLimit:300000,ajv:{customOptions:{removeAdditional:false}}});
  const started=new WeakMap<object,number>();
  app.addHook('onRequest',async(request,reply)=>{if(request.url.startsWith('/api/vnext/'))reply.header('Cache-Control','no-store');if(request.method==='GET')started.set(request,performance.now());});
  app.addHook('onResponse',async(request,reply)=>{
    const route=request.routeOptions.url;
    if(request.method==='GET'&&route?.startsWith('/api/vnext/'))process.stdout.write(JSON.stringify({event:'VNEXT_REFERENCE_READ',requestId:request.id,route,status:reply.statusCode,completedAt:catalogClockTime(),elapsedMs:Math.max(0,Math.round(performance.now()-(started.get(request)??performance.now())))})+'\n');
    started.delete(request);
  });
  await app.register(swagger,{openapi:{openapi:'3.1.0',info:{title:'SYNTHETIC vNext governance metadata',version:'P0-02'}}});
  app.addHook('preValidation',async request=>{
    for(const input of [request.body,request.query]){
      if(typeof input!=='object'||input===null)continue;
      for(const [field,value] of Object.entries(input))if(['validFrom','validTo','asOf','businessAt'].includes(field)&&value!==undefined&&value!==null&&!validCatalogLocalTime(value))throw Object.assign(new Error('LOCAL_TIME_REQUIRED'),{field});
      if('validFrom' in input&&'validTo' in input&&typeof input.validFrom==='string'&&typeof input.validTo==='string'&&(input.validTo.includes('.')?input.validTo:input.validTo+'.').padEnd(26,'0')<=(input.validFrom.includes('.')?input.validFrom:input.validFrom+'.').padEnd(26,'0'))throw Object.assign(new Error('INVALID_BUSINESS_PERIOD'),{field:'validTo'});
    }
  });
  app.setErrorHandler(async(error,request,reply)=>{
    const candidate=typeof error==='object'&&error!==null&&'code' in error&&error.code==='FST_ERR_CTP_BODY_TOO_LARGE'?'FST_ERR_CTP_BODY_TOO_LARGE':error instanceof Error?error.message:'';
    if(candidate==='FST_ERR_CTP_BODY_TOO_LARGE')await discardRejectedUpload(request.raw);
    const invalidSource=typeof error==='object'&&error!==null&&'validation' in error&&Array.isArray(error.validation)&&error.validation.some((v:unknown)=>typeof v==='object'&&v!==null&&'instancePath' in v&&v.instancePath==='/values/sourceEvidence');
    const code=invalidSource?'SOURCE_REFERENCE_INVALID':/^[A-Z][A-Z0-9_]+$/u.test(candidate)?candidate:(typeof error==='object'&&error!==null&&'validation' in error?'CLOSED_INPUT_REQUIRED':'CATALOG_REQUEST_FAILED');
    const status=['ACCESS_DENIED','PAIR_PREAUTHORIZATION_REQUIRED'].includes(code)?403:code==='NOT_FOUND'?404:code==='FST_ERR_CTP_BODY_TOO_LARGE'||code==='FILE_SIZE_OR_ENCODING'?413:['STALE_REVISION','STALE_VALIDATION','STALE_HEAD','REQUEST_CONFLICT','CAMPUS_REFERENCE_CONFLICT','PRIMARY_OPERATOR_CONFLICT','OPERATING_CLOSED','CAMPUS_RETIRED','CAMPUS_SUSPENDED','DISPOSITION_INCOMPLETE','DISPOSITION_ALREADY_COMPLETE','TEMPLATE_VERSION_MISMATCH','CATALOG_CODE_CONFLICT'].includes(code)?409:['BLOCKED_DEPENDENCY','BUNDLE_CONTEXT_REQUIRED','LEGAL_REVIEW_REQUIRED','KEY_UNAVAILABLE','PAYLOAD_UNAVAILABLE','TRANSPORT_FAILED'].includes(code)?503:code==='CATALOG_REQUEST_FAILED'?500:400;
    const messages:Record<string,string>={CAMPUS_RETIRED:'院区已永久退出，不能恢复或新增运营声明。',CAMPUS_SUSPENDED:'院区在申请期间暂停，请先独立审批恢复。',DISPOSITION_INCOMPLETE:'依赖尚未处置、证据缺失或在途状态未知，不能结案。',DISPOSITION_ALREADY_COMPLETE:'本次处置已结案，请读取原结果。',LOCAL_TIME_REQUIRED:'请输入真实有效的本地日历日期和时间，不附加时区。',SOURCE_REFERENCE_INVALID:'来源证据必须是首次合成根标记或有效的来源 UUID。',BOOTSTRAP_ROOT_IMMUTABLE:'首次合成根必须保留根来源标记。',SOURCE_REFERENCE_CYCLE:'来源证据不能形成循环依赖。',OWNER_PERIOD_CONFLICT:'责任期间与已有权威 Owner 冲突，请核对覆盖范围。',SELF_REVIEW_FORBIDDEN:'提交人与复核人必须是不同身份。',STALE_HEAD:'目录已变更，请刷新后重新核对。',SOURCE_NOT_READY:'来源尚未批准、已废止或不在有效期间。',ACCESS_DENIED:'当前身份没有此范围的权限。'};
    messages['INVALID_BUSINESS_PERIOD']='业务结束时间必须晚于业务起始时间；不设结束请留空。';messages['IMPACT_REVIEW_MISMATCH']='来源引用影响已变化或尚未核对，请重新载入变更影响摘要。';
    messages['CATALOG_CODE_CONFLICT']='此范围和类型中的技术码已存在，请使用原对象或选择其他技术码。';
    Object.assign(messages,{STALE_HEAD:'对象或草稿已出现新版本，本次内容未覆盖服务器数据。请重新读取并核对。',MAKER_CHECKER_REQUIRED:'提交人与独立核验、审批人不能是同一身份，包括同人别名。',OPERATING_CLOSED:'关系或许可范围已终态关闭，不能通过修订恢复。',CLOSED_INPUT_REQUIRED:'申请结构尚不完整或存在不支持的字段，请核对表单。',APPROVAL_REQUIRED:'尚未满足准确核验或独立审批要求。',BLOCKED_DEPENDENCY:'必要条件、准确引用或相应能力尚未就绪，不能降级继续。'});
    Object.assign(messages,{CONTRACT_VALIDATION_BLOCKED:'条件、标准采纳或来源期间仍有阻断项，请先校验契约。',CONTRACT_IMPACT_REVIEW_MISMATCH:'影响义务已变化或尚未审签，请重新查看影响并批准。',IMMUTABLE_RULE_VERSION:'已有规则版本不可覆盖，请使用新的规则版本。',PARAMETER_NOT_APPROVED:'参数定义尚未批准或引用摘要不一致。',PARAMETER_PERIOD_NOT_COVERED:'参数定义及其来源不能覆盖契约的完整期间。',PARAMETER_SCOPE_REQUIRED:'参数范围必须明确，并与固定来源 owner 的范围一致。',REFERENCE_INVALID:'引用定义与该数据集的原字段约束不一致。'});
    const field=code==='CATALOG_CODE_CONFLICT'?'code':code==='SOURCE_REFERENCE_INVALID'?'sourceEvidence':code==='INVALID_BUSINESS_PERIOD'?'validTo':code==='LOCAL_TIME_REQUIRED'&&typeof error==='object'&&error!==null&&'field' in error&&typeof error.field==='string'&&['validFrom','validTo','asOf','businessAt'].includes(error.field)?error.field:undefined;
    const contractFields:Record<string,string>={UNKNOWN_FIELD:'definition.fields[].code',INVALID_FIELD_ENUM:'definition.fields[]',CODESET_AUTHORITY_INVALID:'definition.codeSets[]',CODESET_REQUIRED:'definition.codeSets[]',REFERENCE_INVALID:'definition.references[]',REFERENCE_REQUIRED:'definition.references[]',PARAMETER_NOT_APPROVED:'definition.references[].parameterVersionId',PARAMETER_PERIOD_NOT_COVERED:'definition.references[].parameterVersionId',PARAMETER_SCOPE_REQUIRED:'campus',IMMUTABLE_RULE_VERSION:'definition.ruleVersion'};
    const safeField=field??contractFields[code];
    return reply.code(status).send({code,...(safeField?{field:safeField}:{}),message:messages[code]??'请求未被接受，请检查字段、范围、版本和治理状态。'});
  });
  await registerCatalogRoutes(app,catalog);
  await registerContractRoutes(app,catalog);
  await registerWorkbenchRoutes(app,catalog,workbenchMode);
  registerOrganizationRoutes(app,organization);
  registerCampusRoutes(app,campus);
  registerOperatingRoutes(app,operating);
  registerOrganizationImportRoutes(app,organizationImport);
  registerOrganizationWorkspaceRoutes(app,workspace);
  registerDepartmentRoutes(app,department);
  registerHierarchyRoutes(app,hierarchy);
  registerOrganizationMappingRoutes(app,mapping);
  registerOrganizationIdentifierRoutes(app,identifiers);
  return app;
}
