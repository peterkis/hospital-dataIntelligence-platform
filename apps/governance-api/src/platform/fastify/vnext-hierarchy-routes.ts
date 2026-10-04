import { Type, type Static, type TSchema } from 'typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { TypeBoxValidatorCompiler } from '@fastify/type-provider-typebox';
import {
  CreateHierarchyViewSchema,
  HierarchyCandidateSchema,
  HierarchyEdgeEvidenceSchema,
  HierarchyClosureSchema,
  HierarchyPublishSchema,
  HierarchySnapshotInputSchema,
  HierarchyId,
  HierarchyLocalTime,
  HierarchyNullableLocalTime,
  HierarchyListSchema,HierarchyCandidateListSchema,HierarchyHistorySchema,HierarchyWindowSchema,HierarchyFrozenCandidateSchema,HierarchyDiffSchema,
  type openHierarchy,
} from '../../modules/department-master/index.js';

const closed = { additionalProperties: false } as const;
const Text = Type.String();
const ErrorSchema = Type.Object({ code: Text, message: Text, field: Type.Optional(Text) }, closed);
const errors = { 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 500: ErrorSchema, 503: ErrorSchema };
const CandidateResult = Type.Object({
  candidateId: Type.Union([HierarchyId, Type.Null()]), digest: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  decision: Type.Enum(['PASS', 'FAIL']), issues: Type.Array(Type.Object({ code: Text, nodeKey: Type.Optional(Text), field: Type.Optional(Text) }, closed)),
}, closed);
const ApprovalResult = Type.Object({ candidateId: HierarchyId, approvedBy: Text }, closed);
const SnapshotNodeResponse = Type.Object({
  sourceEvidence: Type.Union([HierarchyEdgeEvidenceSchema, Type.Null()]),
  sourceDefinitionVersionId: Type.Union([HierarchyId, Type.Null()]),
  groupCode: Type.Optional(Text),
  nodeKey: Text, parentNodeKey: Type.Union([Text, Type.Null()]), nodeKind: Type.Enum(['DEPARTMENT', 'GROUP']),
  displayName: Text, relationName: Text, sortOrder: Type.Integer({ minimum: 0 }), isPrimaryPath: Type.Boolean(), depth: Type.Integer({ minimum: 0 }),
  nodeId: HierarchyId, departmentId: Type.Union([HierarchyId, Type.Null()]), departmentVersionId: Type.Union([HierarchyId, Type.Null()]),
  groupId: Type.Union([HierarchyId, Type.Null()]), groupVersionId: Type.Union([HierarchyId, Type.Null()]),
}, closed);
const SnapshotResponse = Type.Object({
  view: Type.Object({
    versionId: HierarchyId, ownerDepartmentVersionId: Type.Union([HierarchyId, Type.Null()]), sourceDefinitionVersionId: Type.Union([HierarchyId, Type.Null()]),
    id: HierarchyId, sourceClientKey: Text, viewCode: Text, viewName: Text,
    viewType: Type.Enum(['ADMINISTRATIVE', 'OPERATIONAL', 'MEDICAL_RECORD', 'FINANCE', 'STATISTICAL']),
    purpose: Text, aggregationRule: Text, ownerDepartmentId: Type.Union([HierarchyId, Type.Null()]),
    sourceSystemId: HierarchyId, sourceRecordId: Text, sourceVersion: Text, approvalRef: Text, status: Type.Literal('PUBLISHED'),
    sourceRecordStatus: Type.Union([Type.Literal('ACTIVE'),Type.Null()]),
    version: Type.String({ pattern: '^[1-9][0-9]*$' }), contentDigest: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  }, closed),
  validFrom: HierarchyLocalTime, validTo: HierarchyNullableLocalTime, sourceRecordedAt: HierarchyLocalTime, recordedAt: HierarchyLocalTime, recordedFrom: HierarchyLocalTime,
  nodes: Type.Array(SnapshotNodeResponse), contentDigest: Type.String({ pattern: '^[a-f0-9]{64}$' }),
}, closed);

export interface HierarchyHttpContext {
  owner: ReturnType<typeof openHierarchy>;
  actor: (request: FastifyRequest) => string;
}

