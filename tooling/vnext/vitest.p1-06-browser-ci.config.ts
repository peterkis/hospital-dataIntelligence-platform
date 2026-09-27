import {defineConfig} from 'vitest/config';
import base from './vitest.p1-06-review-ci.config.js';

// Requires a built admin web bundle and a headless Chromium executable. The
// imported setup permits only disposable GitHub CI PostgreSQL databases.
export default defineConfig({...base,test:{...base.test,include:['tooling/vnext/p1-06-submit-browser.test.ts'],testTimeout:90000}});
