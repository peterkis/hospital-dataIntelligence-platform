import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p1-06-unit.test.ts','tooling/vnext/p1-06-license-actions.test.ts','tooling/vnext/p1-06-license-dependencies.test.ts'],fileParallelism:false,execArgv:['--import','tsx']}});
