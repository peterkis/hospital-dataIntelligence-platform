import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPublishedProjectionSnapshot } from './index.js';

const sourceHash = Buffer.from('7f'.repeat(32), 'hex');
const base = {
  sourceGovernanceStatus: 'PUBLISHED',
  departmentId: '72000000-0000-7000-8000-000000000001',
  departmentVersionId: '72100000-0000-7000-8000-000000000001',
  departmentCode: 'DEP-00001',
  standardName: '呼吸与危重症医学科',
  departmentType: 'CLINICAL' as const,
  subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE' as const,
  campuses: ['总部院区', '高新院区'],
  hierarchies: {
    ADMINISTRATIVE: '内科系统',
    OPERATIONAL: '肺病中心',
  },
  qualityScore: '98.50',
  publishedReleaseId: '75000000-0000-7000-8000-000000000001',
  publishedAt: '2026-09-03T16:00:00',
  contentHash: sourceHash,
};

describe('department-master published projection', () => {
  it('builds the read-only projection when the source version is published', () => {
    const projection = createPublishedProjectionSnapshot(base);
    expect(projection).toMatchObject({
      departmentCode: 'DEP-00001',
      standardName: '呼吸与危重症医学科',
      campuses: ['总部院区', '高新院区'],
      hierarchies: {
        ADMINISTRATIVE: '内科系统',
        OPERATIONAL: '肺病中心',
      },
      subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE',
    });
  });

  it.each(['DRAFT', 'PENDING', 'REJECTED'])('%s does not produce a projection', (status) => {
    expect(() => createPublishedProjectionSnapshot({
      ...base,
      sourceGovernanceStatus: status,
    })).toThrowError('DEPARTMENT_PROJECTION_REQUIRES_PUBLISHED_VERSION');
  });

  it('keeps the exact source version hash', () => {
    const projection = createPublishedProjectionSnapshot(base);
    expect(projection.contentHash.equals(sourceHash)).toBe(true);
    expect(projection.contentHash).not.toBe(sourceHash);
  });

  it('freezes hierarchy and campus snapshots against later input changes', () => {
    const campuses = [...base.campuses];
    const hierarchies = { ...base.hierarchies };
    const projection = createPublishedProjectionSnapshot({ ...base, campuses, hierarchies });
    campuses.push('后来院区');
    hierarchies.ADMINISTRATIVE = '后来层级';
    expect(projection.campuses).toEqual(['总部院区', '高新院区']);
    expect(projection.hierarchies['ADMINISTRATIVE']).toBe('内科系统');
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.campuses)).toBe(true);
    expect(Object.isFrozen(projection.hierarchies)).toBe(true);
  });

  it('defines publication and projection persistence in one rollback boundary', () => {
    const migration = readFileSync(resolve(
      import.meta.dirname,
      '../../../../../db/migrations/0015_department_published_projection.sql',
    ), 'utf8');
    expect(migration.trimStart().startsWith('BEGIN;')).toBe(true);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('published department version requires a published projection');
  });

  it('allows only one-time closure while rejecting projection content replacement', () => {
    const migration = readFileSync(resolve(
      import.meta.dirname,
      '../../../../../db/migrations/0015_department_published_projection.sql',
    ), 'utf8');
    expect(migration).toContain('department published projection content is immutable');
    expect(migration).toContain('OLD.superseded_at IS NOT NULL');
    expect(migration).toContain('NEW.campuses <> OLD.campuses');
    expect(migration).toContain('NEW.hierarchies <> OLD.hierarchies');
  });
});
