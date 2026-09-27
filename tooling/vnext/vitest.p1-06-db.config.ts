import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p1-06-db.test.ts'],fileParallelism:false,execArgv:['--import','tsx'],setupFiles:['tooling/vnext/connection-guard.mjs'],testTimeout:30000,hookTimeout:30000}});
