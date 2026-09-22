import {test,expect} from 'vitest';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
test('ORG03 HTTP fails closed when its Owner is disconnected',async()=>{
 const app=await buildCatalogServer();try{
 const r=await app.inject({method:'POST',url:'/api/vnext/operating-relations/query',payload:{kind:'RELATION',mode:'LIST',subjectId:'00000000-0000-0000-0000-000000000001',campusId:'00000000-0000-0000-0000-000000000002'}});
 expect(r.statusCode).toBe(503);expect(r.json().code).toBe('BLOCKED_DEPENDENCY');
 }finally{await app.close();}
});
