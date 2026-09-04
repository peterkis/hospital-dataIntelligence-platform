import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../platform/database/database-types.generated.js';
import { renderConsumerMetrics } from '../platform/observability/consumer-metrics.js';
import { createScopedModules, PHASE_01_PROJECTION_CONTRACTS } from './create-scoped-modules.js';

// No worker, cache, counter mutation or external observability service.
export function collectConsumerMetrics(database: Kysely<DB>, actorPrincipalId: string): Promise<string> {
  return database.transaction().setIsolationLevel('repeatable read').execute(async tx => {
    await sql`set transaction read only`.execute(tx);
    await sql`set local statement_timeout = '5s'`.execute(tx);
    const clock = await tx.selectNoFrom(sql<string>`platform.local_now()`.as('now')).executeTakeFirstOrThrow();
    const requestId = randomUUID();
    const modules = createScopedModules(tx, { actorPrincipalId, requestId, correlationId: requestId, occurredAt: clock.now });
    return renderConsumerMetrics([
      ...await modules.releaseDistribution.readConsumerMetricFacts(), ...await modules.audit.readConsumerMetricFacts(),
    ], PHASE_01_PROJECTION_CONTRACTS);
  });
}
