import type { RequestContext, TransactionRunner } from '../../platform/transaction/transaction-runner.js';
import type { AuditModule } from '../audit/index.js';
import type {
  AuthorizationModule,
  ObjectPermissionCode,
} from '../authorization/index.js';
import {
  CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION,
  CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION_V2,
  CHARGE_CATALOG_PROJECTION_TYPE,
  type ChargeCatalogModule,
} from '../charge-catalog/index.js';
import type { EmergencyControlModule } from '../emergency-control/index.js';
import {
  DEPARTMENT_HIERARCHY_PROJECTION_TYPE,
  DEPARTMENT_MASTER_PROJECTION_TYPE,
  DEPARTMENT_PROJECTION_SCHEMA_VERSION,
  type DepartmentMasterModule,
} from '../department-master/index.js';
import {
  PRICE_LIST_PROJECTION_SCHEMA_VERSION,
  PRICE_LIST_PROJECTION_SCHEMA_VERSION_V2,
  PRICE_LIST_PROJECTION_TYPE,
  type PriceListModule,
} from '../price-list/index.js';
import type {
  RegisteredPublication,
  ReleaseDistributionModule,
} from '../release-distribution/index.js';
import type {
  ChangeRequestView,
  WorkflowModule,
  WorkflowStageType,
} from './store.js';

export type GovernedEntityType =
  | 'CHARGE_ITEM_VERSION'
  | 'PRICE_LIST_RELEASE'
  | 'DEPARTMENT_VERSION'
  | 'DEPARTMENT_HIERARCHY_VIEW_VERSION';
export type ChangeKind =
  | 'INITIAL_PUBLICATION'
  | 'VERSION_CHANGE'
  | 'RETROACTIVE_CORRECTION'
  | 'CAMPUS_DIFFERENCE_PRICE'
  | 'PROJECTION_SCHEMA_UPGRADE'
  | 'RECOVERY_PUBLICATION';
export type RiskClassification = 'NORMAL' | 'HIGH' | 'PURE_SCHEMA_UPGRADE' | 'RECOVERY';

export interface WorkflowApplicationScope {
  readonly audit: AuditModule;
  readonly authorization: AuthorizationModule;
  readonly chargeCatalog: ChargeCatalogModule;
  readonly departmentMaster: DepartmentMasterModule;
  readonly emergencyControl: EmergencyControlModule;
  readonly priceList: PriceListModule;
  readonly releaseDistribution: ReleaseDistributionModule;
  readonly workflow: WorkflowModule;
}

export interface SubmitChangeRequestCommand {
  readonly governanceObjectId: string;
  readonly entityType: GovernedEntityType;
  readonly stableEntityId: string;
  readonly entityVersionId: string;
  readonly changeKind: ChangeKind;
  readonly riskClassification: RiskClassification;
  readonly submittedContentDigest: string;
  readonly changeReason: string;
  readonly campusId: string | null;
  readonly frozenEvidence: Readonly<Record<string, unknown>>;
}

export interface ActOnChangeRequestCommand {
  readonly changeRequestId: string;
  readonly stageType: WorkflowStageType;
  readonly actionResult: 'APPROVED' | 'REJECTED';
  readonly reason: string;
  readonly seenContentDigest: string;
  readonly campusId: string | null;
}

export interface WorkflowActionResult {
  readonly request: ChangeRequestView;
  readonly publication: RegisteredPublication | null;
}

export interface WorkflowApplication {
  submit(
    context: RequestContext,
    command: SubmitChangeRequestCommand,
  ): Promise<ChangeRequestView>;
  get(
    context: RequestContext,
    changeRequestId: string,
  ): Promise<{
    readonly request: ChangeRequestView;
    readonly actions: Awaited<ReturnType<WorkflowModule['listActions']>>;
  }>;
  act(
    context: RequestContext,
    command: ActOnChangeRequestCommand,
  ): Promise<WorkflowActionResult>;
  withdraw(
    context: RequestContext,
    command: { readonly changeRequestId: string; readonly reason: string },
  ): Promise<ChangeRequestView>;
}

