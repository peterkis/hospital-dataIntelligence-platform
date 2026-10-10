import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p1-04-unit.test.ts'],fileParallelism:false,testTimeout:30000,execArgv:['--import','tsx']}});
