import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p3-11-unit.test.ts'],fileParallelism:false}});