export function createWorkflowApplication(
  transactionRunner: TransactionRunner<WorkflowApplicationScope>,
  onPublicationCommitted?: () => void,
): WorkflowApplication {
  return {
    submit(context, command) {
      return transactionRunner.run(context, async (modules) => {
        const actualHash = await loadGovernedEntityHash(modules, command);
        if (actualHash.toString('hex') !== command.submittedContentDigest) {
          throw new Error('APPROVAL_CONTENT_DRIFT');
        }
        validateChangeRequestClassification(command, actualHash);
        const permissionCode: ObjectPermissionCode = command.entityType === 'CHARGE_ITEM_VERSION'
          ? 'CHARGE_CATALOG_SUBMIT'
          : command.entityType === 'PRICE_LIST_RELEASE'
            ? 'PRICE_LIST_SUBMIT'
            : command.entityType === 'DEPARTMENT_VERSION'
              ? 'DEPARTMENT_MASTER_SUBMIT'
              : 'DEPARTMENT_HIERARCHY_SUBMIT';
        await modules.authorization.requireObjectPermission({
          governanceObjectId: command.governanceObjectId,
          permissionCode,
          campusId: command.campusId,
        });
        const submitted = await modules.workflow.submitChange({
          governanceObjectId: command.governanceObjectId,
          governedEntityType: command.entityType,
          stableEntityId: command.stableEntityId,
          entityVersionId: command.entityVersionId,
          changeKind: command.changeKind,
          riskClassification: command.riskClassification,
          submittedContentHash: actualHash,
          changeReason: command.changeReason,
          frozenEvidence: {
            ...command.frozenEvidence,
            entityType: command.entityType,
            campusId: command.campusId,
          },
        });
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'CHANGE_REQUEST',
          stableEntityId: submitted.changeRequestId,
          entityVersionId: command.entityVersionId,
          action: 'CHANGE_SUBMITTED',
          afterHash: actualHash,
          authorityScope: 'VERSIONED_APPROVAL',
        });
        return submitted;
      });
    },

    get(context, changeRequestId) {
      return transactionRunner.run(context, async (modules) => {
        const current = await modules.workflow.getChangeRequest(changeRequestId);
        if (!current) throw new Error('CHANGE_REQUEST_NOT_FOUND');
        const expectedPermission = !['APPROVED', 'REJECTED', 'WITHDRAWN'].includes(
          current.requestStatus,
        )
          ? ((await modules.workflow.getExpectedStage(current.changeRequestId))
              .permissionCode as ObjectPermissionCode)
          : null;
        const campusId = frozenCampusId(current.frozenEvidence);
        const stageDecision = expectedPermission
          ? await modules.authorization.evaluateObjectPermission({
              governanceObjectId: current.governanceObjectId,
              permissionCode: expectedPermission,
              campusId,
            })
          : null;
        if (!stageDecision?.allowed) {
          await modules.authorization.requireObjectPermission({
            governanceObjectId: current.governanceObjectId,
            permissionCode: 'AUDIT_READ',
          });
        }
        return {
          request: current,
          actions: await modules.workflow.listActions(changeRequestId),
        };
      });
    },

    async act(context, command) {
      const result = await transactionRunner.run(context, async (modules) => {
        const expected = await modules.workflow.getExpectedStage(command.changeRequestId);
        if (expected.stageType !== command.stageType) {
          throw new Error('APPROVAL_STAGE_ORDER_CONFLICT');
        }
        if (expected.campusScopeRequired && !command.campusId) {
          throw new Error('APPROVAL_CAMPUS_CONFIRMATION_REQUIRED');
        }
        await modules.authorization.requireObjectPermission({
          governanceObjectId: expected.changeRequest.governanceObjectId,
          permissionCode: expected.permissionCode as ObjectPermissionCode,
          campusId: expected.campusScopeRequired ? command.campusId : null,
        });
        const entityType = governedEntityTypeFrom(expected.changeRequest.frozenEvidence);
        const actualHash = await loadGovernedEntityHash(modules, {
          governanceObjectId: expected.changeRequest.governanceObjectId,
          entityType,
          stableEntityId: expected.changeRequest.stableEntityId,
          entityVersionId: expected.changeRequest.entityVersionId,
        });
        if (
          actualHash.toString('hex') !== command.seenContentDigest ||
          !actualHash.equals(expected.changeRequest.submittedContentHash)
        ) {
          throw new Error('APPROVAL_CONTENT_DRIFT');
        }
        const decided = await modules.workflow.actOnChange({
          changeRequestId: command.changeRequestId,
          stageType: command.stageType,
          actionResult: command.actionResult,
          reason: command.reason,
          seenContentHash: actualHash,
        });
        await modules.audit.append({
          auditStreamId: decided.governanceObjectId,
          governanceObjectId: decided.governanceObjectId,
          entityType: 'CHANGE_REQUEST',
          stableEntityId: decided.changeRequestId,
          entityVersionId: decided.entityVersionId,
          action: 'APPROVAL_ACTIONED',
          afterHash: actualHash,
          authorityScope: command.stageType,
        });
        const publication =
          decided.requestStatus === 'APPROVED'
            ? await publishApprovedDraft(modules, context, decided, entityType)
            : null;
        return { request: decided, publication };
      });
      if (result.publication) signalPublicationCommitted(onPublicationCommitted);
      return result;
    },

    withdraw(context, command) {
      return transactionRunner.run(context, async (modules) => {
        const withdrawn = await modules.workflow.withdrawChange(command);
        await modules.audit.append({
          auditStreamId: withdrawn.governanceObjectId,
          governanceObjectId: withdrawn.governanceObjectId,
          entityType: 'CHANGE_REQUEST',
          stableEntityId: withdrawn.changeRequestId,
          entityVersionId: withdrawn.entityVersionId,
          action: 'CHANGE_WITHDRAWN',
          afterHash: withdrawn.submittedContentHash,
          authorityScope: 'VERSIONED_APPROVAL',
        });
        return withdrawn;
      });
    },
  };
}

