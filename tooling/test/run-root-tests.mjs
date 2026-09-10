import { spawnSync } from 'node:child_process';

const forwarded = process.argv.slice(2);
const npmCli = process.env['npm_execpath'];
if (!npmCli) throw new Error('NPM_EXEC_PATH_UNAVAILABLE');

const args = forwarded.length === 1 && forwarded[0] === 'department-master'
  ? [npmCli, 'run', 'test', '--workspace', '@hospital-data-intelligence/governance-api', '--', 'department-master']
  : [npmCli, 'run', 'test', '--workspaces', '--if-present', ...forwarded];

const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
