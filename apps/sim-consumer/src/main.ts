import { runSimulatedConsumerOnce } from './consumer.js';
import { startNotificationServer } from './notification-server.js';
import { obtainClientCredentialsAccessToken } from './service-access-token.js';
import { join } from 'node:path';

process.env['TZ'] = 'Asia/Shanghai';

const baseUrl = requireEnvironment('GOVERNANCE_API_BASE_URL');
const tokenEndpoint = requireEnvironment('KEYCLOAK_TOKEN_ENDPOINT');
const clientId = requireEnvironment('KEYCLOAK_CLIENT_ID');
const clientSecret = requireEnvironment('KEYCLOAK_CLIENT_SECRET');

async function processAvailableEvents(subscriptionId: string, statePath: string) {
  const accessToken = await obtainClientCredentialsAccessToken({
    tokenEndpoint,
    clientId,
    clientSecret,
  });
  return runSimulatedConsumerOnce({
    baseUrl,
    accessToken,
    subscriptionId,
    statePath,
    now: nowInAsiaShanghai,
  });
}

if ((process.env['SIM_CONSUMER_MODE'] ?? 'once') === 'server') {
  const fixedSubscriptionId = process.env['SIM_CONSUMER_SUBSCRIPTION_ID'];
  const fixedStatePath = process.env['SIM_CONSUMER_STATE_PATH'];
  const stateDirectory = process.env['SIM_CONSUMER_STATE_DIRECTORY'];
  if (stateDirectory === undefined && (!fixedSubscriptionId || !fixedStatePath)) {
    throw new Error('SIM_CONSUMER_SERVER_STATE_CONFIGURATION_REQUIRED');
  }
  await startNotificationServer({
    host: process.env['HOST'] ?? '127.0.0.1',
    port: parsePort(process.env['PORT'] ?? '4000'),
    expectedAuthorization: requireEnvironment('SIM_CONSUMER_NOTIFICATION_AUTHORIZATION'),
    ...(stateDirectory === undefined && fixedSubscriptionId
      ? { expectedSubscriptionId: fixedSubscriptionId }
      : {}),
    process(subscriptionId) {
      const statePath = stateDirectory
        ? join(stateDirectory, `${subscriptionId}.json`)
        : requireEnvironment('SIM_CONSUMER_STATE_PATH');
      return processAvailableEvents(subscriptionId, statePath);
    },
  });
} else {
  const outcome = await processAvailableEvents(
    requireEnvironment('SIM_CONSUMER_SUBSCRIPTION_ID'),
    requireEnvironment('SIM_CONSUMER_STATE_PATH'),
  );
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('PORT_INVALID');
  return port;
}

function nowInAsiaShanghai(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}