async function loadGovernedEntityHash(
  modules: Pick<WorkflowApplicationScope, 'chargeCatalog' | 'priceList' | 'departmentMaster'>,
  command: {
    readonly governanceObjectId: string;
    readonly entityType: GovernedEntityType;
    readonly stableEntityId: string;
    readonly entityVersionId: string;
  },
): Promise<Buffer> {
  if (command.entityType === 'CHARGE_ITEM_VERSION') {
    const version = await modules.chargeCatalog.getVersion({
      governanceObjectId: command.governanceObjectId,
      chargeItemId: command.stableEntityId,
      chargeItemVersionId: command.entityVersionId,
    });
    return version.contentHash;
  }
  if (command.entityType === 'DEPARTMENT_VERSION') {
    const version = await modules.departmentMaster.getDepartmentVersion({
      governanceObjectId: command.governanceObjectId,
      departmentId: command.stableEntityId,
      departmentVersionId: command.entityVersionId,
    });
    return version.contentHash;
  }
  if (command.entityType === 'DEPARTMENT_HIERARCHY_VIEW_VERSION') {
    const snapshot = await modules.departmentMaster.getHierarchySnapshot({
      governanceObjectId: command.governanceObjectId,
      hierarchyViewVersionId: command.entityVersionId,
    });
    if (!snapshot || snapshot.view.id !== command.stableEntityId) {
      throw new Error('DEPARTMENT_HIERARCHY_VERSION_NOT_FOUND');
    }
    return snapshot.version.contentHash;
  }
  const release = await modules.priceList.getRelease({
    governanceObjectId: command.governanceObjectId,
    priceListId: command.stableEntityId,
    priceListReleaseId: command.entityVersionId,
  });
  if (!release) throw new Error('PRICE_LIST_RELEASE_NOT_FOUND');
  return release.contentHash;
}

