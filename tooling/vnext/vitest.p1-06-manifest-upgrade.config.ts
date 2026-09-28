import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({resolve:{alias:{'@hospital-data-intelligence/generated-api-client':fileURLToPath(new URL('../../packages/generated-api-client/src/index.ts',import.meta.url))}},test:{include:['tooling/vnext/p1-06-manifest-reference-db.test.ts'],fileParallelism:false,execArgv:['--import','tsx'],setupFiles:['tooling/vnext/review-ci-manifest.setup.ts'],sequence:{hooks:'stack'},testTimeout:90000,hookTimeout:120000}});
