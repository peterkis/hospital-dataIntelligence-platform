import {defineConfig} from 'vitest/config';
import {resolve} from 'node:path';
if(!process.env.HDIP_MVP_RUN_ROOT?.startsWith('D:'))throw new Error('D-drive task environment required');
export default defineConfig({cacheDir:resolve(process.env.HDIP_MVP_RUN_ROOT,'artifacts','vitest-cache'),test:{include:['tooling/vnext/m1-unit-maintenance.test.ts','tooling/vnext/p3-10-ui.test.ts'],fileParallelism:false}});
