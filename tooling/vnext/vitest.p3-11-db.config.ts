import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p3-11-db.test.ts','tooling/vnext/p3-11-move-db.test.ts','tooling/vnext/p3-11-entitlement-db.test.ts'],fileParallelism:false,testTimeout:120000,hookTimeout:120000}});
