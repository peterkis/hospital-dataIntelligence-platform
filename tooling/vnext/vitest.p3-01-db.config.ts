import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p3-01-db.test.ts'],fileParallelism:false,testTimeout:60000,hookTimeout:60000}});
