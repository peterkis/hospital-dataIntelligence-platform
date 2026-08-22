import { sql, type Kysely } from 'kysely';
import type { TSchema } from 'typebox';
import { Check } from 'typebox/value';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import { hitControlledPublicationFault } from '../../platform/fault-injection/controlled-faults.js';
import {
  canonicalJson,
  canonicalSha256,
  digestHex,
  sha256Bytes,
} from '../../platform/hashing/canonical-hash.js';
export {
  createReleaseDistributionDispatcher,
  ReleaseNotificationError,
  type ReleaseDistributionDispatcher,
  type ReleaseNotification,
  type ReleaseNotificationTransport,
} from './outbox-dispatcher.js';
export { createHttpReleaseNotificationTransport } from './http-notification-transport.js';

export const RELEASE_DISTRIBUTION_MODULE_ID = 'release-distribution' as const;

const SNAPSHOT_LIMIT_BYTES = 16_777_216;
const ZERO_DIGEST = Buffer.alloc(32);

export interface ProjectionContractRegistration {
  readonly projectionType: string;
  readonly schemaVersion: string;
  readonly schema: TSchema;
}

export interface FrozenProjection<Payload = unknown> {
  readonly projectionType: string;
  readonly schemaVersion: string;
  readonly payload: Payload;
  readonly itemCount: number;
}

export type ReleaseMember =
  | {
      readonly kind: 'CHARGE_ITEM';
      readonly stableId: string;
      readonly versionId: string;
      readonly snapshotName: string;
      readonly memberHash: Buffer;
    }
  | {
      readonly kind: 'PRICE_LIST';
      readonly stableId: string;
      readonly versionId: string;
      readonly snapshotName: string;
      readonly memberHash: Buffer;
    };

export interface RegisterPublicationCommand<Payload = unknown> {
  readonly governanceObjectId: string;
  readonly aggregateType: 'CHARGE_CATALOG' | 'PRICE_LIST';
  readonly releaseKind?:
    | 'NORMAL'
    | 'COMPENSATION'
    | 'HISTORICAL_REPUBLICATION'
    | 'CONTRACT_SCHEMA_UPGRADE';
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly recordedFrom: string;
  readonly submittedBy: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly changeReason: string;
  readonly projection: FrozenProjection<Payload>;
  readonly member: ReleaseMember;
}

export interface RegisteredPublication {
  readonly releaseId: string;
  readonly releaseNo: string;
  readonly snapshotId: string;
  readonly eventId: string;
  readonly projectionSchemaDigest: Buffer;
  readonly projectionPayloadDigest: Buffer;
  readonly snapshotArtifactDigest: Buffer;
  readonly artifactByteLength: number;
}

export interface CanonicalSnapshotArtifactInput<Payload = unknown> {
  readonly aggregateType: 'CHARGE_CATALOG' | 'PRICE_LIST';
  readonly governanceObjectId: string;
  readonly releaseId: string;
  readonly releaseNo: string;
  readonly releaseKind:
    | 'NORMAL'
    | 'COMPENSATION'
    | 'HISTORICAL_REPUBLICATION'
    | 'CONTRACT_SCHEMA_UPGRADE';
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly projectionType: string;
  readonly projectionSchemaVersion: string;
  readonly projectionSchemaDigest: Buffer;
  readonly payload: Payload;
}

export function buildCanonicalSnapshotArtifact<Payload>(
  input: CanonicalSnapshotArtifactInput<Payload>,
): Buffer {
  return Buffer.from(
    canonicalJson({
      envelopeContractVersion: 'phase-01.v1',
      release: {
        aggregateType: input.aggregateType,
        governanceObjectId: input.governanceObjectId,
        releaseId: input.releaseId,
        releaseNo: input.releaseNo,
        releaseKind: input.releaseKind,
        businessValidFrom: input.businessValidFrom,
        businessValidTo: input.businessValidTo,
      },
      projectionContract: {
        projectionType: input.projectionType,
        schemaVersion: input.projectionSchemaVersion,
        schemaDigestAlgorithm: 'SHA-256',
        schemaDigest: digestHex(input.projectionSchemaDigest),
      },
      serializationProfileVersion: 'canonical-json.v1',
      payload: input.payload,
    }),
    'utf8',
  );
}

export interface SnapshotArtifact {
  readonly snapshotId: string;
  readonly releaseId: string;
  readonly mediaType: string;
  readonly bytes: Buffer;
  readonly byteLength: string;
  readonly digest: Buffer;
}

export interface AvailableEvent {
  readonly eventId: string;
  readonly governanceObjectId: string;
  readonly aggregateVersion: string;
  readonly releaseId: string;
  readonly snapshotId: string;
  readonly projectionType: string;
  readonly projectionSchemaVersion: string;
  readonly projectionSchemaDigest: Buffer;
  readonly projectionPayloadDigest: Buffer;
  readonly snapshotArtifactDigest: Buffer;
}

