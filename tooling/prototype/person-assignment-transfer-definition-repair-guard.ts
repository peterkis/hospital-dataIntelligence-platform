import assert from 'node:assert/strict';
import type { AppendAssignmentSemanticTermVersion } from '../../apps/governance-api/src/modules/person-master/assignment-semantics-contracts.js';

export interface RepairTermRow {
  governance_object_id: string; term_id: string; term_version_id: string; version_no: string;
  dimension: string; code: string; label: string; definition_state: string;
  business_valid_from: string; business_valid_to: string | null;
}

// Dedicated R1 boundary. The caller supplies rows read under the stable-term lock
// and the exact head from the preserved inspection receipt, never a moving head.
export function labelCorrectionCommand(source: RepairTermRow, current: RepairTermRow,
  expected: RepairTermRow): AppendAssignmentSemanticTermVersion {
  assert.equal(source.version_no, '13');
  assert.equal(source.label, 'SYNTHETIC ORGANIZATIONAL_AFFILIATION');
  assert.equal(current.version_no, '27');
  assert.equal(current.label, 'SYNTHETIC C0302 DEFINITION RACE');
  assert.equal(current.definition_state, 'ENABLED');
  assert.equal(current.business_valid_to, null);
  for (const key of ['term_id', 'governance_object_id', 'dimension', 'code'] as const)
    assert.equal(source[key], current[key], 'R1_STABLE_IDENTITY_MISMATCH');
  assert.equal(current.dimension, 'PURPOSE');
  assert.equal(current.code, 'ORGANIZATIONAL_AFFILIATION');
  assert.deepEqual(current, expected, 'R1_EXPECTED_HEAD_CHANGED');
  return { governanceObjectId: current.governance_object_id, termId: current.term_id,
    expectedCurrentVersionId: current.term_version_id, label: source.label, definitionState: 'ENABLED',
    businessValidFrom: current.business_valid_from, businessValidTo: current.business_valid_to, reasonCode: 'LABEL_CORRECTION' };
}
