import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const allowed = new Set(['@hospital-data-intelligence/generated-api-client', 'json-canonicalize', 'typebox']);
assert.equal(manifest.private, true);
assert.equal(manifest.type, 'module');
assert.deepEqual(Object.keys(manifest.exports), ['.']);
assert.deepEqual(manifest.exports['.'], { types: './src/index.ts', import: './dist/index.js' });
assert.ok(Object.keys(manifest.dependencies).every((name) => allowed.has(name)), 'SDK_DEPENDENCY_BOUNDARY');
const files = readdirSync(resolve(root, 'src')).filter((name) => name.endsWith('.ts') && !/\.(test|compile-test)\.ts$/u.test(name));
const edges = new Map();
for (const name of files) {
  const path = resolve(root, 'src', name);
  const source = readFileSync(path, 'utf8');
  const imports = [];
  assert.ok(!/\b(?:as|extends)\s+any\b|:\s*any\b|<\s*any\b/u.test(source), 'SDK_ANY_ESCAPE');
  assert.ok(!/\bfetch\s*\(|\bimport\s*\(/u.test(source), 'SDK_BYPASSES_GENERATED_CLIENT');
  for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)) {
      const target = match[1];
      if (target.startsWith('.')) {
        const dependency = resolve(dirname(path), target.replace(/\.js$/u, '.ts'));
        assert.ok(files.some((file) => resolve(root, 'src', file) === dependency), 'SDK_PRIVATE_PATH_IMPORT');
        imports.push(dependency);
      } else {
        assert.ok(target.startsWith('node:') || [...allowed].some((entry) => target === entry || target.startsWith(`${entry}/`)), 'SDK_SERVER_IMPORT');
      }
  }
  edges.set(path, imports);
}
function walk(path, ancestors) {
  assert.ok(!ancestors.has(path), 'SDK_CIRCULAR_DEPENDENCY');
  for (const child of edges.get(path) ?? []) walk(child, new Set([...ancestors, path]));
}
for (const path of edges.keys()) walk(path, new Set());
const client = JSON.parse(readFileSync(resolve(root, '../generated-api-client/package.json'), 'utf8'));
assert.ok(!client.dependencies[manifest.name], 'SDK_WORKSPACE_CYCLE');
console.log('SDK package verified: private ESM export, generated-client boundary, no any or import cycles.');
