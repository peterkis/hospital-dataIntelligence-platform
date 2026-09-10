import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createAssignmentTransferApplication } from '../../apps/governance-api/src/composition/create-assignment-transfer-application.js';
import type { TransferAssignment, AssignmentVersion } from '../../apps/governance-api/src/modules/person-master/index.js';
import { createAssignmentClosureFixture } from './person-assignment-closure-fixture.js';
import { departmentScope, Aug } from './person-assignment-fixture.js';

export type TransferCheck = (ids: string[], name: string, work: () => Promise<unknown>, status?: 'SKIPPED_BY_SCOPE') => Promise<void>;
export type TransferFixture = Awaited<ReturnType<typeof createAssignmentTransferFixture>>;
export async function createAssignmentTransferFixture(database: Kysely<DB>, runId: string) {
  const base = await createAssignmentClosureFixture(database, runId);
  await base.grant(base.actor, ['PERSON_MASTER_ASSIGNMENT_TRANSFER']);
  const target = await base.createDepartment('C0302-TARGET');
  const transferCommand = (source: AssignmentVersion, changes: Partial<TransferAssignment> = {}): TransferAssignment => ({
    ...base.scope, sourceAssignmentId: source.assignmentId, expectedSourceVersionId: source.assignmentVersionId,
    effectiveAt: Aug, reasonCode: 'ORGANIZATIONAL_TRANSFER', targetPlacement: {
      scope: 'DEPARTMENT', departmentGovernanceObjectId: departmentScope.governanceObjectId, departmentId: target.departmentId,
    }, ...changes,
  });
  return { ...base, target, transferCommand,
    transfer: (requestId: string = randomUUID(), actor = base.actor) => createAssignmentTransferApplication(database, base.context(actor, requestId)),
  };
}
