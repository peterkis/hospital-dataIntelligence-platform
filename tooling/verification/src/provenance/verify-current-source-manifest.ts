import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  buildProducerSourceManifest,
  sourceManifestSha256,
} from './source-manifest.js';
import { parseVerificationSourceManifest } from './source-manifest-schema.js';

export interface VerifyCurrentSourceManifestOutput {
  write(value: string): void;
}

/** Read-only verification entry point. It never writes evidence or starts dependencies. */
export async function main(
  args: readonly string[] = process.argv.slice(2),
  output: VerifyCurrentSourceManifestOutput = process.stdout,
): Promise<void> {
  if (args.length > 1) throw new Error('SOURCE_MANIFEST_VERIFY_ARGUMENTS_INVALID');
  const repositoryRoot = resolve(args[0] ?? process.cwd());
  const manifest = parseVerificationSourceManifest(
    await buildProducerSourceManifest(repositoryRoot),
  );
  if (manifest.manifestRole !== 'PRODUCER') throw new Error('SOURCE_MANIFEST_VERIFY_ROLE_INVALID');
  output.write(JSON.stringify({
    status: 'PASSED',
    schemaVersion: manifest.schemaVersion,
    repositoryFullName: manifest.repositoryFullName,
    producerGitCommitSha: manifest.producerGitCommitSha,
    producerWorktreeState: manifest.producerWorktreeState,
    sourceFileCount: manifest.sourceFileCount,
    sourceFilesDigest: manifest.sourceFilesDigest,
    producerSourceManifestSha256: sourceManifestSha256(manifest),
  }) + '\n');
}

const entryPath = process.argv[1];
if (entryPath !== undefined && resolve(entryPath) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
