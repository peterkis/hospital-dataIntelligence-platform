import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p1-06-review-db.test.ts'],fileParallelism:false,execArgv:['--import','tsx'],setupFiles:['tooling/vnext/review-ci.setup.ts'],testTimeout:90000,hookTimeout:120000}});
