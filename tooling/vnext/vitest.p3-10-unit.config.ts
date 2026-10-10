import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p3-10-ui.test.ts','tooling/vnext/p3-10-preservation.test.ts'],fileParallelism:false}});