function validateChangeRequestClassification(
  command: SubmitChangeRequestCommand,
  actualHash: Buffer,
): void {
  if (command.changeKind === 'PROJECTION_SCHEMA_UPGRADE') {
    if (command.riskClassification !== 'PURE_SCHEMA_UPGRADE') {
      throw new Error('SCHEMA_UPGRADE_RISK_CLASSIFICATION_REQUIRED');
    }
    const evidence = command.frozenEvidence;
    const requiredDigests = [
      'oldSchemaDigest',
      'newSchemaDigest',
      'openApiDiffDigest',
      'memberSetDigest',
      'compatibilityMatrixDigest',
      'simulationEvidenceDigest',
    ];
    for (const key of requiredDigests) {
      if (typeof evidence[key] !== 'string' || !/^[0-9a-f]{64}$/u.test(evidence[key])) {
        throw new Error('SCHEMA_UPGRADE_EVIDENCE_INCOMPLETE');
      }
    }
    if (evidence['domainContentDigest'] !== actualHash.toString('hex')) {
      throw new Error('SCHEMA_UPGRADE_DOMAIN_EQUIVALENCE_MISMATCH');
    }
    if (evidence['oldSchemaVersion'] !== '1' || evidence['newSchemaVersion'] !== '2') {
      throw new Error('SCHEMA_UPGRADE_CONTRACT_IDENTITY_INVALID');
    }
    if (
      evidence['domainChanged'] !== false ||
      evidence['membersChanged'] !== false ||
      evidence['rulesChanged'] !== false ||
      evidence['lifecycleChanged'] !== false
    ) {
      throw new Error('SCHEMA_UPGRADE_SCOPE_MISMATCH');
    }
    return;
  }
  if (command.riskClassification === 'PURE_SCHEMA_UPGRADE') {
    throw new Error('SCHEMA_UPGRADE_SCOPE_MISMATCH');
  }
  if (command.changeKind === 'RECOVERY_PUBLICATION') {
    if (
      command.entityType !== 'PRICE_LIST_RELEASE' ||
      command.riskClassification !== 'RECOVERY'
    ) {
      throw new Error('RECOVERY_PUBLICATION_CLASSIFICATION_REQUIRED');
    }
    return;
  }
  if (
    command.entityType === 'PRICE_LIST_RELEASE' &&
    command.riskClassification !== 'HIGH'
  ) {
    throw new Error('PRICE_LIST_HIGH_RISK_CLASSIFICATION_REQUIRED');
  }
  if (
    command.changeKind === 'CAMPUS_DIFFERENCE_PRICE' &&
    (!command.campusId || command.entityType !== 'PRICE_LIST_RELEASE')
  ) {
    throw new Error('CAMPUS_PRICE_SCOPE_REQUIRED');
  }
}

