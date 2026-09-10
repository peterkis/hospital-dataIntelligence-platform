import { readFileSync } from 'node:fs';
import { runSimulatedConsumerOnce, type SimulatedConsumerOptions } from '../../apps/sim-consumer/src/consumer.js';

// Verification-only child process. Credentials arrive via stdin, never argv or
// output. Abrupt receipt exits leave the owning HTTP server in the parent alive.
const input = JSON.parse(readFileSync(0, 'utf8')) as Omit<SimulatedConsumerOptions, 'now' | 'fetch'> & {
  readonly receiptInterruption?: 'BEFORE_SEND' | 'AFTER_RESPONSE';
};
try {
  const result = await runSimulatedConsumerOnce({ ...input, now: () => '2026-09-04T12:00:00',
    async fetch(request, init) {
      const url = request instanceof Request ? request.url : String(request);
      if (url.endsWith('/receipts') && input.receiptInterruption === 'BEFORE_SEND') process.exit(86);
      const response = await fetch(request, init);
      if (url.endsWith('/receipts') && input.receiptInterruption === 'AFTER_RESPONSE') {
        if (!response.ok) throw new Error('SDK_WORKER_RECEIPT_FAILED');
        process.exit(86);
      }
      return response;
    },
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  // BEFORE_APPLY occurs only after SDK verification; the process ends with no
  // local mutation. AFTER_APPLY preserves the atomically committed marker.
  process.stdout.write('{"status":"INTERRUPTED"}\n');
  process.exitCode = 86;
}
