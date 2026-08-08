import { createHash } from 'node:crypto';
import { canonicalJson } from '../../platform/hashing/canonical-hash.js';
import {
  ReleaseNotificationError,
  type ReleaseNotification,
  type ReleaseNotificationTransport,
} from './outbox-dispatcher.js';

export function createHttpReleaseNotificationTransport(
  targets: readonly {
    readonly servicePrincipalId: string;
    readonly url: string;
    readonly authorizationHeader: string;
  }[],
): ReleaseNotificationTransport {
  const targetByPrincipal = new Map(targets.map((target) => [target.servicePrincipalId, target]));
  if (targetByPrincipal.size !== targets.length) {
    throw new Error('NOTIFICATION_TARGET_DUPLICATE');
  }
  for (const target of targets) {
    const parsed = new URL(target.url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('NOTIFICATION_TARGET_URL_INVALID');
    }
    if (target.authorizationHeader.length === 0) {
      throw new Error('NOTIFICATION_TARGET_AUTHORIZATION_REQUIRED');
    }
  }

  return {
    async deliver(notification) {
      const target = targetByPrincipal.get(notification.servicePrincipalId);
      if (!target) {
        throw new ReleaseNotificationError('NOTIFICATION_TARGET_NOT_CONFIGURED', false);
      }
      const body = Buffer.from(
        canonicalJson({
          aggregateVersion: notification.aggregateVersion,
          digestAlgorithm: 'SHA-256',
          eventId: notification.eventId,
          eventType: notification.eventType,
          governanceObjectId: notification.governanceObjectId,
          projectionPayloadDigest: notification.projectionPayloadDigest.toString('hex'),
          projectionSchemaDigest: notification.projectionSchemaDigest.toString('hex'),
          projectionSchemaVersion: notification.projectionSchemaVersion,
          projectionType: notification.projectionType,
          releaseId: notification.releaseId,
          snapshotArtifactDigest: notification.snapshotArtifactDigest.toString('hex'),
          snapshotId: notification.snapshotId,
          subscriptionId: notification.subscriptionId,
        }),
        'utf8',
      );
      let response: Response;
      try {
        response = await fetch(target.url, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: target.authorizationHeader,
            'content-type': 'application/json',
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new ReleaseNotificationError('NOTIFICATION_NETWORK_ERROR', true);
      }
      const responseBytes = Buffer.from(await response.arrayBuffer());
      const responseDigest = createHash('sha256').update(responseBytes).digest();
      if (response.ok) return { responseDigest };
      throw new ReleaseNotificationError(
        `NOTIFICATION_HTTP_${response.status}`,
        response.status === 408 || response.status === 429 || response.status >= 500,
        responseDigest,
      );
    },
  };
}
