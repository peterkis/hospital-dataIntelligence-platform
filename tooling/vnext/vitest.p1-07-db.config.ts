import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({resolve:{alias:{'@hospital-data-intelligence/generated-api-client':fileURLToPath(new URL('../../packages/generated-api-client/src/index.ts',import.meta.url))}},test:{include:['tooling/vnext/p1-07-db.test.ts'],fileParallelism:false,execArgv:['--import','tsx'],setupFiles:['tooling/vnext/connection-guard.mjs'],testTimeout:30000,hookTimeout:30000}});
