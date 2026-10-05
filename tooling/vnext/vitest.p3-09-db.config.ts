import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p3-09-db.test.ts'],fileParallelism:false,testTimeout:120000,hookTimeout:120000}});
