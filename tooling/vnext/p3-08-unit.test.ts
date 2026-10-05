import {test,expect} from 'vitest';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';

test('scoped parameter HTTP reports unavailable Owner without pretending a definition is a runtime value',async()=>{
 const app=await buildCatalogServer();
 try{const address=await app.listen({host:'127.0.0.1',port:0});
  const response=await fetch(address+'/api/vnext/parameter-values/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'00000000-0000-7000-8000-000000000001'})});
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({code:'BLOCKED_DEPENDENCY'});
 }finally{await app.close();}
});

test('unit capability HTTP exposes an explicit unavailable Owner at the approved public seam',async()=>{
 const app=await buildCatalogServer();
 try{const address=await app.listen({host:'127.0.0.1',port:0});const response=await fetch(address+'/api/vnext/unit-capabilities/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'00000000-0000-7000-8000-000000000001'})});expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'BLOCKED_DEPENDENCY'});}finally{await app.close();}
});
