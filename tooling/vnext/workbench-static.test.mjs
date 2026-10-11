import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { registerWorkbenchStatic } from './workbench-static.mjs';

test('built vNext entry serves root, lists and record URLs without swallowing APIs or assets', async () => {
  const app=Fastify({logger:false});
  await registerWorkbenchStatic(app, resolve(process.env.HDIP_MVP_VNEXT_DIST??'apps/admin-web/dist-vnext'));
  try {
    for(const path of ['', '/', '/catalog', '/organizations', '/departments', '/imports', '/contracts',
      '/parameter-definitions', '/location-usage-types', '/care-space', '/care-space/UNIT',
      '/care-space/UNIT/00000000-0000-0000-0000-000000000001']) {
      const response=await app.inject('/admin/vnext'+path);
      assert.equal(response.statusCode,200,path);
      assert.match(response.headers['content-type'],/text\/html/);
      assert.match(response.body,/<div id="root"><\/div>/);
    }
    for(const path of ['/api/vnext/not-an-operation','/admin/vnext/assets/not-an-asset.js','/admin/vnext/api/not-an-operation']) {
      const response=await app.inject(path);
      assert.equal(response.statusCode,404,path);
      assert.doesNotMatch(response.body,/<div id="root">/);
    }
  } finally { await app.close(); }
});
