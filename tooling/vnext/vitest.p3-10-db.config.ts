import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p3-10-db.test.ts'],fileParallelism:false,maxWorkers:1,testTimeout:180000,hookTimeout:180000}});
