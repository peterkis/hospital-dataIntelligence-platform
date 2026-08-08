import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

interface ReleaseNotificationTrigger {
  readonly eventId: string;
  readonly subscriptionId: string;
}

export async function startNotificationServer(options: {
  readonly host: string;
  readonly port: number;
  readonly expectedAuthorization: string;
  readonly expectedSubscriptionId?: string;
  process(subscriptionId: string): Promise<unknown>;
}): Promise<void> {
  let processing = Promise.resolve();
  const server = createServer((request, response) => {
    const task = async () => {
      try {
        if (request.method !== 'POST' || request.url !== '/v1/release-notifications') {
          sendJson(response, 404, { code: 'NOT_FOUND' });
          return;
        }
        if (request.headers.authorization !== options.expectedAuthorization) {
          sendJson(response, 401, { code: 'NOTIFICATION_UNAUTHENTICATED' });
          return;
        }
        const notification = parseNotification(await readBody(request));
        if (
          options.expectedSubscriptionId !== undefined &&
          notification.subscriptionId !== options.expectedSubscriptionId
        ) {
          sendJson(response, 409, { code: 'NOTIFICATION_SUBSCRIPTION_MISMATCH' });
          return;
        }
        processing = processing.then(async () => {
          await options.process(notification.subscriptionId);
        });
        await processing;
        sendJson(response, 202, { accepted: true, eventId: notification.eventId });
      } catch (error) {
        processing = Promise.resolve();
        sendJson(response, 503, {
          code: error instanceof Error ? error.message : 'NOTIFICATION_PROCESSING_FAILED',
        });
      }
    };
    void task();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await processing;
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > 64 * 1024) throw new Error('NOTIFICATION_BODY_TOO_LARGE');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function parseNotification(bytes: Buffer): ReleaseNotificationTrigger {
  const candidate = JSON.parse(bytes.toString('utf8')) as unknown;
  if (
    !isRecord(candidate) ||
    typeof candidate['eventId'] !== 'string' ||
    typeof candidate['subscriptionId'] !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      candidate['subscriptionId'],
    )
  ) {
    throw new Error('NOTIFICATION_SCHEMA_INVALID');
  }
  return {
    eventId: candidate['eventId'],
    subscriptionId: candidate['subscriptionId'],
  };
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': bytes.byteLength,
  });
  response.end(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
