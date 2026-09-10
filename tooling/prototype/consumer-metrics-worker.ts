import { createHash } from 'node:crypto';
import { collectConsumerMetrics } from '../../apps/governance-api/src/composition/create-consumer-metrics.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';

// Separate process proves counters are restored from committed facts, not memory.
const connectionString = process.env['DATABASE_URL'];
if (!connectionString || process.env['NODE_ENV'] === 'production') throw new Error('SYNTHETIC_CONFIGURATION_REQUIRED');
const handle = createDatabase({ connectionString, max: 1, application_name: 'hdi-consumer-metrics-restart' });
try {
  const text = await collectConsumerMetrics(handle.database, PROTOTYPE_FIXTURE.actorPrincipalId);
  process.stdout.write(createHash('sha256').update(text).digest('hex'));
} catch { process.stderr.write('METRICS_RESTART_FAILED'); process.exitCode = 1; }
finally { await handle.close(); }
