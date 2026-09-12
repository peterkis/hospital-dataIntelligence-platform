import { existsSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import staticPlugin from '@fastify/static';
import { createTemporary,dropTemporary } from './fresh.mjs';
import { migrate,root } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { runtime } from './catalog-runtime.mjs';
import { buildCatalogServer } from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';

const owned=process.argv.includes('--fresh')?createTemporary():null;
let catalog;let app;
try{
 if(owned){await migrate(owned.receipt);await seed(owned.receipt);}
 catalog=await runtime(owned?.receiptPath);
 app=await buildCatalogServer(catalog);
 await app.register(staticPlugin,{root:resolve(root,'apps/admin-web/dist-vnext'),prefix:'/admin/vnext/'});
 app.get('/admin/vnext/catalog',(_request,reply)=>reply.sendFile('vnext.html'));
 await app.listen({host:'127.0.0.1',port:4317});
 const stopFile=resolve(root,'.runtime/vnext/stop-'+process.pid);
 writeFileSync(resolve(root,'.runtime/vnext/server.json'),JSON.stringify({pid:process.pid,url:'http://127.0.0.1:4317/admin/vnext/catalog',stopFile,receipt:owned?.receiptPath??'.runtime/vnext/creation.json'}));
 console.log(JSON.stringify({status:'VNEXT_BROWSER_READY',url:'http://127.0.0.1:4317/admin/vnext/catalog',stopFile}));
 while(!existsSync(stopFile))await delay(500);
}finally{await app?.close();await catalog?.close();if(owned)dropTemporary(owned.receipt);}
