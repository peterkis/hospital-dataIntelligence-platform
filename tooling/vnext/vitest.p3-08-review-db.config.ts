import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p3-08-review-db.test.ts'],fileParallelism:false,maxWorkers:1,testTimeout:120000,hookTimeout:120000}});