async function publishApprovedDraft(
  modules: WorkflowApplicationScope,
  context: RequestContext,
  request: ChangeRequestView,
  entityType: GovernedEntityType,
): Promise<RegisteredPublication> {
  if (request.changeKind === 'PROJECTION_SCHEMA_UPGRADE') {
    const catalogCode = frozenCatalogCode(request.frozenEvidence);
    if (entityType === 'CHARGE_ITEM_VERSION') {
      const prepared = await modules.chargeCatalog.prepareVersionProjection({
        governanceObjectId: request.governanceObjectId,
        catalogCode,
        chargeItemId: request.stableEntityId,
        chargeItemVersionId: request.entityVersionId,
      });
      const item = prepared.projection.items[0];
      if (!item) throw new Error('CHARGE_ITEM_PROJECTION_EMPTY');
      const publication = await modules.releaseDistribution.registerPublication({
        governanceObjectId: request.governanceObjectId,
        aggregateType: 'CHARGE_CATALOG',
        releaseKind: 'CONTRACT_SCHEMA_UPGRADE',
        businessValidFrom: item.businessValidFrom,
        businessValidTo: item.businessValidTo,
        recordedFrom: context.occurredAt,
        submittedBy: request.submittedBy,
        approvedBy: context.actorPrincipalId,
        approvedAt: context.occurredAt,
        changeReason: request.changeReason,
        projection: {
          projectionType: CHARGE_CATALOG_PROJECTION_TYPE,
          schemaVersion: CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION_V2,
          payload: { ...prepared.projection, contractRevision: '2' as const },
          itemCount: prepared.projection.items.length,
        },
        member: {
          kind: 'CHARGE_ITEM',
          stableId: prepared.chargeItemId,
          versionId: prepared.chargeItemVersionId,
          snapshotName: item.formalName,
          memberHash: prepared.contentHash,
        },
      });
      await modules.audit.append({
        auditStreamId: request.governanceObjectId,
        governanceObjectId: request.governanceObjectId,
        entityType: 'CHANGE_REQUEST',
        stableEntityId: request.changeRequestId,
        entityVersionId: request.entityVersionId,
        action: 'SCHEMA_UPGRADE_PUBLISHED',
        afterHash: prepared.contentHash,
        authorityScope: 'PROJECTION_CONTRACT',
      });
      return publication;
    }
    const prepared = await modules.priceList.prepareReleaseProjection({
      governanceObjectId: request.governanceObjectId,
      priceListId: request.stableEntityId,
      priceListReleaseId: request.entityVersionId,
    });
    const publication = await modules.releaseDistribution.registerPublication({
      governanceObjectId: request.governanceObjectId,
      aggregateType: 'PRICE_LIST',
      releaseKind: 'CONTRACT_SCHEMA_UPGRADE',
      businessValidFrom: prepared.projection.businessValidFrom,
      businessValidTo: prepared.projection.businessValidTo,
      recordedFrom: context.occurredAt,
      submittedBy: request.submittedBy,
      approvedBy: context.actorPrincipalId,
      approvedAt: context.occurredAt,
      changeReason: request.changeReason,
      projection: {
        projectionType: PRICE_LIST_PROJECTION_TYPE,
        schemaVersion: PRICE_LIST_PROJECTION_SCHEMA_VERSION_V2,
        payload: { ...prepared.projection, contractRevision: '2' as const },
        itemCount: prepared.projection.entries.length,
      },
      member: {
        kind: 'PRICE_LIST',
        stableId: prepared.priceListId,
        versionId: prepared.priceListReleaseId,
        snapshotName: prepared.projection.displayName,
        memberHash: prepared.contentHash,
      },
    });
    await modules.audit.append({
      auditStreamId: request.governanceObjectId,
      governanceObjectId: request.governanceObjectId,
      entityType: 'CHANGE_REQUEST',
      stableEntityId: request.changeRequestId,
      entityVersionId: request.entityVersionId,
      action: 'SCHEMA_UPGRADE_PUBLISHED',
      afterHash: prepared.contentHash,
      authorityScope: 'PROJECTION_CONTRACT',
    });
    return publication;
  }
  if (entityType === 'DEPARTMENT_VERSION') {
    await modules.authorization.requireObjectPermission({
      governanceObjectId: request.governanceObjectId,
      permissionCode: 'DEPARTMENT_MASTER_PUBLISH',
    });
    const prepared = await modules.departmentMaster.prepareDepartmentPublication({
      governanceObjectId: request.governanceObjectId,
      departmentId: request.stableEntityId,
      departmentVersionId: request.entityVersionId,
    });
    const publication = await modules.releaseDistribution.registerPublication({
      governanceObjectId: request.governanceObjectId,
      aggregateType: 'DEPARTMENT_MASTER',
      businessValidFrom: prepared.projection.businessValidFrom,
      businessValidTo: prepared.projection.businessValidTo,
      recordedFrom: context.occurredAt,
      submittedBy: request.submittedBy,
      approvedBy: context.actorPrincipalId,
      approvedAt: context.occurredAt,
      changeReason: request.changeReason,
      projection: {
        projectionType: DEPARTMENT_MASTER_PROJECTION_TYPE,
        schemaVersion: DEPARTMENT_PROJECTION_SCHEMA_VERSION,
        payload: prepared.projection,
        itemCount: 1,
      },
      member: {
        kind: 'DEPARTMENT',
        stableId: prepared.departmentId,
        versionId: prepared.departmentVersionId,
        snapshotName: prepared.projection.standardName,
        memberHash: prepared.contentHash,
      },
    });
    await modules.departmentMaster.confirmDepartmentPublication({
      governanceObjectId: request.governanceObjectId,
      departmentId: prepared.departmentId,
      departmentVersionId: prepared.departmentVersionId,
      releaseId: publication.releaseId,
      recordedFrom: context.occurredAt,
      actorPrincipalId: context.actorPrincipalId,
    });
    await modules.audit.append({
      auditStreamId: request.governanceObjectId,
      governanceObjectId: request.governanceObjectId,
      entityType: 'DEPARTMENT_VERSION',
      stableEntityId: prepared.departmentId,
      entityVersionId: prepared.departmentVersionId,
      action: 'PUBLISHED',
      afterHash: prepared.contentHash,
      authorityScope: 'APPROVED_CHANGE_REQUEST',
    });
    return publication;
  }
  if (entityType === 'DEPARTMENT_HIERARCHY_VIEW_VERSION') {
    await modules.authorization.requireObjectPermission({
      governanceObjectId: request.governanceObjectId,
      permissionCode: 'DEPARTMENT_HIERARCHY_PUBLISH',
    });
    const prepared = await modules.departmentMaster.prepareHierarchyPublication({
      governanceObjectId: request.governanceObjectId,
      hierarchyViewId: request.stableEntityId,
      hierarchyViewVersionId: request.entityVersionId,
    });
    const publication = await modules.releaseDistribution.registerPublication({
      governanceObjectId: request.governanceObjectId,
      aggregateType: 'DEPARTMENT_HIERARCHY',
      businessValidFrom: prepared.projection.businessValidFrom,
      businessValidTo: prepared.projection.businessValidTo,
      recordedFrom: context.occurredAt,
      submittedBy: request.submittedBy,
      approvedBy: context.actorPrincipalId,
      approvedAt: context.occurredAt,
      changeReason: request.changeReason,
      projection: {
        projectionType: DEPARTMENT_HIERARCHY_PROJECTION_TYPE,
        schemaVersion: DEPARTMENT_PROJECTION_SCHEMA_VERSION,
        payload: prepared.projection,
        itemCount: prepared.projection.nodes.length,
      },
      member: {
        kind: 'DEPARTMENT_HIERARCHY',
        stableId: prepared.hierarchyViewId,
        versionId: prepared.hierarchyViewVersionId,
        snapshotName: prepared.projection.viewCode,
        memberHash: prepared.contentHash,
      },
    });
    await modules.departmentMaster.confirmHierarchyPublication({
      governanceObjectId: request.governanceObjectId,
      hierarchyViewId: prepared.hierarchyViewId,
      hierarchyViewVersionId: prepared.hierarchyViewVersionId,
      releaseId: publication.releaseId,
      recordedFrom: context.occurredAt,
      actorPrincipalId: context.actorPrincipalId,
    });
    await modules.audit.append({
      auditStreamId: request.governanceObjectId,
      governanceObjectId: request.governanceObjectId,
      entityType: 'DEPARTMENT_HIERARCHY_VIEW_VERSION',
      stableEntityId: prepared.hierarchyViewId,
      entityVersionId: prepared.hierarchyViewVersionId,
      action: 'PUBLISHED',
      afterHash: prepared.contentHash,
      authorityScope: 'APPROVED_CHANGE_REQUEST',
    });
    return publication;
  }
  if (entityType === 'CHARGE_ITEM_VERSION') {
    const prepared = await modules.chargeCatalog.prepareDraftPublication({
      governanceObjectId: request.governanceObjectId,
      catalogCode: frozenCatalogCode(request.frozenEvidence),
      chargeItemId: request.stableEntityId,
      chargeItemVersionId: request.entityVersionId,
    });
    const item = prepared.projection.items[0];
    if (!item) throw new Error('CHARGE_ITEM_PROJECTION_EMPTY');
    const publication = await modules.releaseDistribution.registerPublication({
      governanceObjectId: request.governanceObjectId,
      aggregateType: 'CHARGE_CATALOG',
      releaseKind: request.changeKind === 'RECOVERY_PUBLICATION' ? 'COMPENSATION' : 'NORMAL',
      businessValidFrom: item.businessValidFrom,
      businessValidTo: item.businessValidTo,
      recordedFrom: context.occurredAt,
      submittedBy: request.submittedBy,
      approvedBy: context.actorPrincipalId,
      approvedAt: context.occurredAt,
      changeReason: request.changeReason,
      projection: {
        projectionType: CHARGE_CATALOG_PROJECTION_TYPE,
        schemaVersion: CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION,
        payload: prepared.projection,
        itemCount: prepared.projection.items.length,
      },
      member: {
        kind: 'CHARGE_ITEM',
        stableId: prepared.chargeItemId,
        versionId: prepared.chargeItemVersionId,
        snapshotName: item.formalName,
        memberHash: prepared.contentHash,
      },
    });
    await modules.chargeCatalog.confirmPublication({
      chargeItemVersionId: prepared.chargeItemVersionId,
      releaseId: publication.releaseId,
    });
    await modules.audit.append({
      auditStreamId: request.governanceObjectId,
      governanceObjectId: request.governanceObjectId,
      entityType: 'CHARGE_ITEM_VERSION',
      stableEntityId: prepared.chargeItemId,
      entityVersionId: prepared.chargeItemVersionId,
      action: 'PUBLISHED',
      afterHash: prepared.contentHash,
      authorityScope: 'APPROVED_CHANGE_REQUEST',
    });
    return publication;
  }

  const prepared = await modules.priceList.prepareDraftPublication({
    governanceObjectId: request.governanceObjectId,
    priceListId: request.stableEntityId,
    priceListReleaseId: request.entityVersionId,
    recordedFrom: context.occurredAt,
  });
  const publication = await modules.releaseDistribution.registerPublication({
    governanceObjectId: request.governanceObjectId,
    aggregateType: 'PRICE_LIST',
    releaseKind: request.changeKind === 'RECOVERY_PUBLICATION' ? 'COMPENSATION' : 'NORMAL',
    businessValidFrom: prepared.projection.businessValidFrom,
    businessValidTo: prepared.projection.businessValidTo,
    recordedFrom: context.occurredAt,
    submittedBy: request.submittedBy,
    approvedBy: context.actorPrincipalId,
    approvedAt: context.occurredAt,
    changeReason: request.changeReason,
    projection: {
      projectionType: PRICE_LIST_PROJECTION_TYPE,
      schemaVersion: PRICE_LIST_PROJECTION_SCHEMA_VERSION,
      payload: prepared.projection,
      itemCount: prepared.projection.entries.length,
    },
    member: {
      kind: 'PRICE_LIST',
      stableId: prepared.priceListId,
      versionId: prepared.priceListReleaseId,
      snapshotName: prepared.projection.displayName,
      memberHash: prepared.contentHash,
    },
  });
  await modules.priceList.confirmPublication({
    priceListReleaseId: prepared.priceListReleaseId,
    governanceReleaseId: publication.releaseId,
    recordedFrom: context.occurredAt,
    contentHash: prepared.contentHash,
  });
  if (request.changeKind === 'RECOVERY_PUBLICATION') {
    const impactCaseId = request.frozenEvidence['impactCaseId'];
    if (typeof impactCaseId !== 'string') throw new Error('RECOVERY_IMPACT_CASE_REQUIRED');
    const source = await modules.emergencyControl.prepareRecoveryLink({ impactCaseId });
    const sourceRelease = await modules.priceList.getRelease({
      governanceObjectId: request.governanceObjectId,
      priceListId: prepared.priceListId,
      priceListReleaseId: source.suspendedPriceListReleaseId,
    });
    if (!sourceRelease?.governanceReleaseId) {
      throw new Error('SUSPENDED_GOVERNANCE_RELEASE_MISSING');
    }
    await modules.releaseDistribution.linkReleaseRelationship({
      sourceReleaseId: sourceRelease.governanceReleaseId,
      targetReleaseId: publication.releaseId,
      relationshipType: 'COMPENSATES',
      reason: request.changeReason,
    });
    await modules.emergencyControl.confirmRecoveryPublication({
      impactCaseId,
      recoveryReleaseId: publication.releaseId,
      reason: request.changeReason,
    });
  }
  await modules.audit.append({
    auditStreamId: request.governanceObjectId,
    governanceObjectId: request.governanceObjectId,
    entityType: 'PRICE_LIST_RELEASE',
    stableEntityId: prepared.priceListId,
    entityVersionId: prepared.priceListReleaseId,
    action: 'PUBLISHED',
    afterHash: prepared.contentHash,
    authorityScope: 'APPROVED_CHANGE_REQUEST',
  });
  return publication;
}

