import { describe, expect, it } from 'vitest';
import {
  PROTOTYPE_JOURNEY_STORAGE_KEY,
  buildResolutionTimes,
  createInitialJourneyState,
  loadPrototypeJourneyState,
  resetPrototypeJourney,
  roleCanPerform,
  savePrototypeJourneyState,
  type PrototypeJourneyState,
} from './prototype-state.js';

describe('prototype journey state', () => {
  it('restores role, current step, UUIDs, digest and resolution from session storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const state: PrototypeJourneyState = {
      ...createInitialJourneyState('PV003-TEST'),
      currentRole: 'prototype-reviewer',
      currentStep: 7,
      chargeItem: {
        chargeItemId: 'charge-uuid',
        chargeItemVersionId: 'version-uuid',
        internalCode: 'PV003-TEST',
        formalName: '原型门诊诊查费',
        versionNo: '1',
        governanceStatus: 'PUBLISHED',
        businessValidFrom: '2026-09-03T10:00:00',
        contentDigest: 'digest-value',
        releaseId: 'release-uuid',
        recordedFrom: '2026-09-03T10:01:00',
      },
    };
    savePrototypeJourneyState(storage, state);
    expect(loadPrototypeJourneyState(storage)).toEqual(state);
    expect([...values.keys()]).toEqual([PROTOTYPE_JOURNEY_STORAGE_KEY]);
  });

  it('reset only removes the browser journey key', () => {
    const removed: string[] = [];
    resetPrototypeJourney({ removeItem: (key) => removed.push(key) });
    expect(removed).toEqual([PROTOTYPE_JOURNEY_STORAGE_KEY]);
  });

  it('does not authorize an incorrect role or advance on its behalf', () => {
    const state = createInitialJourneyState('PV003-ROLE');
    expect(roleCanPerform('prototype-owner', 'prototype-reviewer')).toBe(false);
    expect(state.currentStep).toBe(1);
  });

  it('uses the published price-list recordedFrom as recordAsOf', () => {
    expect(buildResolutionTimes({
      businessValidFrom: '2026-09-03T10:00:00',
      recordedFrom: '2026-09-03T10:05:06.123456',
    })).toEqual({
      serviceOccurredAt: '2026-09-03T10:00:00',
      recordAsOf: '2026-09-03T10:05:06.123456',
    });
  });
});
