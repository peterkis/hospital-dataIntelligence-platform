import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p1-03-unit.test.ts'],fileParallelism:false,execArgv:['--import','tsx']}});
