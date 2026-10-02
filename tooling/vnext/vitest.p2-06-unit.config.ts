import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p2-06-unit.test.ts'],fileParallelism:false}});
