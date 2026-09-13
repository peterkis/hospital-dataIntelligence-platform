// Test-only preload: deny legacy connections without changing server grants or
// dropping a database. A trace contains database names only, never credentials.
import pg from 'pg';
import { appendFileSync } from 'node:fs';
import { readReceipt } from './lineage.mjs';
const receipt = readReceipt(process.env.VNEXT_TEST_RECEIPT);
const runId=process.env.VNEXT_CONNECTION_RUN_ID;
if(runId&&!/^[a-f0-9-]{36}$/u.test(runId))throw new Error('CONNECTION_RUN_ID_INVALID');
const tracePath=runId?`.runtime/vnext/P0-02-connection-${runId}.jsonl`:'.runtime/vnext/P0-02-connection-trace-v2.jsonl';
const metadata={guardVersion:2,pid:process.pid,runId:runId??null,step:process.env.VNEXT_CONNECTION_STEP??null,expectedReceiptOid:receipt.oid};
function check(config,event) {
  const target = config?.connectionString ? new URL(config.connectionString).pathname.slice(1) : config?.database;
  if (target !== receipt.name) {
    appendFileSync(tracePath,JSON.stringify({...metadata,event:'BLOCKED_'+event,database:target})+'\n');
    throw new Error('NON_RECEIPT_CONNECTION_FORBIDDEN');
  }
  if(event==='CLIENT_CONNECT')appendFileSync(tracePath, JSON.stringify({...metadata,event,database:target})+'\n');
}
const Client = pg.Client;
const Pool = pg.Pool;
// Hook the original prototypes as well as CJS consumers: an ESM named import
// may retain the original constructor when the default export is reassigned.
const clientConnect=Client.prototype.connect;
Client.prototype.connect=function(...args){
  check(this.connectionParameters,'CLIENT_CONNECT');
  return Reflect.apply(clientConnect,this,args);
};
const poolConnect=Pool.prototype.connect;
Pool.prototype.connect=function(...args){
  check(this.options,'POOL_CONNECT');
  return Reflect.apply(poolConnect,this,args);
};
