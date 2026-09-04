import { replayFailure, runConsumerReplay } from './consumer-replay-command.js';

// One process, one release, no retries or daemon. An interrupted operation keeps
// durable pending state; uncertainty must never become a success response.
const timeout = setTimeout(() => {
  process.stdout.write('{"status":"FAILED","eligible":false,"errorCode":"REPLAY_TIMEOUT"}\n');
  process.exit(1);
}, 30_000).unref();
try {
  process.stdout.write(`${JSON.stringify(await runConsumerReplay(process.argv.slice(2)))}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify(replayFailure(error))}\n`);
  process.exitCode = 1;
} finally { clearTimeout(timeout); }
