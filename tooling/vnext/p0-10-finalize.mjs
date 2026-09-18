import {resolve,relative,isAbsolute} from 'node:path';
import {root} from './lineage.mjs';
import {workingTreeDigest} from './p0-10-gate.mjs';
import {finalizeP0Evidence} from './p0-10-evidence.ts';
import {evidenceRunDirectory} from './p0-10-run-directory.mjs';

const directory=resolve(process.argv[2] ?? '');
const rel=relative(resolve(root,'.runtime/vnext/p0-10'),directory);
if(!rel||rel.startsWith('..')||isAbsolute(rel)||rel.includes('/')||rel.includes('\\'))throw new Error('P0_10_RUN_DIRECTORY_REQUIRED');
evidenceRunDirectory(directory);
const result=finalizeP0Evidence(directory,workingTreeDigest());
console.log(JSON.stringify({gate:'P0-10',...result}));
if(result.status!=='PASS')process.exitCode=2;
