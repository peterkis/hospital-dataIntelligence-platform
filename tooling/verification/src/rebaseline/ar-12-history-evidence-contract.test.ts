import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AR12_HISTORY_EVIDENCE_CONTRACT,
  ar12HistoryEvidenceContractDigest,
  assertAr12HistoryEvidenceStable,
  captureAr12HistoryEvidenceBaseline,
  validateAr12HistoryEvidenceContract,
  type Ar12HistoryEvidenceContract,
} from './ar-12-history-evidence-contract.js';

const SUMMARY_BYTES = Buffer.from('{"status":"PASSED","formalAcceptanceEligible":false}\n');
const RECOVERY_BYTES = Buffer.from(JSON.stringify({
  treeDigestBefore: 'a'.repeat(64),
  treeDigestAfter: 'a'.repeat(64),
  failedFinalRunDirectoryPreserved: true,
}) + '\n');

describe('AR-12 required history evidence contract', () => {
  it('freezes the six required histories in stable order', () => {
    expect(AR12_HISTORY_EVIDENCE_CONTRACT.requiredHistories.map((entry) => entry.relativeDirectory)).toEqual([
      '20260830-db57406-precloseout',
      '20260830-db57406-precloseout-r2',
      '20260830-db57406-precloseout-r3',
      '20260830-db57406-precloseout-r4',
      '20260830-4dca3ca-final',
      '20260831-1d1204a-precloseout-r2',
    ]);
    expect(Object.isFrozen(AR12_HISTORY_EVIDENCE_CONTRACT)).toBe(true);
  });

  it('binds the rejected sixth Summary bytes and classification', () => {
    const sixth = AR12_HISTORY_EVIDENCE_CONTRACT.requiredHistories[5]!;
    expect(sixth).toMatchObject({
      classification: 'SUMMARY_CONTRACT_FAILED_HISTORY',
      formalAcceptanceEligible: false,
      required: true,
      requiredArtifacts: [{
        relativePath: 'ar-12-rebaseline-summary.json',
        sha256: 'be19b1557dc75dc2adae612fefdd5088116677acc3414f151feddf0d10ad2cff',
      }],
    });
  });

  it('accepts six valid required histories, recovery, and stale-clone absence', async () => {
    await withFixture(async (fixture) => {
      const baseline = await fixture.capture();
      expect(baseline).toMatchObject({
        requiredHistoryCount: 6,
        requiredHistoryPassedCount: 6,
        requiredEntriesStatus: 'PASSED',
        staleCloneStatus: 'ABSENT',
      });
    });
  });

  it('fails when the sixth directory is missing', async () => {
    await withFixture(async (fixture) => {
      await rm(fixture.sixthDirectory, { recursive: true });
      await expect(fixture.capture()).rejects.toThrowError('AR12_HISTORY_REQUIRED_DIRECTORY_MISSING');
    });
  });

  it('fails when the sixth Summary is missing', async () => {
    await withFixture(async (fixture) => {
      await unlink(fixture.sixthSummary);
      await expect(fixture.capture()).rejects.toThrowError('AR12_HISTORY_REQUIRED_ARTIFACT_MISSING');
    });
  });

  it('fails when the sixth Summary SHA changes', async () => {
    await withFixture(async (fixture) => {
      await writeFile(fixture.sixthSummary, '{"status":"PASSED","tampered":true}\n');
      await expect(fixture.capture()).rejects.toThrowError('AR12_HISTORY_REQUIRED_ARTIFACT_SHA256_MISMATCH');
    });
  });

  it('fails when the sixth classification changes', () => {
    const contract = syntheticContract();
    contract.requiredHistories[5]!.classification = 'INITIAL_REBASELINE_PASSED_HISTORY';
    expect(() => validateAr12HistoryEvidenceContract(contract)).toThrowError('AR12_HISTORY_CLASSIFICATION_MISMATCH');
  });

  it('keeps an internal PASSED Summary externally rejected', async () => {
    await withFixture(async (fixture) => {
      const sixth = (await fixture.capture()).requiredHistories[5]!;
      expect(JSON.parse(await readFile(fixture.sixthSummary, 'utf8')).status).toBe('PASSED');
      expect(sixth).toMatchObject({
        classification: 'SUMMARY_CONTRACT_FAILED_HISTORY',
        contractDisposition: 'REJECTED',
        rejectionClassification: 'SUMMARY_CONTRACT_FAILED_HISTORY',
        formalAcceptanceEligible: false,
      });
    });
  });

  it('does not let an extra directory substitute for the sixth', async () => {
    await withFixture(async (fixture) => {
      await rm(fixture.sixthDirectory, { recursive: true });
      await mkdir(join(fixture.outputRoot, '20260831-extra-precloseout'));
      await expect(fixture.capture()).rejects.toThrowError('AR12_HISTORY_EXTRA_DIRECTORY_CANNOT_SUBSTITUTE_REQUIRED');
    });
  });

  it('fails even when generic discovery sees an extra directory but not the sixth', async () => {
    await withFixture(async (fixture) => {
      await rm(fixture.sixthDirectory, { recursive: true });
      await mkdir(join(fixture.outputRoot, 'generic-fingerprint-history'));
      await writeFile(join(fixture.outputRoot, 'generic-fingerprint-history', 'artifact.json'), '{}\n');
      await expect(fixture.capture()).rejects.toThrowError('AR12_HISTORY_EXTRA_DIRECTORY_CANNOT_SUBSTITUTE_REQUIRED');
    });
  });

  it('detects required directory tree drift during finalize comparison', async () => {
    await withFixture(async (fixture) => {
      const opening = await fixture.capture();
      await writeFile(join(fixture.sixthDirectory, 'new-artifact.json'), '{}\n');
      const ending = await fixture.capture();
      expect(() => assertAr12HistoryEvidenceStable(opening, ending)).toThrowError('AR12_HISTORY_REQUIRED_DIRECTORY_TREE_DRIFT');
    });
  });

  it('detects recovery SHA drift', async () => {
    await withFixture(async (fixture) => {
      await writeFile(fixture.recoveryArtifact, '{"tampered":true}\n');
      await expect(fixture.capture()).rejects.toThrowError('AR12_RECOVERY_ARTIFACT_SHA256_MISMATCH');
    });
  });

  it('detects a reappeared stale clone', async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture.outputRoot, 'worktrees', 'db57406-precloseout'), { recursive: true });
      await expect(fixture.capture()).rejects.toThrowError('AR12_STALE_EXECUTION_CLONE_REAPPEARED');
    });
  });

  it('rejects duplicate required history paths', () => {
    const contract = syntheticContract();
    contract.requiredHistories[1]!.relativeDirectory = contract.requiredHistories[0]!.relativeDirectory;
    expect(() => validateAr12HistoryEvidenceContract(contract)).toThrowError('AR12_HISTORY_ENTRY_DUPLICATE');
  });

  it('rejects nondeterministic required history order', () => {
    const contract = syntheticContract();
    [contract.requiredHistories[0], contract.requiredHistories[1]] = [
      contract.requiredHistories[1]!, contract.requiredHistories[0]!,
    ];
    expect(() => validateAr12HistoryEvidenceContract(contract)).toThrowError('AR12_HISTORY_ENTRY_ORDER_INVALID');
  });

  it('rejects path traversal', () => {
    const contract = syntheticContract();
    contract.requiredHistories[0]!.relativeDirectory = '../escaped';
    expect(() => validateAr12HistoryEvidenceContract(contract)).toThrowError('AR12_HISTORY_CONTRACT_INVALID');
  });

  it('rejects a symlink or Junction escape', async () => {
    await withFixture(async (fixture) => {
      const target = join(fixture.root, 'outside');
      await mkdir(target);
      await rm(fixture.sixthDirectory, { recursive: true });
      await symlink(target, fixture.sixthDirectory, process.platform === 'win32' ? 'junction' : 'dir');
      await expect(fixture.capture()).rejects.toThrowError('AR12_HISTORY_REQUIRED_DIRECTORY_MISSING');
    });
  });

  it('produces deterministic contract and historical set digests', async () => {
    await withFixture(async (fixture) => {
      const first = await fixture.capture('2026-08-31T00:00:00.000Z');
      const second = await fixture.capture('2026-08-31T00:00:01.000Z');
      expect(first.historyContractDigest).toBe(second.historyContractDigest);
      expect(first.historicalEvidenceSetDigest).toBe(second.historicalEvidenceSetDigest);
      expect(ar12HistoryEvidenceContractDigest(fixture.contract)).toBe(first.historyContractDigest);
    });
  });

  it('records additional history without changing required count', async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture.outputRoot, '20260831-additional-history'));
      const baseline = await fixture.capture();
      expect(baseline.requiredHistoryCount).toBe(6);
      expect(baseline.discoveredAdditionalHistories).toHaveLength(1);
      expect(baseline.discoveredAdditionalHistories[0]?.relativeDirectory).toBe('20260831-additional-history');
    });
  });

  it('fails closed when the rejected Summary is not valid JSON', async () => {
    await withFixture(async (fixture) => {
      await writeFile(fixture.sixthSummary, 'not-json\n');
      fixture.contract.requiredHistories[5]!.requiredArtifacts[0]!.sha256 = digest(Buffer.from('not-json\n'));
      await expect(fixture.capture()).rejects.toThrowError('AR12_HISTORY_CONTRACT_INVALID');
    });
  });

  it('fails when the rejected Summary binding is absent', () => {
    const contract = syntheticContract();
    contract.requiredHistories[5]!.requiredArtifacts = [];
    expect(() => validateAr12HistoryEvidenceContract(contract)).toThrowError('AR12_HISTORY_SUMMARY_CONTRACT_FAILURE_NOT_BOUND');
  });
});

