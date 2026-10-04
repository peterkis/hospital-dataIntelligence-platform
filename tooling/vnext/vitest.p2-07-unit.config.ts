import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p2-07-contract.test.ts'],fileParallelism:false,testTimeout:30000}});
