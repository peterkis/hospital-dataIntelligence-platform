import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {createHmac} from 'node:crypto';
import {Kysely,PostgresDialect,sql} from 'kysely';
import {vnextPool} from '../../platform/database/vnext-pool.js';
import type {DB} from '../../platform/database/vnext-types.generated.js';
import {CatalogTransactionScope} from './transaction-scope.js';
import {canonicalPlan,planBinding} from './plan-binding.js';
import {authenticateRegistrationEvidence,type KeyProviderPort} from './protected-artifact.js';
import {parseLocalDateTime} from '../../platform/local-datetime/local-datetime.js';
const closed={additionalProperties:false} as const;
export const SubjectId=Type.String({format:'uuid'}),SubjectTime=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'}),SubjectEnd=Type.Union([SubjectTime,Type.Null()]);
export const SubjectText=Type.String({minLength:1,maxLength:2000,pattern:'\\S'}),SubjectDigest=Type.String({pattern:'^[a-f0-9]{64}$'}),SubjectHead=Type.String({pattern:'^[1-9][0-9]{0,18}$'});
export const SubjectCodeSchema=Type.Object({code:Type.String({minLength:1,maxLength:64,pattern:'\\S'}),name:SubjectText,meaning:SubjectText,status:Type.Enum(['ACTIVE','RETIRED']),replacement:Type.Union([Type.String({minLength:1,maxLength:64}),Type.Null()])},closed);
export const SubjectCodeReferenceSchema=Type.Object({owner:Type.Literal('governance-catalog/subject-code'),dataset:Type.Literal('REF01'),namespace:Type.Literal('REF01.code_system_id'),sourceAlias:Type.String({minLength:1,maxLength:64,pattern:'\\S'})},closed);
export const SubjectSnapshotFields={reference:SubjectCodeReferenceSchema,codeSystemName:SubjectText,namespaceUri:Type.String({minLength:1,maxLength:160}),standardDocument:SubjectText,issuer:SubjectText,codeSystemVersion:Type.String({minLength:1,maxLength:256,pattern:'\\S'}),sourceId:SubjectId,sourceVersionId:SubjectId,evidenceId:SubjectId,sourcePage:SubjectText,sourceSummary:SubjectText,adoptedOn:Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}$'}),label:Type.Literal('TEST_POLICY_ONLY'),validFrom:SubjectTime,validTo:SubjectEnd,codes:Type.Array(SubjectCodeSchema,{minItems:1,maxItems:1000})};
export const SubjectCodeCommandSchema=Type.Union([
 Type.Object({action:Type.Literal('CREATE'),requestId:SubjectId,reason:SubjectText,systemCode:Type.String({pattern:'^[A-Z][A-Z0-9_]{0,63}$'}),...SubjectSnapshotFields},closed),
 Type.Object({action:Type.Literal('REVISE'),requestId:SubjectId,reason:SubjectText,target:SubjectId,expectedHead:SubjectHead,...SubjectSnapshotFields},closed),
 Type.Object({action:Type.Literal('APPROVE'),requestId:SubjectId,reason:SubjectText,target:SubjectId,versionId:SubjectId,reviewDigest:SubjectDigest},closed),
 Type.Object({action:Type.Literal('VERIFY'),requestId:SubjectId,reason:SubjectText,target:SubjectId,versionId:SubjectId,reviewDigest:SubjectDigest,evidenceId:SubjectId,sourceReviewed:Type.Boolean()},closed),
]);
export type SubjectCodeCommand=Static<typeof SubjectCodeCommandSchema>;
export const SubjectCodeReadSchema=Type.Object({id:SubjectId,versionId:Type.Optional(SubjectId),recordAsOf:Type.Optional(SubjectTime),history:Type.Optional(Type.Boolean())},closed);
export const SubjectCodeItemSchema=Type.Object({id:SubjectId,versionId:SubjectId,head:SubjectHead,systemCode:Type.String(),status:Type.Enum(['DRAFT','REVIEW','APPROVED']),reviewDigest:SubjectDigest,recordedAt:SubjectTime,approvedAt:SubjectEnd,sourceVerification:Type.Union([Type.Object({id:SubjectId,actor:Type.String(),evidenceId:SubjectId,sourceReviewed:Type.Boolean(),recordedAt:SubjectTime},closed),Type.Null()]),...SubjectSnapshotFields},closed);
export type SubjectCodeItem=Static<typeof SubjectCodeItemSchema>;
export function subjectCheck(schema:unknown,value:unknown){if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');}

export function openSubjectCodes(connection:string,provider:KeyProviderPort){
 const db=new Kysely<DB>({dialect:new PostgresDialect({pool:vnextPool(connection)})});
 const root=<T>(work:(s:CatalogTransactionScope)=>Promise<T>)=>db.transaction().execute(async trx=>{await sql`select pg_advisory_xact_lock(901002)`.execute(trx);return work(CatalogTransactionScope.from(trx));});
 const read=(s:CatalogTransactionScope,actor:string,input:Static<typeof SubjectCodeReadSchema>)=>sql<{r:SubjectCodeItem[]}>`select governance_catalog.subject_code_read(${actor},${JSON.stringify(input)}::jsonb) r`.execute(s).then(r=>r.rows[0]!.r);
 return {
  async command(actor:string,input:SubjectCodeCommand){subjectCheck(SubjectCodeCommandSchema,input);input=structuredClone(input);if(input.action==='CREATE'||input.action==='REVISE'){parseLocalDateTime(input.adoptedOn+'T00:00:00');parseLocalDateTime(input.validFrom);if(input.validTo!==null)parseLocalDateTime(input.validTo);}return root(async s=>{
   const source=input.action==='CREATE'||input.action==='REVISE'?input:(await read(s,actor,{id:input.target,versionId:input.versionId}))[0];if(!source)throw new Error('NOT_FOUND');
   const evidenceIds=[source.evidenceId,...(input.action==='VERIFY'?[input.evidenceId]:input.action==='APPROVE'&&'sourceVerification' in source&&source.sourceVerification?[source.sourceVerification.evidenceId]:[])],materials=[];
   for(const evidenceId of new Set(evidenceIds)){const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select governance_catalog.registration_evidence(${actor},${evidenceId}::uuid,${source.sourceVersionId}::uuid,'NORTH') r`.execute(s)).rows[0]!.r;const bytes=authenticateRegistrationEvidence(proof,provider);try{materials.push({id:evidenceId,digest:planBinding(provider,'SUBJECT_CODE_SOURCE_V1',bytes.toString('base64'))});}finally{bytes.fill(0);}}
   const materialDigest=planBinding(provider,'SUBJECT_CODE_MATERIALS_V1',materials);
   const transaction=(await sql<{v:string}>`select pg_current_xact_id()::text v`.execute(s)).rows[0]!.v,ticket=canonicalPlan({actor,transaction,operation:'CODE_COMMAND',command:input,materialDigest}),key=Buffer.from(planBinding(provider,'SUBJECT_SQL_AUTHORITY_V1',{}),'hex');
   try{return (await sql<{r:SubjectCodeItem}>`select governance_catalog.subject_code_command(${ticket},${createHmac('sha256',key).update(ticket).digest('hex')}) r`.execute(s)).rows[0]!.r;}finally{key.fill(0);}
  });},
  async read(actor:string,input:Static<typeof SubjectCodeReadSchema>){subjectCheck(SubjectCodeReadSchema,input);return root(s=>read(s,actor,input));},
  async close(){await db.destroy();},
 };
}
export type SubjectCodeOwner=ReturnType<typeof openSubjectCodes>;
