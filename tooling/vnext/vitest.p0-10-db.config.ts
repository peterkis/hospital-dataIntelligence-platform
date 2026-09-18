import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p0-10-db.test.ts','tooling/vnext/p0-10-cleanup.test.ts'],pool:'forks',fileParallelism:false,execArgv:['--import','tsx'],testTimeout:300000,hookTimeout:30000}});