export interface ReleaseDistributionModule {
  registerPublication<Payload>(
    command: RegisterPublicationCommand<Payload>,
  ): Promise<RegisteredPublication>;
  linkReleaseRelationship(command: {
    readonly sourceReleaseId: string;
    readonly targetReleaseId: string;
    readonly relationshipType: 'COMPENSATES' | 'REPLACES' | 'REPACKAGES_CONTRACT';
    readonly reason: string;
  }): Promise<void>;
  hasAppliedReceipt(releaseId: string): Promise<boolean>;
  createSubscription(command: {
    readonly subscriptionCode: string;
    readonly servicePrincipalId: string;
    readonly governanceObjectId: string;
    readonly projectionType: string;
    readonly projectionSchemaVersion: string;
  }): Promise<{ readonly subscriptionId: string }>;
  createSubscriptionVersion(command: {
    readonly subscriptionId: string;
    readonly governanceObjectId: string;
    readonly projectionType: string;
    readonly projectionSchemaVersion: string;
  }): Promise<{
    readonly subscriptionId: string;
    readonly subscriptionVersionId: string;
    readonly versionNo: string;
  }>;
  replayBlockedDelivery(command: {
    readonly subscriptionId: string;
    readonly governanceObjectId: string;
    readonly eventId: string;
  }): Promise<{
    readonly deliveryId: string;
    readonly deliveryStateId: string;
    readonly stateSequence: string;
  }>;
  listAvailableEvents(command: {
    readonly subscriptionId: string;
    readonly servicePrincipalId: string;
    readonly afterAggregateVersion: string;
  }): Promise<readonly AvailableEvent[]>;
  getSnapshot(snapshotId: string): Promise<SnapshotArtifact>;
  getSnapshotForSubscription(command: {
    readonly subscriptionId: string;
    readonly snapshotId: string;
    readonly servicePrincipalId: string;
  }): Promise<SnapshotArtifact>;
  recordReceipt(command: {
    readonly subscriptionId: string;
    readonly servicePrincipalId: string;
    readonly eventId: string;
    readonly receiveResult: 'ACCEPTED' | 'REJECTED';
    readonly validationResult: 'VALID' | 'INVALID';
    readonly applyResult: 'APPLIED' | 'NOT_APPLIED';
    readonly processingDigest: Buffer;
    readonly processedAt: string;
  }): Promise<{ readonly receiptId: string; readonly receiptSequence: string }>;
}

interface RegisteredContract extends ProjectionContractRegistration {
  readonly schemaDigest: Buffer;
}

