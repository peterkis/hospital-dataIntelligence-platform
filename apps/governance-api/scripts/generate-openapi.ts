import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalize } from 'json-canonicalize';
import { buildApplication } from '../src/composition/build-application.js';
import { createDepartmentGovernanceContractDependencies } from '../src/composition/department-governance-contract-dependencies.js';

const outputDirectory = resolve(import.meta.dirname, '../../../contracts/openapi');
const outputPath = resolve(outputDirectory, 'phase-01.openapi.json');
const digestPath = resolve(outputDirectory, 'phase-01.openapi.sha256');

const application = await buildApplication({
  departmentGovernance: createDepartmentGovernanceContractDependencies(),
});
try {
  await application.ready();
  const document = application.swagger();
  const deterministicDocument = JSON.parse(canonicalize(document)) as unknown;
  const bytes = Buffer.from(`${JSON.stringify(deterministicDocument, null, 2)}\n`, 'utf8');
  const digest = createHash('sha256').update(bytes).digest('hex');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, bytes);
  await writeFile(digestPath, `${digest}  phase-01.openapi.json\n`, 'utf8');
  process.stdout.write(`Frozen OpenAPI 3.1 contract: ${outputPath}\nSHA-256: ${digest}\n`);
} finally {
  await application.close();
}
