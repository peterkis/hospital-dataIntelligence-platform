import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '../../..');

const EXPECTED_WORKSPACES = ['apps/*', 'packages/*', 'tests/*', 'tooling/*'];
const EXPECTED_PACKAGES = new Map([
  ['apps/governance-api', '@hospital-data-intelligence/governance-api'],
  ['apps/admin-web', '@hospital-data-intelligence/admin-web'],
  ['apps/sim-consumer', '@hospital-data-intelligence/sim-consumer'],
  ['packages/generated-api-client', '@hospital-data-intelligence/generated-api-client'],
  ['tests/api', '@hospital-data-intelligence/api-tests'],
  ['tests/e2e', '@hospital-data-intelligence/e2e-tests'],
  ['tests/fault', '@hospital-data-intelligence/fault-tests'],
  ['tooling/verification', '@hospital-data-intelligence/verification-tooling'],
]);
const AUTHORITY_DIRECTORIES = ['db/migrations', 'contracts/openapi'];
const FORBIDDEN_LOCKS = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function walkForFile(start, targetName, ignoredNames = new Set()) {
  const matches = [];
  if (!existsSync(start)) return matches;

  for (const entry of readdirSync(start, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name)) continue;
    const path = join(start, entry.name);
    if (entry.name === targetName) matches.push(path);
    if (entry.isDirectory()) matches.push(...walkForFile(path, targetName, ignoredNames));
  }
  return matches;
}

const rootPackage = readJson(join(ROOT, 'package.json'));
assert.equal(rootPackage.private, true, 'The root package must remain private.');
assert.equal(rootPackage.packageManager, 'npm@11.9.0');
assert.deepEqual(rootPackage.workspaces, EXPECTED_WORKSPACES);

for (const [workspacePath, expectedName] of EXPECTED_PACKAGES) {
  const packagePath = join(ROOT, workspacePath, 'package.json');
  assert.ok(existsSync(packagePath), `Missing workspace package: ${workspacePath}`);
  const workspacePackage = readJson(packagePath);
  assert.equal(workspacePackage.name, expectedName, `Unexpected package name at ${workspacePath}`);
  assert.equal(workspacePackage.private, true, `${workspacePath} must remain private`);
}

for (const authorityPath of AUTHORITY_DIRECTORIES) {
  const fullPath = join(ROOT, authorityPath);
  assert.ok(existsSync(fullPath) && statSync(fullPath).isDirectory(), `Missing authority directory: ${authorityPath}`);
  assert.equal(existsSync(join(fullPath, 'package.json')), false, `${authorityPath} must not become an npm package`);
}

const localLocks = walkForFile(ROOT, 'package-lock.json', new Set(['.git', 'node_modules']));
assert.deepEqual(
  localLocks.map((path) => relative(ROOT, path).replaceAll('\\', '/')),
  ['package-lock.json'],
  'The repository must have exactly one root package-lock.json.',
);

for (const lockName of FORBIDDEN_LOCKS) {
  assert.deepEqual(
    walkForFile(ROOT, lockName, new Set(['.git', 'node_modules'])),
    [],
    `${lockName} is forbidden in the Phase 01 repository.`,
  );
}

const nestedGitDirectories = walkForFile(ROOT, '.git', new Set(['node_modules'])).filter(
  (path) => resolve(path) !== resolve(ROOT, '.git'),
);
assert.deepEqual(nestedGitDirectories, [], 'Nested Git repositories are forbidden.');

const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: ROOT,
  encoding: 'utf8',
});
assert.equal(gitRoot.status, 0, gitRoot.stderr);
assert.equal(resolve(gitRoot.stdout.trim()), ROOT, 'Current project directory must be the only Git root.');

console.log(`Repository topology verified: ${EXPECTED_PACKAGES.size} workspaces, one Git root, one npm lock.`);