export function registerHierarchyRoutes(app: FastifyInstance, context?: HierarchyHttpContext): void {
  const route = <S extends TSchema>(path: string, operationId: string, body: S, response: TSchema, handler: (owner: HierarchyHttpContext['owner'], actor: string, input: Static<S>) => Promise<unknown>) => {
    app.post<{ Body: Static<S> }>(`/api/vnext/hierarchy/${path}`, {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { operationId, body, response: { 200: response, ...errors } },
    }, request => {
      if (!context) throw new Error('BLOCKED_DEPENDENCY');
      return handler(context.owner, context.actor(request), request.body as Static<S>);
    });
  };
  route('views', 'createHierarchyView', CreateHierarchyViewSchema, Type.Object({ viewId: HierarchyId, sourceClientKey: Text, viewCode: Text }, closed), (owner, actor, input) => owner.createHierarchyView(actor, input));
  route('views/list','listHierarchyViews',HierarchyListSchema,Type.Object({items:Type.Array(Type.Object({viewId:HierarchyId,viewCode:Text,sourceClientKey:Text,viewName:Type.Union([Text,Type.Null()]),state:Type.Enum(['DRAFT','PUBLISHED','CLOSED','REVOKED']),version:Type.Union([Text,Type.Null()]),versionId:Type.Union([HierarchyId,Type.Null()]),canWrite:Type.Boolean(),canReview:Type.Boolean(),recordedAt:HierarchyLocalTime},closed)),nextCursor:Type.Union([HierarchyId,Type.Null()])},closed),(owner,actor,input)=>owner.listHierarchyViews(actor,input));
  route('candidates/list','listHierarchyCandidates',HierarchyCandidateListSchema,Type.Object({items:Type.Array(Type.Object({candidateId:HierarchyId,viewId:HierarchyId,requestId:HierarchyId,digest:Text,status:Type.Enum(['VALIDATED','APPROVED','APPLIED','REJECTED']),maker:Text,approvedBy:Type.Union([Text,Type.Null()]),recordedAt:HierarchyLocalTime},closed)),nextCursor:Type.Union([HierarchyId,Type.Null()])},closed),(owner,actor,input)=>owner.listHierarchyCandidates(actor,input));
  route('history','hierarchyHistory',HierarchyHistorySchema,Type.Object({items:Type.Array(SnapshotResponse),nextCursor:Type.Union([Text,Type.Null()])},closed),(owner,actor,input)=>owner.hierarchyHistory(actor,input));
  route('snapshots/window','readHierarchyWindow',HierarchyWindowSchema,Type.Object({version:Type.Union([Text,Type.Null()]),viewState:Type.Enum(['ACTIVE','CLOSED','REVOKED']),selectionPolicy:Type.Literal('FROZEN_PUBLICATION_WINDOW_V1'),snapshot:Type.Union([SnapshotResponse,Type.Null()])},closed),(owner,actor,input)=>owner.readHierarchyWindow(actor,input));
  route('candidates', 'importHierarchyCandidate', HierarchyCandidateSchema, CandidateResult, (owner, actor, input) => owner.importHierarchyCandidate(actor, input));
  route('candidates/read','readHierarchyCandidate',Type.Object({candidateId:HierarchyId},closed),Type.Object({candidateId:HierarchyId,viewId:HierarchyId,digest:Text,maker:Text,approvedBy:Type.Union([Text,Type.Null()]),requestId:HierarchyId,status:Type.Enum(['VALIDATED','APPROVED','APPLIED','REJECTED']),currentSchema:Type.Boolean(),payload:HierarchyFrozenCandidateSchema},closed),(owner,actor,input)=>owner.readHierarchyCandidate(actor,input));
  route('candidates/approve', 'approveHierarchyCandidate', Type.Object({ candidateId: HierarchyId, digest: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, closed), ApprovalResult, (owner, actor, input) => owner.approveHierarchyCandidate(actor, input));
  route('candidates/publish', 'publishHierarchySnapshot', HierarchyPublishSchema, SnapshotResponse, (owner, actor, input) => owner.publishHierarchySnapshot(actor, input));
  route('snapshots/read', 'readHierarchySnapshot', HierarchySnapshotInputSchema, Type.Union([SnapshotResponse, Type.Null()]), (owner, actor, input) => owner.readHierarchySnapshot(actor, input));
  route('snapshots/diff','diffHierarchySnapshots',HierarchyDiffSchema,Type.Object({before:SnapshotResponse,after:SnapshotResponse},closed),(owner,actor,input)=>owner.diffHierarchySnapshots(actor,input));
  route('closures', 'prepareHierarchyClosure', HierarchyClosureSchema, Type.Object({candidateId:HierarchyId,digest:Text},closed), (owner,actor,input)=>owner.prepareHierarchyClosure(actor,input));
  route('closures/apply', 'closeHierarchyView', HierarchyPublishSchema, Type.Object({closureId:HierarchyId,viewId:HierarchyId,version:Text,status:Type.Enum(['CLOSED','REVOKED']),recordedAt:HierarchyLocalTime},closed), (owner,actor,input)=>owner.closeHierarchyView(actor,input));
}
