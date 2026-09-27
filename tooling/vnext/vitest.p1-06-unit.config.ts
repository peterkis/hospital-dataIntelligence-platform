import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({resolve:{alias:{'@hospital-data-intelligence/generated-api-client':fileURLToPath(new URL('../../packages/generated-api-client/src/index.ts',import.meta.url))}},test:{include:['tooling/vnext/p1-06-unit.test.ts','tooling/vnext/p1-06-license-actions.test.ts','tooling/vnext/p1-06-license-dependencies.test.ts','tooling/vnext/p1-06-bundle-editor.test.ts','tooling/vnext/p1-06-endpoints-http.test.ts'],fileParallelism:false,execArgv:['--import','tsx']}});
