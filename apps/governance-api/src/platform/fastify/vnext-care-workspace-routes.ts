import {CareBasisSaveSchema,CareBasisReadSchema,CareBasisResultSchema} from '../../modules/care-organization/index.js';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {Type,type Static,type TSchema} from 'typebox';
import {Check} from 'typebox/value';
import {CareWorkspaceSaveSchema,CareWorkspaceSavedSchema,CareWorkspaceIdSchema,CareWorkspaceReadSchema,CareWorkspaceActionSchema,CareWorkspaceListSchema,CareWorkspaceRecoverSchema,CareWorkspaceApplicationsSchema,CareWorkspaceApplicationsResultSchema,CareWorkspacePermissionsSchema,CareWorkspacePermissionsResultSchema,type CareWorkspaceOwner} from '../../modules/care-organization/index.js';
import {parseStrictJson} from './strict-json.js';
import {CareWorkspaceExecutionsSchema,CareWorkspaceExecutionsResultSchema} from '../../modules/care-organization/index.js';
import {CareWorkspaceApplicationReferenceSchema,CareWorkspaceApplicationReferenceResultSchema} from '../../modules/care-organization/index.js';
import {CareWorkspaceMaterialStoreSchema,CareWorkspaceMaterialReadSchema,CareWorkspaceMaterialReferenceSchema,CareWorkspaceMaterialReadResultSchema,CareWorkspaceMaterialCreateSchema,CareWorkspaceMaterialCreateResultSchema} from '../../modules/care-organization/index.js';
import {CareFileReceiptSchema,CareSavedFileResultSchema} from '../../modules/care-organization/index.js';
export interface CareWorkspaceHttpContext {owner:CareWorkspaceOwner;actor:(r:FastifyRequest)=>string}
export function registerCareWorkspaceRoutes(app:FastifyInstance,context?:CareWorkspaceHttpContext){
 app.register(async scoped=>{
  scoped.removeContentTypeParser('application/json');scoped.addContentTypeParser('application/json',{parseAs:'string'},(_r,body,done)=>{try{if(typeof body!=='string')throw new Error('CLOSED_INPUT_REQUIRED');done(null,parseStrictJson(body));}catch{done(new Error('CLOSED_INPUT_REQUIRED'));}});
  const ErrorSchema=Type.Object({code:Type.String(),message:Type.String(),field:Type.Optional(Type.String())},{additionalProperties:false}),errors={400:ErrorSchema,403:ErrorSchema,404:ErrorSchema,409:ErrorSchema,413:ErrorSchema,500:ErrorSchema,503:ErrorSchema};
  const route=<S extends TSchema>(path:string,operationId:string,body:S,response:TSchema,handle:(owner:CareWorkspaceOwner,a:string,input:Static<S>)=>Promise<unknown>)=>scoped.post<{Body:Static<S>}>('/api/vnext/care-workspace/'+path,{bodyLimit:path==='drafts/save'?2000000:1500000,validatorCompiler:({schema})=>value=>Check(schema as never,value)?{value}:{error:new Error('CLOSED_INPUT_REQUIRED')},schema:{operationId,body,response:{200:response,...errors}}},async r=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');const result=await handle(context.owner,context.actor(r),r.body as Static<S>);if(!Check(response,result))throw new Error('OWNER_RESPONSE_INVALID');return result;});
  route('basis/save','saveCareWorkspaceBasisRequest',CareBasisSaveSchema,CareBasisResultSchema,(o,a,b)=>o.saveBasisRequest(a,b));
  route('basis/read','readCareWorkspaceBasisRequest',CareBasisReadSchema,Type.Union([CareBasisResultSchema,Type.Null()]),(o,a,b)=>o.readBasisRequest(a,b));
  route('drafts/save','saveCareWorkspaceDraft',CareWorkspaceSaveSchema,CareWorkspaceSavedSchema,(o,a,b)=>o.save(a,b));
  route('drafts/read','readCareWorkspaceDraft',CareWorkspaceIdSchema,CareWorkspaceReadSchema,(o,a,b)=>o.read(a,b));
  route('drafts/recover','recoverCareWorkspaceDraft',CareWorkspaceRecoverSchema,Type.Union([CareWorkspaceSavedSchema,Type.Null()]),(o,a,b)=>o.recover(a,b));
  route('applications/list','listCareWorkspaceApplications',CareWorkspaceApplicationsSchema,CareWorkspaceApplicationsResultSchema,(o,a,b)=>o.applications(a,b));
  route('permissions','careWorkspacePermissions',CareWorkspacePermissionsSchema,CareWorkspacePermissionsResultSchema,(o,a,b)=>o.permissions(a,b));
  route('applications/executions','listCareWorkspaceExecutions',CareWorkspaceExecutionsSchema,CareWorkspaceExecutionsResultSchema,(o,a,b)=>o.executions(a,b));
  route('applications/reference','readCareWorkspaceApplicationReference',CareWorkspaceApplicationReferenceSchema,CareWorkspaceApplicationReferenceResultSchema,(o,a,b)=>o.applicationReference(a,b));
  route('materials/store','storeCareWorkspaceMaterial',CareWorkspaceMaterialStoreSchema,CareWorkspaceMaterialReferenceSchema,(o,a,b)=>o.storeMaterial(a,b));
  route('materials/create','createCareWorkspaceMaterial',CareWorkspaceMaterialCreateSchema,CareWorkspaceMaterialCreateResultSchema,(o,a,b)=>o.createMaterial(a,b));
  route('materials/read','readCareWorkspaceMaterial',CareWorkspaceMaterialReadSchema,CareWorkspaceMaterialReadResultSchema,(o,a,b)=>o.readMaterial(a,b));
  route('drafts/discard','discardCareWorkspaceDraft',CareWorkspaceActionSchema,CareWorkspaceSavedSchema,(o,a,b)=>o.discard(a,b));
  route('drafts/submit','submitCareWorkspaceDraft',CareWorkspaceActionSchema,CareWorkspaceSavedSchema,(o,a,b)=>o.submit(a,b));
  route('files/receive','receiveCareWorkspaceDraftFile',CareWorkspaceActionSchema,CareFileReceiptSchema,(o,a,b)=>o.receiveFile(a,b));
  route('files/receipt','readCareWorkspaceFileReceipt',CareWorkspaceActionSchema,Type.Union([CareFileReceiptSchema,Type.Null()]),(o,a,b)=>o.fileReceipt(a,b));
  route('files/saved','readCareWorkspaceSavedFile',CareWorkspaceActionSchema,CareSavedFileResultSchema,(o,a,b)=>o.savedFile(a,b));
  route('drafts/list','listCareWorkspaceDrafts',CareWorkspaceListSchema,Type.Object({items:Type.Array(Type.Object({id:CareWorkspaceIdSchema.properties.id,version:Type.String(),kind:Type.String(),campus:Type.String(),state:Type.String(),recordedAt:Type.String()},{additionalProperties:false})),nextAfterId:Type.Union([CareWorkspaceIdSchema.properties.id,Type.Null()])},{additionalProperties:false}),(o,a,b)=>o.list(a,b));
 });
}
