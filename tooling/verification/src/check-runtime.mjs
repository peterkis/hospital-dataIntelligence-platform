import assert from 'node:assert/strict';

const EXPECTED_NODE = '24.18.0';
const EXPECTED_NPM = '11.9.0';

assert.equal(
  process.versions.node,
  EXPECTED_NODE,
  `Node.js ${EXPECTED_NODE} is required; received ${process.versions.node}`,
);

const npmUserAgent = process.env.npm_config_user_agent;
assert.ok(npmUserAgent, 'Run this check through npm so the npm version is auditable.');

const npmVersion = /(?:^|\s)npm\/([^\s]+)/u.exec(npmUserAgent)?.[1];
assert.equal(
  npmVersion,
  EXPECTED_NPM,
  `npm ${EXPECTED_NPM} is required; received ${npmVersion ?? 'unknown'}`,
);

console.log(`Runtime baseline verified: Node.js ${EXPECTED_NODE}, npm ${EXPECTED_NPM}`);

