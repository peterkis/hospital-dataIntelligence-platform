import {test, expect} from 'vitest';
import {UnitListSchema, unitCheck, type UnitHistory, type UnitVersion} from '../../apps/governance-api/src/modules/care-organization/contracts.js';
import {selectUnitPage, unitDisplayAt, unitReadState} from '../../apps/governance-api/src/modules/care-organization/unit-read-view.js';

const uuid = (value: number) => '00000000-0000-7000-8000-' + value.toString(16).padStart(12, '0');
const at = '2026-10-11T12:00:00.000000';
const from = '2026-01-01T00:00:00.000000';
function history(index: number): UnitHistory {
  const id = uuid(index), departmentId = uuid(1001), campusId = uuid(1002), subjectId = uuid(1003);
  const version: UnitVersion = {
    id: uuid(index + 2000), number: '1', action: 'CREATE', validFrom: from, validTo: null,
    recordedAt: from, reason: 'TEST POLICY ONLY', changeId: uuid(index + 3000),
    facts: {unitCode: String(index).padStart(5, '0'), unitName: 'TEST 业务单元 ' + index, unitType: 'OPD',
      publicPhone: null, serviceDescription: 'SYNTHETIC', receivingRuleReference: null, responsibilityStatus: 'PENDING',
      source: {sourceAlias: 'TEST_' + index, sourceVersion: '1', sourceSystemId: uuid(1004),
        sourceRecordedAt: from, recordLocatorEvidence: {inputId: uuid(1005), row: index}, recordStatus: 'ACTIVE', approvalReference: 'TEST ONLY'},
      contractVersionId: uuid(1006), receivingBasis: null},
  };
  return {id, departmentId, versions: [version], codes: [version.facts.unitCode], bindings: [{
    id: uuid(index + 4000), campusId, subjectId, scope: 'NORTH', versions: [{
      id: uuid(index + 5000), number: '1', validFrom: from, validTo: null, recordedAt: from, changeId: uuid(index + 3000), dependencies: {},
      binding: {department: {owner: 'department-master', id: departmentId}, campus: {owner: 'organization-master/campus', id: campusId},
        subject: {owner: 'organization-master', id: subjectId}, services: ['TEST_SERVICE'],
        relation: {owner: 'department-master/campus-relation', id: uuid(1007), version: '1', versionId: uuid(1008)}},
    }],
  }]};
}
const histories = Array.from({length: 65}, (_, index) => history(index + 1));

test('name search finds an authorized record beyond the first 50 before pagination', () => {
  const result = selectUnitPage(histories, {campus: 'NORTH', q: '业务单元 65', limit: 20}, at);
  expect(result.page.map(row => row.id)).toEqual([uuid(65)]);
  expect(result.nextAfterId).toBeNull();
});
test('code search preserves leading zeroes and does not interpret regex or SQL wildcards', () => {
  expect(selectUnitPage(histories, {campus: 'NORTH', q: '00065'}, at).page.map(row => row.id)).toEqual([uuid(65)]);
  for (const q of ['%', '.*', "' OR 1=1 --"]) expect(selectUnitPage(histories, {campus: 'NORTH', q}, at).page).toEqual([]);
});
test('cursor advances only over matching rows in stable ID order', () => {
  const input = {campus: 'NORTH' as const, q: 'TEST', limit: 20};
  const first = selectUnitPage([...histories].reverse(), input, at);
  const second = selectUnitPage(histories, {...input, after: first.nextAfterId!}, at);
  expect(first.page.map(row => row.id)).toEqual(histories.slice(0, 20).map(row => row.id));
  expect(second.page.map(row => row.id)).toEqual(histories.slice(20, 40).map(row => row.id));
  expect(selectUnitPage(histories, {...input, after: uuid(65)}, at)).toEqual({page: [], nextAfterId: null});
});
test('department, campus and state intersect with the authorized input set', () => {
  const value = history(1);
  expect(selectUnitPage([value], {campus: 'NORTH', departmentId: uuid(9999)}, at).page).toEqual([]);
  expect(selectUnitPage([value], {campus: 'NORTH', campusId: uuid(9999)}, at).page).toEqual([]);
  value.versions.push({...value.versions[0]!, id: uuid(9991), number: '2', action: 'SUSPEND', validFrom: '2026-10-01T00:00:00.000000'});
  expect(unitReadState(value, at)).toBe('SUSPENDED');
  expect(selectUnitPage([value], {campus: 'NORTH', state: 'ACTIVE'}, at).page).toEqual([]);
  expect(selectUnitPage([value], {campus: 'NORTH', state: 'SUSPENDED'}, at).page).toHaveLength(1);
  expect(unitDisplayAt(value, at)?.mode).toBe('REGISTERED');
});
test('future revision does not replace the effective name used for search and display', () => {
  const value = history(1), original = value.versions[0]!;
  value.versions.push({...original, id: uuid(9992), number: '2', action: 'REVISE',
    validFrom: '2027-01-01T00:00:00.000000', recordedAt: '2026-10-10T00:00:00.000000',
    facts: {...original.facts, unitName: 'TEST 未来名称'}});
  expect(unitDisplayAt(value, at)).toMatchObject({name: original.facts.unitName, mode: 'CURRENT', version: '1'});
  expect(selectUnitPage([value], {campus: 'NORTH', q: '未来名称'}, at).page).toEqual([]);
  expect(selectUnitPage([value], {campus: 'NORTH', q: '未来名称'}, '2027-01-02T00:00:00.000000').page).toHaveLength(1);
});
test('record-time filter is applied before selecting even a registration label', () => {
  const value = history(1);
  value.versions[0]!.recordedAt = '2026-11-01T00:00:00.000000';
  expect(selectUnitPage([value], {campus: 'NORTH', recordAsOf: at}, at).page).toEqual([]);
});
test('an expired property is NOT_EFFECTIVE rather than labelled as future/active', () => {
  const value = history(1); value.versions[0]!.validTo = '2026-10-01T00:00:00.000000';
  expect(unitReadState(value, at)).toBe('NOT_EFFECTIVE');
  expect(unitDisplayAt(value, at)).toMatchObject({mode: 'REGISTERED', name: 'TEST 业务单元 1'});
});
test('list contract is bounded and rejects unsupported filters', () => {
  expect(() => unitCheck(UnitListSchema, {campus: 'NORTH', q: '00001', state: 'ACTIVE', limit: 20})).not.toThrow();
  for (const invalid of [{campus: 'NORTH', q: 'a'.repeat(257)}, {campus: 'NORTH', state: 'PUBLISHED'},
    {campus: 'ALL'}, {campus: 'NORTH', limit: 101}, {campus: 'NORTH', unscoped: true}]) {
    expect(() => unitCheck(UnitListSchema, invalid)).toThrow('CLOSED_INPUT_REQUIRED');
  }
});
