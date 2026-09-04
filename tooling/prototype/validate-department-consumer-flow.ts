import { runDepartmentConsumerFlow } from './run-department-consumer-flow.js';

try {
  const metrics = process.argv.includes('--metrics');
  process.stdout.write(`${JSON.stringify(await runDepartmentConsumerFlow({ verifyLifecycle: process.argv.includes('--lifecycle'), verifySla: process.argv.includes('--sla'), verifySdk: process.argv.includes('--sdk') || metrics, verifyReplay: process.argv.includes('--replay') || process.argv.includes('--audit') || metrics, verifyAudit: process.argv.includes('--audit') || metrics, verifyMetrics: metrics }))}\n`);
} catch (error) {
  // Assertions and drivers can carry SQL, request headers or connection values.
  // Only stable error identifiers leave this synthetic verifier.
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
    ? error.message : 'DEPARTMENT_CONSUMER_VALIDATION_FAILED';
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorCode: code })}\n`);
  process.exitCode = 1;
}
