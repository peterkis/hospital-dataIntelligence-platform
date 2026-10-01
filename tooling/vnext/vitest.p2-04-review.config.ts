import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p2-04-review-regression.test.ts'],fileParallelism:false,testTimeout:90000,hookTimeout:90000}});
