import assert from 'node:assert/strict';
import { test } from 'node:test';
import { labelCorrectionCommand } from './person-assignment-transfer-definition-repair-guard.js';

test('R1 copies only the historical label and preserves the verified current business period', () => {
  const source = { governance_object_id: '76000000-0000-7000-8000-000000000001', term_id: 'stable-term',
    term_version_id: 'source-version', version_no: '13', dimension: 'PURPOSE', code: 'ORGANIZATIONAL_AFFILIATION',
    label: 'SYNTHETIC ORGANIZATIONAL_AFFILIATION', definition_state: 'ENABLED',
    business_valid_from: '2026-01-01T00:00:00', business_valid_to: null };
  const current = { ...source, term_version_id: 'expected-version', version_no: '27',
    label: 'SYNTHETIC C0302 DEFINITION RACE', business_valid_from: '2026-02-01T00:00:00' };
  const command = labelCorrectionCommand(source, current, current);
  assert.deepEqual(command, { governanceObjectId: current.governance_object_id, termId: current.term_id,
    expectedCurrentVersionId: current.term_version_id, label: 'SYNTHETIC ORGANIZATIONAL_AFFILIATION',
    definitionState: 'ENABLED', businessValidFrom: '2026-02-01T00:00:00', businessValidTo: null, reasonCode: 'LABEL_CORRECTION' });
  assert.throws(() => labelCorrectionCommand(source, { ...current, term_version_id: 'drift' }, current));
  assert.throws(() => labelCorrectionCommand({ ...source, term_id: 'other-scope' }, current, current));
  assert.throws(() => labelCorrectionCommand(source, { ...current, definition_state: 'RETIRED' }, current));
  assert.throws(() => labelCorrectionCommand(source, { ...current, business_valid_to: '2027-01-01T00:00:00' }, current));
});
