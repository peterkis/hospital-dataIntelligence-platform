import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolveAdminMode, type AdminMode } from './src/admin-mode.js';

export function adminBuildOutput(mode: AdminMode): 'dist' | 'dist-prototype' {
  return mode === 'prototype' ? 'dist-prototype' : 'dist';
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'VITE_');
  const adminMode = resolveAdminMode(
    process.env['VITE_ADMIN_MODE'] ?? environment['VITE_ADMIN_MODE'],
  );
  return {
    base: '/admin/',
    plugins: [adminBootstrapPlugin(adminMode), react()],
    build: {
      outDir: adminBuildOutput(adminMode),
      emptyOutDir: true,
      sourcemap: true,
    },
  };
});

function adminBootstrapPlugin(mode: AdminMode): Plugin {
  const virtualId = 'virtual:admin-bootstrap';
  const resolvedId = `\0${virtualId}`;
  const implementation = mode === 'prototype'
    ? '/src/bootstrap-prototype.tsx'
    : '/src/bootstrap-formal.tsx';
  const exportName = mode === 'prototype' ? 'bootstrapPrototype' : 'bootstrapFormal';
  return {
    name: 'hdi-admin-bootstrap',
    resolveId(id) {
      return id === virtualId ? resolvedId : undefined;
    },
    load(id) {
      return id === resolvedId
        ? `export { ${exportName} as bootstrapAdmin } from ${JSON.stringify(implementation)};`
        : undefined;
    },
  };
}
