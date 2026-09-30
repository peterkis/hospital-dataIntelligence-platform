import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p2-02-provisioning.test.ts'],fileParallelism:false,execArgv:['--import','tsx'],testTimeout:30000,hookTimeout:30000}});
