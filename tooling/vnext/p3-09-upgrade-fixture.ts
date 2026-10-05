import {readFileSync,writeFileSync} from 'node:fs';
import {Pool} from 'pg';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {validationKeys} from './p3-09-validation-keys.mjs';
import {capabilityFixture} from './p3-08-fixture.js';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receiptPath=process.env['VNEXT_TEST_RECEIPT']!,receipt=JSON.parse(readFileSync(receiptPath,'utf8')),provider=validationKeys(receipt),catalog=await openCatalog(connection,provider),pool=new Pool({connectionString:connection,max:1});
let fixture:Awaited<ReturnType<typeof capabilityFixture>>|undefined;
try{
 const role=(await pool.query('select current_user r')).rows[0].r;fixture=await capabilityFixture(receipt,role,catalog,provider,connection);
 const scope=await fixture.endpoint(),out=await fixture.apply(await fixture.input([fixture.entry(scope)])),history=await fixture.owner.history('maker',{id:out.facts[0]!.id});
 writeFileSync(receiptPath+'.p3-09-predecessor.json',JSON.stringify(history,null,2));
 console.log(JSON.stringify({gate:'P3_09_POPULATED_0175',status:'PASS',capabilityId:history.id,realOwners:true}));
}finally{await fixture?.close();await pool.end();await catalog.close();}
