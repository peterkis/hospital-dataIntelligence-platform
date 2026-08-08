import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '../../..');
const API_SOURCE = join(ROOT, 'apps/governance-api/src');
const MODULES_ROOT = join(API_SOURCE, 'modules');

const EXPECTED_MODULES = [
  'audit',
  'authorization',
  'charge-catalog',
  'price-list',
  'price-resolution',
  'release-distribution',
  'workflow',
];
const FORBIDDEN_HORIZONTAL_DIRECTORIES = [
  'controllers',
  'models',
  'repositories',
  'services',
  'shared',
  'common',
  'utils',
];
const FORBIDDEN_MODULES = [
  'compatibility',
  'contract-governance',
  'delivery',
  'digest',
  'outbox',
  'projection-schema',
  'publication',
  'snapshot-builder',
  'snapshot-store',
  'version',
];

function collectTypeScriptFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(path);
    return extname(entry.name) === '.ts' ? [path] : [];
  });
}

for (const directory of FORBIDDEN_HORIZONTAL_DIRECTORIES) {
  assert.equal(
    existsSync(join(API_SOURCE, directory)),
    false,
    `Horizontal source directory is forbidden: ${directory}`,
  );
}

for (const moduleName of EXPECTED_MODULES) {
  assert.ok(
    existsSync(join(MODULES_ROOT, moduleName, 'index.ts')),
    `Missing unique public module entry: ${moduleName}/index.ts`,
  );
}

for (const moduleName of FORBIDDEN_MODULES) {
  assert.equal(
    existsSync(join(MODULES_ROOT, moduleName)),
    false,
    `Forbidden Phase 01 module was created: ${moduleName}`,
  );
}

const sourceFiles = collectTypeScriptFiles(API_SOURCE);
for (const file of sourceFiles) {
  const content = readFileSync(file, 'utf8');
  const deepModuleImport = /(?:from\s+|import\s*\()['"][^'"]*\/modules\/[^/'"]+\/(?!index(?:\.js)?['"])[^'"]+['"]/gu;
  assert.equal(
    deepModuleImport.test(content),
    false,
    `Deep module import is forbidden: ${relative(ROOT, file)}`,
  );

  assert.equal(/\b(BaseService|BaseRepository|BaseController|VersionService|VersionedRepository)\b/u.test(content), false, `Forbidden generic business abstraction in ${relative(ROOT, file)}`);
}

for (const externalRoot of ['apps/admin-web', 'apps/sim-consumer', 'packages', 'tests']) {
  for (const file of collectTypeScriptFiles(join(ROOT, externalRoot))) {
    const content = readFileSync(file, 'utf8');
    assert.equal(
      content.includes('governance-api/src'),
      false,
      `External workspace imports governance implementation: ${relative(ROOT, file)}`,
    );
  }
}

console.log(`Module boundaries verified: ${EXPECTED_MODULES.length} deep-module entries, no forbidden structure.`);
