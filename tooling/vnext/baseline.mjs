import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('GIT_OBSERVATION_FAILED');
  return result.stdout.trim();
}

try {
  const [command, ...extra] = process.argv.slice(2);
  if (command === 'cleanup') throw new Error('DISPOSAL_NOT_AUTHORIZED');
  if (command === 'check-registry' && extra.length === 1) {
    const entries = JSON.parse(readFileSync(extra[0], 'utf8'));
    if (!Array.isArray(entries) || !entries.length) throw new Error('REGISTRY_REQUIRED');
    const ids = new Set();
    for (const entry of entries) {
      if (Object.keys(entry).sort().join(',') !== 'id,oldConstraint,replacement,semanticTests' ||
          !entry.id || ids.has(entry.id) || !entry.oldConstraint || !entry.replacement) throw new Error('CLOSED_REGISTRY_REQUIRED');
      ids.add(entry.id);
      if (!Array.isArray(entry.semanticTests) || !entry.semanticTests.length) throw new Error('SEMANTIC_TEST_MAPPING_REQUIRED');
      for (const file of entry.semanticTests) {
        if (typeof file !== 'string' || isAbsolute(file) || file.split(/[\\/]/u).includes('..') || !existsSync(resolve(file))) {
          throw new Error('SEMANTIC_TEST_MAPPING_INVALID');
        }
      }
    }
    console.log(JSON.stringify({ status: 'PASS', mappings: entries.length }));
    process.exit(0);
  }
  if (command !== 'inspect' || extra.length) throw new Error('CLOSED_COMMAND_REQUIRED');
  if (git('status', '--porcelain=v1')) throw new Error('WORKTREE_NOT_CLEAN');
  console.log(JSON.stringify({ status: 'PASS', head: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'), branch: git('branch', '--show-current'),
    localRefs: git('show-ref'), remoteObservation: 'NOT_OBSERVED' }));
} catch (error) {
  console.log(JSON.stringify({ status: 'BLOCKED', code: error.message }));
  process.exitCode = 1;
}
