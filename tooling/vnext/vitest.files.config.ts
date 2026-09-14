import {defineConfig} from 'vitest/config';

export default defineConfig({
  test:{
    include:['tooling/vnext/file-parser.test.ts','tooling/vnext/file-intake.test.ts'],
    pool:'forks',
    fileParallelism:false,
    execArgv:['--import','tsx'],
    setupFiles:process.env['VNEXT_TEST_RECEIPT']?['tooling/vnext/connection-guard.mjs']:[],
    testTimeout:15000,
    hookTimeout:15000,
  },
});
