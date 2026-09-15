import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/validation*.test.ts'],pool:'forks',fileParallelism:false,execArgv:['--import','tsx'],setupFiles:process.env['VNEXT_TEST_RECEIPT']?['tooling/vnext/connection-guard.mjs']:[],testTimeout:20000,hookTimeout:20000}});
