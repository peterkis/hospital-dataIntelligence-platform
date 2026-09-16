import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/apply*.test.ts'],pool:'forks',fileParallelism:false,execArgv:['--import','tsx'],setupFiles:['tooling/vnext/connection-guard.mjs'],testTimeout:30000,hookTimeout:30000}});
