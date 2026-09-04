import type { operations } from './schema.generated.js';

type Input = operations['createPhase01ConsumerSubscriptionVersion']['requestBody']['content']['application/json'];
const valid: Input = { governanceObjectId: 'object', projectionType: 'hdi.department-master', projectionSchemaVersion: '1',
  sla: { criticality: 'CRITICAL', expectedApplyWithinSeconds: 5, retryWindowSeconds: 10 } };
const omitted: Input = { governanceObjectId: 'object', projectionType: 'hdi.department-hierarchy', projectionSchemaVersion: '1' };
// @ts-expect-error criticality is a closed enum
const invalid: Input['sla'] = { criticality: 'URGENT' };
// @ts-expect-error clients cannot submit operational success time
const forged: Input['sla'] = { lastSuccessAt: '2026-09-04T12:00:00' };
// @ts-expect-error owner identity is a reference, never a second free-text identity
const owner: Input['sla'] = { ownerEmail: 'test' };
type View = operations['getPhase01ConsumerOperationalStatus']['responses'][200]['content']['application/json'];
const status: View['status'] = 'NOT_CONFIGURED';
// @ts-expect-error derived status does not accept arbitrary values
const unknownStatus: View['status'] = 'OK';
void [valid, omitted, invalid, forged, owner, status, unknownStatus];
