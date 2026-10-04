import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p3-03-unit.test.ts'],maxWorkers:1}});
