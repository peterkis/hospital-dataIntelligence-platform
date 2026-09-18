import {openCatalog, LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
import {readReceipt, inspect} from './lineage.mjs';

let catalog, app, closing=false;
async function close() {
  if(closing)return;
  closing=true;
  try {await app?.close();await catalog?.close();}
  finally {if(process.connected)process.disconnect();}
}
process.on('message', message=>{if(message==='STOP')void close();});
process.on('disconnect',()=>{void close();});
try {
  const receipt=readReceipt(process.env.VNEXT_P0_10_RECEIPT);
  if(receipt.purpose!=='TEMPORARY_VALIDATION')throw new Error('TEMPORARY_ONLY');
  await inspect(receipt);
  const connection=process.env.VNEXT_P0_10_OWNER;
  if(!connection || new URL(connection).pathname!=='/'+receipt.name)throw new Error('OWNER_TARGET_MISMATCH');
  catalog=await openCatalog(connection,new LocalSyntheticKeyProvider());
  app=await buildCatalogServer(catalog);
  await app.listen({host:'127.0.0.1',port:0});
  process.send?.({event:'READY',url:'http://127.0.0.1:'+app.server.address().port,pid:process.pid});
} catch {process.send?.({event:'FAILED',code:'RECOVERY_SERVICE_FAILED'});process.exitCode=1;await close();}
