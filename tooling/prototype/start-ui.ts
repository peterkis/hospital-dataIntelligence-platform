process.env['PROTOTYPE_MODE'] = 'true';
process.env['PROTOTYPE_UI'] = 'true';

if (process.argv.includes('--demo')) {
  process.stdout.write('Prototype UI: http://127.0.0.1:3000/admin/\n');
  process.stdout.write('Press Ctrl+C to stop the API and close the database pool.\n');
}

await import('../../apps/governance-api/src/prototype-main.js');