export function createReleaseDistributionModule(
  database: Kysely<DB>,
  registrations: readonly ProjectionContractRegistration[],
  context: RequestContext,
): ReleaseDistributionModule {
  const contracts = new Map<string, RegisteredContract>();
  for (const registration of registrations) {
    const key = contractKey(registration.projectionType, registration.schemaVersion);
    if (contracts.has(key)) throw new Error(`PROJECTION_CONTRACT_DUPLICATE:${key}`);
    contracts.set(key, {
      ...registration,
      schemaDigest: canonicalSha256(registration.schema),
    });
  }

  return {
    async linkReleaseRelationship(command) {
      await sql`
        insert into release_distribution.release_relationship (
          source_release_id, target_release_id, relationship_type, reason, created_at
        ) values (
          ${command.sourceReleaseId}::uuid, ${command.targetReleaseId}::uuid,
          ${command.relationshipType}, ${command.reason}, ${context.occurredAt}::timestamp
        )
      `.execute(database);
    },

    async hasAppliedReceipt(releaseId) {
      const result = await sql<{ readonly found: boolean }>`
        select exists (
          select 1
          from release_distribution.outbox_event event
          join release_distribution.consumer_receipt receipt on receipt.event_id = event.event_id
          where event.release_id = ${releaseId}::uuid
            and receipt.validation_result = 'VALID'
            and receipt.apply_result = 'APPLIED'
        ) as found
      `.execute(database);
      return result.rows[0]?.found ?? false;
    },

    async registerPublication(command) {
      const contract = requireContract(
        contracts,
        command.projection.projectionType,
        command.projection.schemaVersion,
      );
      if (!Check(contract.schema, command.projection.payload)) {
        throw new Error('PROJECTION_PAYLOAD_SCHEMA_INVALID');
      }
      if (!Number.isSafeInteger(command.projection.itemCount) || command.projection.itemCount < 0) {
        throw new Error('PROJECTION_ITEM_COUNT_INVALID');
      }

      await sql`select pg_advisory_xact_lock(hashtextextended(${command.governanceObjectId}, 41))`.execute(
        database,
      );
      const lastRelease = await database
        .selectFrom('release_distribution.governance_release')
        .select((expression) => expression.fn.max('release_no').as('last_release_no'))
        .where('governance_object_id', '=', command.governanceObjectId)
        .executeTakeFirstOrThrow();
      const releaseNo = (BigInt(lastRelease.last_release_no ?? '0') + 1n).toString();

      const payloadBytes = Buffer.from(canonicalJson(command.projection.payload), 'utf8');
      const projectionPayloadDigest = sha256Bytes(payloadBytes);
      const releaseId = await nextUuid(database);
      const artifactBytes = buildCanonicalSnapshotArtifact({
        aggregateType: command.aggregateType,
        governanceObjectId: command.governanceObjectId,
        releaseId,
        releaseNo,
        releaseKind: command.releaseKind ?? 'NORMAL',
        businessValidFrom: command.businessValidFrom,
        businessValidTo: command.businessValidTo,
        projectionType: contract.projectionType,
        projectionSchemaVersion: contract.schemaVersion,
        projectionSchemaDigest: contract.schemaDigest,
        payload: command.projection.payload,
      });
      if (artifactBytes.byteLength > SNAPSHOT_LIMIT_BYTES) {
        throw new Error('SNAPSHOT_ARTIFACT_TOO_LARGE');
      }
      const snapshotArtifactDigest = sha256Bytes(artifactBytes);
      await database
        .insertInto('release_distribution.governance_release')
        .values({
          release_id: releaseId,
          governance_object_id: command.governanceObjectId,
          release_no: releaseNo,
          release_kind: command.releaseKind ?? 'NORMAL',
          business_valid_from: command.businessValidFrom,
          business_valid_to: command.businessValidTo,
          recorded_from: command.recordedFrom,
          submitted_by: command.submittedBy,
          approved_by: command.approvedBy,
          approved_at: command.approvedAt,
          change_reason: command.changeReason,
          content_hash: projectionPayloadDigest,
        })
        .execute();
      hitControlledPublicationFault('RELEASE_ENVELOPE_WRITTEN');
      const release = { release_id: releaseId };

      const snapshot = await database
        .insertInto('release_distribution.release_snapshot')
        .values({
          release_id: release.release_id,
          envelope_contract_version: 'phase-01.v1',
          projection_type: contract.projectionType,
          projection_schema_version: contract.schemaVersion,
          projection_schema_digest: contract.schemaDigest,
          serialization_profile_version: 'canonical-json.v1',
          artifact_media_type: 'application/vnd.hdi.canonical-snapshot+json',
          artifact_bytes: artifactBytes,
          projection_payload_digest: projectionPayloadDigest,
          snapshot_artifact_digest: snapshotArtifactDigest,
          item_count: command.projection.itemCount,
        })
        .returning('release_snapshot_id')
        .executeTakeFirstOrThrow();
      hitControlledPublicationFault('SNAPSHOT_ARTIFACT_WRITTEN');

      if (command.member.kind === 'CHARGE_ITEM') {
        await database
          .insertInto('release_distribution.release_member_charge_item')
          .values({
            release_id: release.release_id,
            charge_item_id: command.member.stableId,
            charge_item_version_id: command.member.versionId,
            snapshot_name: command.member.snapshotName,
            member_hash: command.member.memberHash,
          })
          .execute();
      } else {
        await database
          .insertInto('release_distribution.release_member_price_list')
          .values({
            release_id: release.release_id,
            price_list_id: command.member.stableId,
            price_list_release_id: command.member.versionId,
            snapshot_name: command.member.snapshotName,
            member_hash: command.member.memberHash,
          })
          .execute();
      }
      hitControlledPublicationFault('RELEASE_MEMBER_WRITTEN');

      const event = await database
        .insertInto('release_distribution.outbox_event')
        .values({
          aggregate_type: command.aggregateType,
          aggregate_id: command.governanceObjectId,
          aggregate_version: releaseNo,
          event_type: 'PUBLISHED',
          release_id: release.release_id,
          release_snapshot_id: snapshot.release_snapshot_id,
          projection_type: contract.projectionType,
          projection_schema_version: contract.schemaVersion,
          projection_schema_digest: contract.schemaDigest,
          projection_payload_digest: projectionPayloadDigest,
          snapshot_artifact_digest: snapshotArtifactDigest,
        })
        .returning('event_id')
        .executeTakeFirstOrThrow();
      hitControlledPublicationFault('OUTBOX_EVENT_WRITTEN');

      const activeSubscriptions = await sql<{
        subscription_id: string;
        subscription_version_id: string;
      }>`
        select
          subscription.consumer_subscription_id as subscription_id,
          version.consumer_subscription_version_id as subscription_version_id
        from release_distribution.consumer_subscription as subscription
        join lateral (
          select candidate.consumer_subscription_version_id, candidate.status
          from release_distribution.consumer_subscription_version as candidate
          where candidate.consumer_subscription_id = subscription.consumer_subscription_id
          order by candidate.version_no desc
          limit 1
        ) as version on true
        where subscription.governance_object_id = ${command.governanceObjectId}
          and version.status = 'ACTIVE'
        order by subscription.consumer_subscription_id
      `.execute(database);
      for (const subscription of activeSubscriptions.rows) {
        const support = await database
          .selectFrom('release_distribution.consumer_projection_support')
          .select('projection_schema_digest')
          .where(
            'consumer_subscription_version_id',
            '=',
            subscription.subscription_version_id,
          )
          .where('projection_type', '=', contract.projectionType)
          .where('projection_schema_version', '=', contract.schemaVersion)
          .executeTakeFirst();
        const compatibilityResult =
          support?.projection_schema_digest.equals(contract.schemaDigest) === true
            ? 'SUPPORTED'
            : 'UNSUPPORTED';
        const compatibility = await database
          .insertInto('release_distribution.release_consumer_compatibility')
          .values({
            release_id: release.release_id,
            event_id: event.event_id,
            consumer_subscription_id: subscription.subscription_id,
            consumer_subscription_version_id: subscription.subscription_version_id,
            result: compatibilityResult,
            result_sequence: '1',
            evidence_hash: canonicalSha256({
              eventId: event.event_id,
              projectionSchemaDigest: digestHex(contract.schemaDigest),
              projectionSchemaVersion: contract.schemaVersion,
              projectionType: contract.projectionType,
              result: compatibilityResult,
              subscriptionId: subscription.subscription_id,
              subscriptionVersionId: subscription.subscription_version_id,
            }),
          })
          .returning('release_consumer_compatibility_id')
          .executeTakeFirstOrThrow();
        hitControlledPublicationFault('COMPATIBILITY_PRECHECK_WRITTEN');
        const delivery = await database
          .insertInto('release_distribution.outbox_delivery')
          .values({
            event_id: event.event_id,
            consumer_subscription_id: subscription.subscription_id,
          })
          .returning('outbox_delivery_id')
          .executeTakeFirstOrThrow();
        await database
          .insertInto('release_distribution.outbox_delivery_state')
          .values({
            outbox_delivery_id: delivery.outbox_delivery_id,
            event_id: event.event_id,
            consumer_subscription_id: subscription.subscription_id,
            compatibility_id: compatibility.release_consumer_compatibility_id,
            state_sequence: '1',
            delivery_status:
              compatibilityResult === 'SUPPORTED' ? 'PENDING' : 'BLOCKED_INCOMPATIBLE',
          })
          .execute();
        hitControlledPublicationFault('DELIVERY_REGISTERED');
        if (compatibilityResult === 'UNSUPPORTED') {
          const issue = await database
            .insertInto('release_distribution.consumer_compatibility_issue')
            .values({
              issue_code: `COMPAT-${releaseNo}-${subscription.subscription_id}`,
              consumer_subscription_id: subscription.subscription_id,
              event_id: event.event_id,
              opened_compatibility_id: compatibility.release_consumer_compatibility_id,
            })
            .returning('consumer_compatibility_issue_id')
            .executeTakeFirstOrThrow();
          await database
            .insertInto('release_distribution.consumer_compatibility_issue_event')
            .values({
              consumer_compatibility_issue_id: issue.consumer_compatibility_issue_id,
              issue_sequence: '1',
              issue_status: 'OPEN',
              compatibility_id: compatibility.release_consumer_compatibility_id,
              evidence_hash: canonicalSha256({
                compatibilityId: compatibility.release_consumer_compatibility_id,
                eventId: event.event_id,
                issueStatus: 'OPEN',
                subscriptionId: subscription.subscription_id,
              }),
              occurred_at: context.occurredAt,
              correlation_id: context.correlationId,
            })
            .execute();
        }
      }

      return {
        releaseId: release.release_id,
        releaseNo,
        snapshotId: snapshot.release_snapshot_id,
        eventId: event.event_id,
        projectionSchemaDigest: contract.schemaDigest,
        projectionPayloadDigest,
        snapshotArtifactDigest,
        artifactByteLength: artifactBytes.byteLength,
      };
    },

    async createSubscription(command) {
      const contract = requireContract(
        contracts,
        command.projectionType,
        command.projectionSchemaVersion,
      );
      const inserted = await database
        .insertInto('release_distribution.consumer_subscription')
        .values({
          subscription_code: command.subscriptionCode,
          service_principal_id: command.servicePrincipalId,
          governance_object_id: command.governanceObjectId,
        })
        .returning('consumer_subscription_id')
        .executeTakeFirstOrThrow();
      const version = await database
        .insertInto('release_distribution.consumer_subscription_version')
        .values({
          consumer_subscription_id: inserted.consumer_subscription_id,
          version_no: '1',
          status: 'ACTIVE',
          recorded_sequence: '1',
        })
        .returning('consumer_subscription_version_id')
        .executeTakeFirstOrThrow();
      await database
        .insertInto('release_distribution.consumer_projection_support')
        .values({
          consumer_subscription_version_id: version.consumer_subscription_version_id,
          projection_type: contract.projectionType,
          projection_schema_version: contract.schemaVersion,
          projection_schema_digest: contract.schemaDigest,
        })
        .execute();
      return { subscriptionId: inserted.consumer_subscription_id };
    },

    async createSubscriptionVersion(command) {
      const contract = requireContract(
        contracts,
        command.projectionType,
        command.projectionSchemaVersion,
      );
      await sql`select pg_advisory_xact_lock(hashtextextended(${command.subscriptionId}, 47))`.execute(
        database,
      );
      const subscription = await database
        .selectFrom('release_distribution.consumer_subscription')
        .select('consumer_subscription_id')
        .where('consumer_subscription_id', '=', command.subscriptionId)
        .where('governance_object_id', '=', command.governanceObjectId)
        .executeTakeFirst();
      if (!subscription) throw new Error('CONSUMER_SUBSCRIPTION_NOT_FOUND');
      const latest = await database
        .selectFrom('release_distribution.consumer_subscription_version')
        .select((expression) => expression.fn.max('version_no').as('latest_version_no'))
        .where('consumer_subscription_id', '=', command.subscriptionId)
        .executeTakeFirstOrThrow();
      const versionNo = (BigInt(latest.latest_version_no ?? '0') + 1n).toString();
      const version = await database
        .insertInto('release_distribution.consumer_subscription_version')
        .values({
          consumer_subscription_id: command.subscriptionId,
          version_no: versionNo,
          status: 'ACTIVE',
          recorded_sequence: versionNo,
        })
        .returning('consumer_subscription_version_id')
        .executeTakeFirstOrThrow();
      await database
        .insertInto('release_distribution.consumer_projection_support')
        .values({
          consumer_subscription_version_id: version.consumer_subscription_version_id,
          projection_type: contract.projectionType,
          projection_schema_version: contract.schemaVersion,
          projection_schema_digest: contract.schemaDigest,
        })
        .execute();
      return {
        subscriptionId: command.subscriptionId,
        subscriptionVersionId: version.consumer_subscription_version_id,
        versionNo,
      };
    },

    async replayBlockedDelivery(command) {
      await sql`select pg_advisory_xact_lock(hashtextextended(${command.subscriptionId}, 59))`.execute(
        database,
      );
      const candidate = await sql<{
        compatibility_id: string;
        delivery_id: string;
        event_id: string;
        projection_schema_digest: Buffer;
        projection_schema_version: string;
        projection_type: string;
        release_id: string;
        state_sequence: string;
        subscription_version_id: string;
      }>`
        select
          compatibility.release_consumer_compatibility_id as compatibility_id,
          delivery.outbox_delivery_id as delivery_id,
          event.event_id,
          event.projection_schema_digest,
          event.projection_schema_version,
          event.projection_type,
          event.release_id,
          state.state_sequence,
          version.consumer_subscription_version_id as subscription_version_id
        from release_distribution.consumer_subscription as subscription
        join lateral (
          select candidate_version.consumer_subscription_version_id, candidate_version.status
          from release_distribution.consumer_subscription_version as candidate_version
          where candidate_version.consumer_subscription_id = subscription.consumer_subscription_id
          order by candidate_version.version_no desc
          limit 1
        ) as version on true
        join release_distribution.outbox_delivery as delivery
          on delivery.consumer_subscription_id = subscription.consumer_subscription_id
        join lateral (
          select candidate_state.outbox_delivery_state_id,
                 candidate_state.compatibility_id,
                 candidate_state.delivery_status,
                 candidate_state.state_sequence
          from release_distribution.outbox_delivery_state as candidate_state
          where candidate_state.outbox_delivery_id = delivery.outbox_delivery_id
          order by candidate_state.state_sequence desc
          limit 1
        ) as state on true
        join release_distribution.release_consumer_compatibility as compatibility
          on compatibility.release_consumer_compatibility_id = state.compatibility_id
        join release_distribution.outbox_event as event
          on event.event_id = delivery.event_id
        where subscription.consumer_subscription_id = ${command.subscriptionId}
          and subscription.governance_object_id = ${command.governanceObjectId}
          and event.event_id = ${command.eventId}
          and version.status = 'ACTIVE'
          and state.delivery_status = 'BLOCKED_INCOMPATIBLE'
      `.execute(database);
      const row = candidate.rows[0];
      if (!row) throw new Error('BLOCKED_DELIVERY_NOT_FOUND');
      const support = await database
        .selectFrom('release_distribution.consumer_projection_support')
        .select('projection_schema_digest')
        .where('consumer_subscription_version_id', '=', row.subscription_version_id)
        .where('projection_type', '=', row.projection_type)
        .where('projection_schema_version', '=', row.projection_schema_version)
        .executeTakeFirst();
      if (support?.projection_schema_digest.equals(row.projection_schema_digest) !== true) {
        throw new Error('CONSUMER_PROJECTION_STILL_UNSUPPORTED');
      }
      const lastCompatibility = await database
        .selectFrom('release_distribution.release_consumer_compatibility')
        .select((expression) => expression.fn.max('result_sequence').as('last_result_sequence'))
        .where('release_id', '=', row.release_id)
        .where('consumer_subscription_id', '=', command.subscriptionId)
        .executeTakeFirstOrThrow();
      const resultSequence = (
        BigInt(lastCompatibility.last_result_sequence ?? '0') + 1n
      ).toString();
      const compatibility = await database
        .insertInto('release_distribution.release_consumer_compatibility')
        .values({
          release_id: row.release_id,
          event_id: row.event_id,
          consumer_subscription_id: command.subscriptionId,
          consumer_subscription_version_id: row.subscription_version_id,
          result: 'SUPPORTED',
          result_sequence: resultSequence,
          evidence_hash: canonicalSha256({
            eventId: row.event_id,
            projectionSchemaDigest: digestHex(row.projection_schema_digest),
            projectionSchemaVersion: row.projection_schema_version,
            projectionType: row.projection_type,
            replay: true,
            result: 'SUPPORTED',
            subscriptionId: command.subscriptionId,
            subscriptionVersionId: row.subscription_version_id,
          }),
        })
        .returning('release_consumer_compatibility_id')
        .executeTakeFirstOrThrow();
      const stateSequence = (BigInt(row.state_sequence) + 1n).toString();
      const state = await database
        .insertInto('release_distribution.outbox_delivery_state')
        .values({
          outbox_delivery_id: row.delivery_id,
          event_id: row.event_id,
          consumer_subscription_id: command.subscriptionId,
          compatibility_id: compatibility.release_consumer_compatibility_id,
          state_sequence: stateSequence,
          delivery_status: 'PENDING',
        })
        .returning('outbox_delivery_state_id')
        .executeTakeFirstOrThrow();
      const issue = await database
        .selectFrom('release_distribution.consumer_compatibility_issue')
        .select('consumer_compatibility_issue_id')
        .where('consumer_subscription_id', '=', command.subscriptionId)
        .where('event_id', '=', row.event_id)
        .executeTakeFirstOrThrow();
      await database
        .insertInto('release_distribution.consumer_compatibility_issue_event')
        .values({
          consumer_compatibility_issue_id: issue.consumer_compatibility_issue_id,
          issue_sequence: '2',
          issue_status: 'RESOLVED',
          compatibility_id: compatibility.release_consumer_compatibility_id,
          evidence_hash: canonicalSha256({
            compatibilityId: compatibility.release_consumer_compatibility_id,
            eventId: row.event_id,
            issueStatus: 'RESOLVED',
            subscriptionId: command.subscriptionId,
          }),
          occurred_at: context.occurredAt,
          correlation_id: context.correlationId,
        })
        .execute();
      return {
        deliveryId: row.delivery_id,
        deliveryStateId: state.outbox_delivery_state_id,
        stateSequence,
      };
    },

    async listAvailableEvents(command) {
      await requireServiceSubscription(database, command.subscriptionId, command.servicePrincipalId);
      const selected = await sql<{
        aggregate_version: string;
        delivery_id: string;
        delivery_state_id: string;
        event_id: string;
        governance_object_id: string;
        projection_payload_digest: Buffer;
        projection_schema_digest: Buffer;
        projection_schema_version: string;
        projection_type: string;
        release_id: string;
        snapshot_artifact_digest: Buffer;
        snapshot_id: string;
      }>`
        select
          event.aggregate_version,
          delivery.outbox_delivery_id as delivery_id,
          state.outbox_delivery_state_id as delivery_state_id,
          event.event_id,
          event.aggregate_id as governance_object_id,
          event.projection_payload_digest,
          event.projection_schema_digest,
          event.projection_schema_version,
          event.projection_type,
          event.release_id,
          event.snapshot_artifact_digest,
          event.release_snapshot_id as snapshot_id
        from release_distribution.consumer_subscription as subscription
        join release_distribution.outbox_delivery as delivery
          on delivery.consumer_subscription_id = subscription.consumer_subscription_id
        join lateral (
          select candidate_state.outbox_delivery_state_id,
                 candidate_state.compatibility_id,
                 candidate_state.delivery_status
          from release_distribution.outbox_delivery_state as candidate_state
          where candidate_state.outbox_delivery_id = delivery.outbox_delivery_id
          order by candidate_state.state_sequence desc
          limit 1
        ) as state on true
        join release_distribution.release_consumer_compatibility as compatibility
          on compatibility.release_consumer_compatibility_id = state.compatibility_id
        join release_distribution.outbox_event as event
          on event.event_id = delivery.event_id
        where subscription.consumer_subscription_id = ${command.subscriptionId}
          and subscription.service_principal_id = ${command.servicePrincipalId}
          and compatibility.result = 'SUPPORTED'
          and state.delivery_status in ('PENDING', 'LEASED', 'NOTIFIED', 'DELIVERED')
          and event.aggregate_version > cast(${command.afterAggregateVersion} as bigint)
        order by event.aggregate_version asc
      `.execute(database);
      const events: AvailableEvent[] = [];
      for (const row of selected.rows) {
        await sql`select pg_advisory_xact_lock(hashtextextended(${row.delivery_id}, 53))`.execute(
          database,
        );
        const lastAttempt = await database
          .selectFrom('release_distribution.outbox_delivery_attempt')
          .select((expression) => expression.fn.max('attempt_no').as('last_attempt_no'))
          .where('outbox_delivery_id', '=', row.delivery_id)
          .executeTakeFirstOrThrow();
        await database
          .insertInto('release_distribution.outbox_delivery_attempt')
          .values({
            outbox_delivery_id: row.delivery_id,
            outbox_delivery_state_id: row.delivery_state_id,
            attempt_no: (BigInt(lastAttempt.last_attempt_no ?? '0') + 1n).toString(),
            result: 'OFFERED_BY_PULL',
            occurred_at: context.occurredAt,
            correlation_id: context.correlationId,
          })
          .execute();
        events.push({
          aggregateVersion: row.aggregate_version,
          eventId: row.event_id,
          governanceObjectId: row.governance_object_id,
          projectionPayloadDigest: row.projection_payload_digest,
          projectionSchemaDigest: row.projection_schema_digest,
          projectionSchemaVersion: row.projection_schema_version,
          projectionType: row.projection_type,
          releaseId: row.release_id,
          snapshotArtifactDigest: row.snapshot_artifact_digest,
          snapshotId: row.snapshot_id,
        });
      }
      return events;
    },

    async getSnapshot(snapshotId) {
      const snapshot = await database
        .selectFrom('release_distribution.release_snapshot')
        .select([
          'release_snapshot_id',
          'release_id',
          'artifact_media_type',
          'artifact_bytes',
          'artifact_byte_length',
          'snapshot_artifact_digest',
        ])
        .where('release_snapshot_id', '=', snapshotId)
        .executeTakeFirst();
      if (!snapshot) throw new Error('SNAPSHOT_NOT_FOUND');
      return {
        snapshotId: snapshot.release_snapshot_id,
        releaseId: snapshot.release_id,
        mediaType: snapshot.artifact_media_type,
        bytes: snapshot.artifact_bytes,
        byteLength: snapshot.artifact_byte_length ?? snapshot.artifact_bytes.byteLength.toString(),
        digest: snapshot.snapshot_artifact_digest,
      };
    },

    async getSnapshotForSubscription(command) {
      await requireServiceSubscription(database, command.subscriptionId, command.servicePrincipalId);
      const allowed = await sql<{ release_snapshot_id: string }>`
        select event.release_snapshot_id
        from release_distribution.consumer_subscription as subscription
        join release_distribution.outbox_delivery as delivery
          on delivery.consumer_subscription_id = subscription.consumer_subscription_id
        join lateral (
          select candidate_state.compatibility_id, candidate_state.delivery_status
          from release_distribution.outbox_delivery_state as candidate_state
          where candidate_state.outbox_delivery_id = delivery.outbox_delivery_id
          order by candidate_state.state_sequence desc
          limit 1
        ) as state on true
        join release_distribution.release_consumer_compatibility as compatibility
          on compatibility.release_consumer_compatibility_id = state.compatibility_id
        join release_distribution.outbox_event as event
          on event.event_id = delivery.event_id
        where subscription.consumer_subscription_id = ${command.subscriptionId}
          and subscription.service_principal_id = ${command.servicePrincipalId}
          and compatibility.result = 'SUPPORTED'
          and state.delivery_status in ('PENDING', 'LEASED', 'NOTIFIED', 'DELIVERED')
          and event.release_snapshot_id = ${command.snapshotId}
      `.execute(database);
      if (!allowed.rows[0]) throw new Error('SNAPSHOT_NOT_AVAILABLE_TO_SUBSCRIPTION');
      return this.getSnapshot(command.snapshotId);
    },

    async recordReceipt(command) {
      await requireServiceSubscription(database, command.subscriptionId, command.servicePrincipalId);
      const selected = await sql<{
        aggregate_id: string;
        aggregate_version: string;
        compatibility_id: string;
        delivery_id: string;
        snapshot_artifact_digest: Buffer;
        state_sequence: string;
      }>`
        select
          event.aggregate_id,
          event.aggregate_version,
          state.compatibility_id,
          delivery.outbox_delivery_id as delivery_id,
          event.snapshot_artifact_digest,
          state.state_sequence
        from release_distribution.consumer_subscription as subscription
        join release_distribution.outbox_delivery as delivery
          on delivery.consumer_subscription_id = subscription.consumer_subscription_id
        join lateral (
          select candidate_state.compatibility_id,
                 candidate_state.delivery_status,
                 candidate_state.state_sequence
          from release_distribution.outbox_delivery_state as candidate_state
          where candidate_state.outbox_delivery_id = delivery.outbox_delivery_id
          order by candidate_state.state_sequence desc
          limit 1
        ) as state on true
        join release_distribution.release_consumer_compatibility as compatibility
          on compatibility.release_consumer_compatibility_id = state.compatibility_id
        join release_distribution.outbox_event as event
          on event.event_id = delivery.event_id
        where event.event_id = ${command.eventId}
          and subscription.consumer_subscription_id = ${command.subscriptionId}
          and subscription.service_principal_id = ${command.servicePrincipalId}
          and compatibility.result = 'SUPPORTED'
          and state.delivery_status in ('PENDING', 'LEASED', 'NOTIFIED', 'DELIVERED')
      `.execute(database);
      const event = selected.rows[0];
      if (!event) throw new Error('CONSUMER_EVENT_NOT_AVAILABLE');
      if (
        command.applyResult === 'APPLIED' &&
        (command.receiveResult !== 'ACCEPTED' || command.validationResult !== 'VALID')
      ) {
        throw new Error('CONSUMER_RECEIPT_RESULT_INCOHERENT');
      }
      if (
        command.validationResult === 'VALID' &&
        !command.processingDigest.equals(event.snapshot_artifact_digest)
      ) {
        throw new Error('CONSUMER_PROCESSING_DIGEST_MISMATCH');
      }

      await sql`select pg_advisory_xact_lock(hashtextextended(${command.subscriptionId}, 43))`.execute(
        database,
      );
      const lastReceipt = await database
        .selectFrom('release_distribution.consumer_receipt')
        .select((expression) => expression.fn.max('receipt_sequence').as('last_receipt_sequence'))
        .where('consumer_subscription_id', '=', command.subscriptionId)
        .where('event_id', '=', command.eventId)
        .executeTakeFirstOrThrow();
      const receiptSequence = (BigInt(lastReceipt.last_receipt_sequence ?? '0') + 1n).toString();

      if (command.applyResult === 'APPLIED') {
        const checkpoint = await database
          .selectFrom('release_distribution.consumer_checkpoint')
          .select('applied_aggregate_version')
          .where('consumer_subscription_id', '=', command.subscriptionId)
          .where('governance_object_id', '=', event.aggregate_id)
          .executeTakeFirst();
        const currentVersion = BigInt(checkpoint?.applied_aggregate_version ?? '0');
        const eventVersion = BigInt(event.aggregate_version);
        if (checkpoint && eventVersion > currentVersion + 1n) {
          throw new Error('CONSUMER_CHECKPOINT_GAP');
        }
        if (!checkpoint || eventVersion === currentVersion + 1n) {
          await database
            .insertInto('release_distribution.consumer_checkpoint')
            .values({
              consumer_subscription_id: command.subscriptionId,
              governance_object_id: event.aggregate_id,
              applied_aggregate_version: event.aggregate_version,
            })
            .onConflict((conflict) =>
              conflict.columns(['consumer_subscription_id', 'governance_object_id']).doUpdateSet({
                applied_aggregate_version: event.aggregate_version,
                updated_at: command.processedAt,
              }),
            )
            .execute();
        }
      }

      const receipt = await database
        .insertInto('release_distribution.consumer_receipt')
        .values({
          consumer_subscription_id: command.subscriptionId,
          event_id: command.eventId,
          receipt_sequence: receiptSequence,
          receive_result: command.receiveResult,
          validation_result: command.validationResult,
          apply_result: command.applyResult,
          processing_digest: command.processingDigest,
          processed_at: command.processedAt,
        })
        .returning('consumer_receipt_id')
        .executeTakeFirstOrThrow();
      await database
        .insertInto('release_distribution.outbox_delivery_state')
        .values({
          outbox_delivery_id: event.delivery_id,
          event_id: command.eventId,
          consumer_subscription_id: command.subscriptionId,
          compatibility_id: event.compatibility_id,
          state_sequence: (BigInt(event.state_sequence) + 1n).toString(),
          delivery_status:
            command.receiveResult === 'ACCEPTED' &&
            command.validationResult === 'VALID' &&
            command.applyResult === 'APPLIED'
              ? 'DELIVERED'
              : 'ATTENTION_REQUIRED',
        })
        .execute();
      return { receiptId: receipt.consumer_receipt_id, receiptSequence };
    },
  };
}

