import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ABG_GATES } from './abg-catalog.js';
import {
  getAbgCoverageMatrixDigest,
  getAbgProducerProtocolIdentityDigest,
} from './abg-gate-proof.js';
import { readFrozenInputs } from './frozen-inputs.js';
import {
  CURRENT_EVIDENCE_CONTRACT_IDENTITY,
  RUN_PLAN_AUTHORITY_ID,
  RUN_PLAN_SCHEMA_VERSION,
} from './verification-contract-versions.js';

export { readFrozenInputs } from './frozen-inputs.js';

export interface AuthoritativeCommandSpec {
  readonly executable: string;
  readonly args: readonly string[];
  readonly workingDirectory?: string;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface AuthoritativeGateCommandSpec extends AuthoritativeCommandSpec {
  readonly gateId: string;
}

export interface FrozenRunPlan {
  readonly schemaVersion: typeof RUN_PLAN_SCHEMA_VERSION;
  readonly authorityId: typeof RUN_PLAN_AUTHORITY_ID;
  readonly runSequence: number;
  readonly producerSourceManifestPath: 'provenance/producer-source-manifest.json';
  readonly producerSourceManifestSha256: string;
  readonly producerGitCommitSha: string;
  readonly contractIdentity: typeof CURRENT_EVIDENCE_CONTRACT_IDENTITY;
  readonly frozenInputs: Readonly<Record<string, string>>;
  readonly authorityIdentity: VerificationAuthorityIdentity;
  readonly setupCommands: readonly AuthoritativeCommandSpec[];
  readonly gates: readonly AuthoritativeGateCommandSpec[];
}

export interface ProducerSourceManifestReference {
  readonly path: 'provenance/producer-source-manifest.json';
  readonly sha256: string;
  readonly producerGitCommitSha: string;
}

export interface VerificationAuthorityIdentity {
  readonly coverageMatrixDigest: string;
  readonly coverageMatrixSourceSha256: string;
  readonly producerProtocolIdentityDigest: string;
  readonly producerProtocolSourceSha256: string;
  readonly gateProofSourceSha256: string;
}

export async function buildAuthoritativeRunPlan(
  repositoryRoot: string,
  runSequence: number,
  producerSourceManifest: ProducerSourceManifestReference,
): Promise<FrozenRunPlan> {
  const frozenInputs = await readFrozenInputs(repositoryRoot, producerSourceManifest.sha256);
  if (frozenInputs['gitCommitSha'] !== producerSourceManifest.producerGitCommitSha) {
    throw new Error('PRODUCER_SOURCE_MANIFEST_GIT_COMMIT_MISMATCH');
  }
  return {
    schemaVersion: RUN_PLAN_SCHEMA_VERSION,
    authorityId: RUN_PLAN_AUTHORITY_ID,
    runSequence,
    producerSourceManifestPath: producerSourceManifest.path,
    producerSourceManifestSha256: producerSourceManifest.sha256,
    producerGitCommitSha: producerSourceManifest.producerGitCommitSha,
    contractIdentity: CURRENT_EVIDENCE_CONTRACT_IDENTITY,
    frozenInputs,
    authorityIdentity: await readVerificationAuthorityIdentity(repositoryRoot),
    setupCommands: [
      {
        executable: 'npm',
        args: ['ci'],
      },
      {
        executable: 'bash',
        args: ['phase-plan/environment/anolis-8.9-wsl2/bootstrap-phase-01-runtime.sh'],
      },
      {
        executable: 'node',
        args: ['tooling/verification/src/run-shared-abg-verification.ts'],
        environment: {
          NODE_OPTIONS: '--loader=./tooling/verification/node-ts-loader.mjs',
        },
      },
    ],
    gates: ABG_GATES.map((gate) => ({
      gateId: gate.gateId,
      executable: 'node',
      args: ['tooling/verification/src/produce-abg-gate.ts'],
      environment: {
        NODE_OPTIONS: '--loader=./tooling/verification/node-ts-loader.mjs',
      },
    })),
  };
}

export async function readVerificationAuthorityIdentity(
  repositoryRoot: string,
): Promise<VerificationAuthorityIdentity> {
  return {
    coverageMatrixDigest: getAbgCoverageMatrixDigest(),
    coverageMatrixSourceSha256: await fileSha256(
      join(repositoryRoot, 'tooling/verification/src/abg-coverage-matrix.ts'),
    ),
    producerProtocolIdentityDigest: getAbgProducerProtocolIdentityDigest(),
    producerProtocolSourceSha256: await fileSha256(
      join(repositoryRoot, 'tooling/verification/src/evidence/protocol.ts'),
    ),
    gateProofSourceSha256: await fileSha256(
      join(repositoryRoot, 'tooling/verification/src/abg-gate-proof.ts'),
    ),
  };
}

async function fileSha256(path: string): Promise<string> {
  return sha256(await readFile(path));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('CANONICAL_JSON_VALUE_UNSUPPORTED');
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
    ).join(',')}}`;
  }
  throw new Error('CANONICAL_JSON_VALUE_UNSUPPORTED');
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
