process.env['PROTOTYPE_MODE'] = 'true';
process.env['PROTOTYPE_UI'] = 'true';

if (process.argv.includes('--demo')) {
  process.env['PROTOTYPE_DEMO_READY'] = 'true';
}

await import('../../apps/governance-api/src/prototype-main.js');
