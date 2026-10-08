import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p3-07-unit.test.ts','tooling/vnext/p3-07-json-number-unit.test.ts'],fileParallelism:false}});
