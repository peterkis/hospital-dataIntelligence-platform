import { runDepartmentConsumerFlow } from './run-department-consumer-flow.js';

try {
  process.stdout.write(`${JSON.stringify(await runDepartmentConsumerFlow({ verifyLifecycle: process.argv.includes('--lifecycle') }))}\n`);
} catch (error) {
  // Assertions and drivers can carry SQL, request headers or connection values.
  // Only stable error identifiers leave this synthetic verifier.
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
    ? error.message : 'DEPARTMENT_CONSUMER_VALIDATION_FAILED';
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorCode: code })}\n`);
  process.exitCode = 1;
}
