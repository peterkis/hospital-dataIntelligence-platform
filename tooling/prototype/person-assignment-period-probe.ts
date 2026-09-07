import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import type { AssignmentVersion, CreateAssignment } from '../../apps/governance-api/src/modules/person-master/index.js';
import { assignmentScope, Jul, Aug, Dec, type createAssignmentFixture } from './person-assignment-fixture.js';

type Fixture = Awaited<ReturnType<typeof createAssignmentFixture>>;
type Check = (ids: string[], name: string, work: () => Promise<unknown>) => Promise<void>;
export async function runAssignmentPeriodProbe(database: Kysely<DB>, f: Fixture,
  command: (engagementId: string, from?: string, to?: string | null, departmentId?: string) => CreateAssignment,
  keep: (v: AssignmentVersion) => AssignmentVersion, check: Check) {
  const tick = (n: number, short = false) => {
    const fraction = String(n).padStart(6, '0');
    return `${Jul}.${short ? fraction.replace(/0+$/u, '') || '0' : fraction}`;
  };
  // Independent integer microsecond reference, no production temporal helper.
  const number = (value: string) => Number((value.split('.')[1] ?? '').padEnd(6, '0'));
  await check(['SC-02', 'SC-06'], 'standalone period reader persists entity/query audit and propagates audit failure', async () => {
    const e = await f.createEngagement(), request = randomUUID();
    const query = { ...assignmentScope, engagementId: e.engagementId, requestedFrom: Jul, requestedTo: Aug, recordAsOf: await f.now() };
    await f.periodReader(request).getEngagementEffectivePeriodAsOf(query);
    const rows = await database.selectFrom('audit.audit_event').select(['action', 'actor_principal_id', 'stable_entity_id', 'event_payload'])
      .where('request_id', '=', request).execute();
    assert.equal(rows.length, 1); assert.equal(rows[0]!.action, 'PERSON_ENGAGEMENT_BUSINESS_STATE_READ');
    assert.equal(rows[0]!.actor_principal_id, f.actor); assert.equal(rows[0]!.stable_entity_id, e.engagementId);
    const payload = JSON.stringify(rows[0]!.event_payload);
    for (const value of [Jul, Aug, query.recordAsOf, 'EFFECTIVE_ENGAGEMENT_PERIOD_CONTEXT']) assert.ok(payload.includes(value));
    configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
    try { await assert.rejects(f.periodReader().getEngagementEffectivePeriodAsOf(query), { message: 'CONTROLLED_PUBLICATION_FAULT:AUDIT_EVENT_WRITTEN' }); }
    finally { configureControlledPublicationFault(null); }
    return { entityAuditCount: rows.length, queryConditionsRecorded: true, auditFailurePropagated: true };
  });
  await check(['GT-05', 'TM-12', 'SC-02'], '500 actual owner reads match independent integer oracle across late facts and six R views', async () => {
    const e = await f.createEngagement(tick(2));
    const records = [e.recordedFrom];
    const events = [
      { at: 5, type: 'SUSPENDED' as const }, { at: 10, type: 'RESUMED' as const },
      { at: 3, type: 'SUSPENDED' as const }, { at: 4, type: 'RESUMED' as const },
    ];
    for (const [i, event] of events.entries()) {
      const c = { ...assignmentScope, engagementId: e.engagementId, expectedLifecycleSequence: String(i),
        businessEffectiveAt: tick(event.at), reasonCode: 'SYNTHETIC_C01_ORACLE' };
      const appended = event.type === 'SUSPENDED' ? await f.lifecycle().suspendEngagement(c) : await f.lifecycle().resumeEngagement(c);
      records.push(appended.recordedAt);
    }
    const shortened = await f.core().reviseEngagement({ ...assignmentScope, engagementId: e.engagementId,
      expectedCurrentVersionId: e.engagementVersionId, businessValidFrom: tick(2), businessValidTo: tick(15), reasonCode: 'VALIDITY_CORRECTION' });
    records.push(shortened.recordedFrom);
    let seed = 60107, checks = 0;
    const next = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % max; };
    const recordCoverage = new Set<number>(), observedStates = new Set<string>();
    let infinite = 0, maxSegments = 0;
    for (let trial = 0; trial < 500; trial++) {
      const a = next(20), b = next(4) === 0 ? null : a + 1 + next(7), r = trial % 6;
      recordCoverage.add(r); if (b === null) infinite++;
      const view = await f.periodReader().getEngagementEffectivePeriodAsOf({ ...assignmentScope, engagementId: e.engagementId,
        requestedFrom: tick(a, trial % 2 === 0), requestedTo: b === null ? null : tick(b, trial % 3 === 0), recordAsOf: records[r]! });
      assert.equal(view.authorityEngagementVersionId, r === 5 ? shortened.engagementVersionId : e.engagementVersionId);
      assert.equal(number(view.stateSegments[0]!.from), a);
      assert.equal(view.stateSegments.at(-1)!.to === null ? null : number(view.stateSegments.at(-1)!.to!), b);
      maxSegments = Math.max(maxSegments, view.stateSegments.length);
      for (let i = 1; i < view.stateSegments.length; i++) assert.equal(view.stateSegments[i - 1]!.to, view.stateSegments[i]!.from);
      for (let x = a; x < (b ?? 35); x++) {
        let last: { at: number; type: 'SUSPENDED' | 'RESUMED'; sequence: number } | null = null;
        for (const [i, event] of events.entries()) if (i + 1 <= r && event.at <= x &&
          (last === null || event.at > last.at || (event.at === last.at && i + 1 > last.sequence))) last = { ...event, sequence: i + 1 };
        const expected = x < 2 ? 'PLANNED' : r === 5 && x >= 15 ? 'ENDED' : last?.type === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
        const applicable = view.stateSegments.filter(s => number(s.from) <= x && (s.to === null || x < number(s.to)));
        assert.equal(applicable.length, 1); assert.equal(applicable[0]!.businessState, expected);
        observedStates.add(expected); checks++;
      }
      if ((trial + 1) % 100 === 0) console.log(JSON.stringify({ periodOracleCases: trial + 1 }));
    }
    assert.equal(recordCoverage.size, 6); assert.equal(observedStates.size, 4); assert.ok(infinite > 0);
    return { seed: 60107, cases: 500, pointAssertions: checks, recordViews: [...recordCoverage].sort(),
      states: [...observedStates].sort(), unboundedCases: infinite, maxSegments };
  });
  await check(['TM-13'], 'actual 65th in-range event refuses while an irrelevant 66-event prefix stays bounded', async () => {
    const e = await f.createEngagement();
    for (let i = 0; i < 66; i++) {
      const c = { ...assignmentScope, engagementId: e.engagementId, expectedLifecycleSequence: String(i),
        businessEffectiveAt: tick(i + 1), reasonCode: 'SYNTHETIC_C01_BUDGET' };
      if (i % 2 === 0) await f.lifecycle().suspendEngagement(c); else await f.lifecycle().resumeEngagement(c);
    }
    const query = { ...assignmentScope, engagementId: e.engagementId, requestedFrom: Jul, recordAsOf: await f.now() };
    const atLimit = await f.periodReader().getEngagementEffectivePeriodAsOf({ ...query, requestedTo: tick(65) });
    assert.equal(atLimit.stateSegments.length, 65);
    assert.ok(Buffer.byteLength(JSON.stringify(atLimit)) < 65536);
    await assert.rejects(f.periodReader().getEngagementEffectivePeriodAsOf({ ...query, requestedTo: tick(66) }),
      { message: 'ASSIGNMENT_DEPENDENCY_EVALUATION_LIMIT' });
    await assert.rejects(f.app().createAssignment(command(e.engagementId, Jul, tick(66))),
      { message: 'ASSIGNMENT_DEPENDENCY_EVALUATION_LIMIT' });
    const prefix = await f.periodReader().getEngagementEffectivePeriodAsOf({ ...query, requestedFrom: Aug, requestedTo: null });
    assert.equal(prefix.stateSegments.length, 1); assert.equal(prefix.stateSegments[0]!.businessState, 'ACTIVE');
    assert.equal(prefix.stateSegments[0]!.lifecycleSequence, '66');
    keep(await f.app().createAssignment(command(e.engagementId, Aug, Dec)));
    return { candidateLimit: 64, detectedCandidate: 65, atLimitSegments: atLimit.stateSegments.length,
      atLimitEvidenceBytes: Buffer.byteLength(JSON.stringify(atLimit)), ignoredPrefixEvents: 65, prefix };
  });
}
