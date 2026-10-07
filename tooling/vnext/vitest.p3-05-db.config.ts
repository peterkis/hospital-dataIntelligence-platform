import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p3-05-db.test.ts','tooling/vnext/p3-05-extended-db.test.ts','tooling/vnext/p3-05-handover-db.test.ts'],fileParallelism:false,testTimeout:120000,hookTimeout:120000}});
