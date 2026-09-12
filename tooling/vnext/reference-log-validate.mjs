import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { root } from './lineage.mjs';
const run=spawnSync(process.execPath,['--import','tsx','tooling/vnext/adversarial.mjs'],{cwd:root,env:process.env,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
assert.equal(run.status,0,run.stderr);
const records=run.stdout.split(/\r?\n/u).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).filter(row=>row.event==='VNEXT_REFERENCE_READ');
assert.deepEqual(records.map(row=>row.status).sort(),[200,400,403]);
assert.equal(new Set(records.map(row=>row.requestId)).size,3);
for(const record of records){
 assert.deepEqual(Object.keys(record).sort(),['completedAt','elapsedMs','event','requestId','route','status']);
 assert.match(record.requestId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[a-f0-9]{4}-[a-f0-9]{12}$/u);
 assert.equal(record.route,'/api/vnext/catalog');assert.ok(record.elapsedMs>=0);assert.match(record.completedAt,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/u);
}
assert.ok(!(run.stdout+run.stderr).includes('SYNTHETIC_READ_CANARY'));
assert.ok(!(run.stdout+run.stderr).includes('SYNTHETIC_PRIVACY_CANARY'));
const directory=resolve(root,'.runtime/vnext/reference-logs');mkdirSync(directory,{recursive:true});const evidence=resolve(directory,randomUUID()+'.jsonl');
writeFileSync(evidence,records.map(row=>JSON.stringify(row)).join('\n')+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'PASS',records:3,successfulDeniedInvalidEachOnce:true,rawCanariesAbsent:true,evidence}));