function governedEntityTypeFrom(
  evidence: Readonly<Record<string, unknown>>,
): GovernedEntityType {
  const entityType = evidence['entityType'];
  if (
    entityType !== 'CHARGE_ITEM_VERSION' &&
    entityType !== 'PRICE_LIST_RELEASE' &&
    entityType !== 'DEPARTMENT_VERSION' &&
    entityType !== 'DEPARTMENT_HIERARCHY_VIEW_VERSION'
  ) {
    throw new Error('APPROVAL_ENTITY_TYPE_EVIDENCE_MISSING');
  }
  return entityType;
}

function frozenCampusId(evidence: Readonly<Record<string, unknown>>): string | null {
  const campusId = evidence['campusId'];
  if (campusId === null || campusId === undefined) return null;
  if (typeof campusId !== 'string') throw new Error('APPROVAL_CAMPUS_EVIDENCE_INVALID');
  return campusId;
}

function frozenCatalogCode(evidence: Readonly<Record<string, unknown>>): string {
  return typeof evidence['catalogCode'] === 'string'
    ? evidence['catalogCode']
    : 'PHASE01-CHARGE-CATALOG';
}

function signalPublicationCommitted(callback: (() => void) | undefined): void {
  if (!callback) return;
  try {
    callback();
  } catch {
    // Durable database polling remains authoritative if the best-effort wake signal is lost.
  }
}
