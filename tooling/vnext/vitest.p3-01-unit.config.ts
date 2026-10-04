import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tooling/vnext/p3-01-unit.test.ts'],maxWorkers:1}});