function contractKey(type: string, version: string): string {
  return `${type}@${version}`;
}

function requireContract(
  contracts: ReadonlyMap<string, RegisteredContract>,
  type: string,
  version: string,
): RegisteredContract {
  const contract = contracts.get(contractKey(type, version));
  if (!contract) throw new Error('PROJECTION_CONTRACT_UNKNOWN');
  return contract;
}

async function nextUuid(database: Kysely<DB>): Promise<string> {
  const result = await database
    .selectNoFrom((expression) => expression.fn<string>('uuidv7', []).as('id'))
    .executeTakeFirstOrThrow();
  return result.id;
}

async function requireServiceSubscription(
  database: Kysely<DB>,
  subscriptionId: string,
  servicePrincipalId: string,
): Promise<void> {
  const subscription = await database
    .selectFrom('release_distribution.consumer_subscription')
    .select('service_principal_id')
    .where('consumer_subscription_id', '=', subscriptionId)
    .executeTakeFirst();
  if (!subscription) throw new Error('CONSUMER_SUBSCRIPTION_NOT_FOUND');
  if (subscription.service_principal_id !== servicePrincipalId) {
    throw new Error('CONSUMER_SUBSCRIPTION_FORBIDDEN');
  }
}

export const EMPTY_DIGEST = ZERO_DIGEST;