interface Fixture {
  readonly root: string;
  readonly outputRoot: string;
  readonly currentRun: string;
  readonly sixthDirectory: string;
  readonly sixthSummary: string;
  readonly recoveryArtifact: string;
  readonly contract: MutableContract;
  capture(capturedAt?: string): ReturnType<typeof captureAr12HistoryEvidenceBaseline>;
}

type MutableContract = {
  -readonly [Key in keyof Ar12HistoryEvidenceContract]: Ar12HistoryEvidenceContract[Key] extends readonly (infer Item)[]
    ? Array<{ -readonly [ItemKey in keyof Item]: Item[ItemKey] extends readonly (infer Artifact)[]
      ? Array<{ -readonly [ArtifactKey in keyof Artifact]: Artifact[ArtifactKey] }>
      : Item[ItemKey] }>
    : Ar12HistoryEvidenceContract[Key]
};

async function withFixture(action: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'hdi-ar12-history-contract-'));
  const outputRoot = join(root, 'ar-12');
  const currentRun = join(outputRoot, 'current-run');
  const contract = syntheticContract();
  try {
    await mkdir(outputRoot);
    for (const entry of contract.requiredHistories) await mkdir(join(outputRoot, entry.relativeDirectory));
    const sixthDirectory = join(outputRoot, contract.requiredHistories[5]!.relativeDirectory);
    const sixthSummary = join(sixthDirectory, 'ar-12-rebaseline-summary.json');
    await writeFile(sixthSummary, SUMMARY_BYTES);
    const recoveryArtifact = join(outputRoot, contract.recoveryArtifact.relativePath);
    await mkdir(resolve(recoveryArtifact, '..'), { recursive: true });
    await writeFile(recoveryArtifact, RECOVERY_BYTES);
    await action({
      root,
      outputRoot,
      currentRun,
      sixthDirectory,
      sixthSummary,
      recoveryArtifact,
      contract,
      capture: (capturedAt = '2026-08-31T00:00:00.000Z') =>
        captureAr12HistoryEvidenceBaseline(outputRoot, currentRun, contract, () => capturedAt),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function syntheticContract(): MutableContract {
  const contract = JSON.parse(JSON.stringify(AR12_HISTORY_EVIDENCE_CONTRACT)) as MutableContract;
  for (const entry of contract.requiredHistories) entry.requiredArtifacts = [];
  contract.requiredHistories[5]!.requiredArtifacts = [{
    relativePath: 'ar-12-rebaseline-summary.json',
    sha256: digest(SUMMARY_BYTES),
  }];
  contract.recoveryArtifact = {
    relativePath: 'recovery/20260830-0267bba/execution-workspace-relocation.json',
    sha256: digest(RECOVERY_BYTES),
  };
  return contract;
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
