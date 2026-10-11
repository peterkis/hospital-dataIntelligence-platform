import staticPlugin from '@fastify/static';

/** Serve only known UI paths; API and missing asset responses keep their semantics. */
export async function registerWorkbenchStatic(app, root) {
  await app.register(staticPlugin, { root, prefix: '/admin/vnext/' });
  for (const path of ['', 'catalog', 'contracts', 'parameter-definitions', 'imports',
    'organizations', 'departments', 'location-usage-types', 'care-space',
    'care-space/:kind', 'care-space/:kind/:recordId']) {
    app.get('/admin/vnext/' + path, (_request, reply) => reply.sendFile('vnext.html'));
  }
  app.get('/admin/vnext', (_request, reply) => reply.sendFile('vnext.html'));
}
