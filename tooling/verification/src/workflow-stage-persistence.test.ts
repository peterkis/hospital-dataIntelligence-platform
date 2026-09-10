import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  import.meta.dirname,
  '../../../db/migrations/0008_versioned_approval_workflow.sql',
);
const stageCapacity = 64;

const expectedTemplateVersionStageTypes = [
  'OWNER_FINAL_APPROVAL',
  'PROFESSIONAL_REVIEW_OWNER_FINAL',
  'CAMPUS_CONFIRM_REVIEW_OWNER_FINAL',
  'DOMAIN_CONFIRM_CONTRACT_FINAL',
] as const;

const expectedActionStageTypes = [
  'CAMPUS_PRE_CONFIRMATION',
  'PROFESSIONAL_REVIEW',
  'DOMAIN_SEMANTIC_CONFIRMATION',
  'OWNER_FINAL_APPROVAL',
  'CONTRACT_FINAL_APPROVAL',
  'WITHDRAWAL',
] as const;

const expectedTemplateStages = [
  ['00000000-0000-7000-8000-000000000002', '1', 'OWNER_FINAL_APPROVAL', 'CHARGE_CATALOG_APPROVE', 'false'],
  ['00000000-0000-7000-8000-000000000011', '1', 'PROFESSIONAL_REVIEW', 'CHARGE_CATALOG_REVIEW', 'false'],
  ['00000000-0000-7000-8000-000000000011', '2', 'OWNER_FINAL_APPROVAL', 'CHARGE_CATALOG_APPROVE', 'false'],
  ['00000000-0000-7000-8000-000000000021', '1', 'PROFESSIONAL_REVIEW', 'PRICE_LIST_REVIEW', 'false'],
  ['00000000-0000-7000-8000-000000000021', '2', 'OWNER_FINAL_APPROVAL', 'PRICE_LIST_APPROVE', 'false'],
  ['00000000-0000-7000-8000-000000000031', '1', 'CAMPUS_PRE_CONFIRMATION', 'CAMPUS_PRICE_CONFIRM', 'true'],
  ['00000000-0000-7000-8000-000000000031', '2', 'PROFESSIONAL_REVIEW', 'PRICE_LIST_REVIEW', 'false'],
  ['00000000-0000-7000-8000-000000000031', '3', 'OWNER_FINAL_APPROVAL', 'PRICE_LIST_APPROVE', 'false'],
  ['00000000-0000-7000-8000-000000000041', '1', 'DOMAIN_SEMANTIC_CONFIRMATION', 'SCHEMA_UPGRADE_SUBMIT', 'false'],
  ['00000000-0000-7000-8000-000000000041', '2', 'CONTRACT_FINAL_APPROVAL', 'SCHEMA_UPGRADE_APPROVE', 'false'],
  ['00000000-0000-7000-8000-000000000051', '1', 'PROFESSIONAL_REVIEW', 'PRICE_LIST_REVIEW', 'false'],
  ['00000000-0000-7000-8000-000000000051', '2', 'OWNER_FINAL_APPROVAL', 'RECOVERY_APPROVE', 'false'],
] as const;

describe('workflow stage persistence', () => {
  it('reserves 64 characters for every persisted workflow stage identifier', async () => {
    const migration = await readFile(migrationPath, 'utf8');

    expect(migration).toMatch(
      /alter table workflow\.approval_template_version\s+[^;]*alter column stage_type type varchar\(64\)[^;]*;/iu,
    );
    expect(migration).toMatch(
      /alter table workflow\.approval_action\s+[^;]*alter column stage_type type varchar\(64\)[^;]*;/iu,
    );
    expect(migration).toMatch(
      /create table workflow\.approval_template_stage \([\s\S]*?stage_type varchar\(64\) not null/iu,
    );
    expect(migration).not.toMatch(/stage_type varchar\(32\)/iu);
  });

  it('keeps the approved stage vocabularies, order, and permissions unchanged', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    const templateVersionCheck = capture(
      migration,
      /add constraint approval_template_version_stage_type_check check \(stage_type in \(([\s\S]*?)\)\);/iu,
    );
    const actionCheck = capture(
      migration,
      /add constraint approval_action_stage_type_check check \(stage_type in \(([\s\S]*?)\)\),/iu,
    );
    const templateStageCheck = capture(
      migration,
      /stage_type varchar\(64\) not null check \(stage_type in \(([\s\S]*?)\)\),/iu,
    );

    expect(quotedIdentifiers(templateVersionCheck)).toEqual(expectedTemplateVersionStageTypes);
    expect(quotedIdentifiers(actionCheck)).toEqual(expectedActionStageTypes);
    expect(quotedIdentifiers(templateStageCheck)).toEqual(expectedActionStageTypes.slice(0, -1));

    const templateVersionSeed = capture(
      migration,
      /insert into workflow\.approval_template_version[\s\S]*?\) values([\s\S]*?);/iu,
    );
    const seededTemplateVersionStageTypes = [
      ...templateVersionSeed.matchAll(
        /\(\s*'[^']+'\s*,\s*'[^']+'\s*,\s*\d+\s*,\s*'PUBLISHED'\s*,\s*'([A-Z_]+)'/gu,
      ),
    ].map((match) => match[1]!);
    expect(seededTemplateVersionStageTypes).toEqual([
      'PROFESSIONAL_REVIEW_OWNER_FINAL',
      'PROFESSIONAL_REVIEW_OWNER_FINAL',
      'CAMPUS_CONFIRM_REVIEW_OWNER_FINAL',
      'DOMAIN_CONFIRM_CONTRACT_FINAL',
      'PROFESSIONAL_REVIEW_OWNER_FINAL',
    ]);
    expect(seededTemplateVersionStageTypes.every((stageType) => stageType.length <= stageCapacity)).toBe(true);

    const templateStageSeeds = [
      ...migration.matchAll(
        /insert into workflow\.approval_template_stage[\s\S]*?\) values([\s\S]*?);/giu,
      ),
    ].flatMap((insert) => [
      ...insert[1]!.matchAll(
        /\(\s*'([^']+)'\s*,\s*(\d+)\s*,\s*'([A-Z_]+)'\s*,\s*'([A-Z_]+)'\s*,\s*(true|false)\s*\)/gu,
      ),
    ].map((match) => match.slice(1)));
    expect(templateStageSeeds).toEqual(expectedTemplateStages);
  });
});

function capture(source: string, pattern: RegExp): string {
  const match = pattern.exec(source);
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

function quotedIdentifiers(source: string): readonly string[] {
  return [...source.matchAll(/'([A-Z_]+)'/gu)].map((match) => match[1]!);
}
