import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {validationKeys} from './p3-02-validation-keys.mjs';
import {nursingFixture} from './p3-03-fixture.js';
import {randomUUID} from 'node:crypto';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),provider=validationKeys(receipt),catalog=await openCatalog(connection,provider);
const pool=new Pool({connectionString:connection,max:1});let fixture;
try{const role=(await pool.query('select current_user r')).rows[0].r;fixture=await nursingFixture(receipt,role,catalog,provider,connection);const department=await fixture.base.newDepartment(),binding=await fixture.base.endpoint(department),unit=await fixture.base.apply(await fixture.base.input([fixture.base.entry(binding)])),nursing=await fixture.apply(await fixture.input([fixture.entry(await fixture.endpoint(department))]));
 console.log(JSON.stringify({gate:'P3_02_POPULATED_0165',status:'PASS',unitId:unit.facts[0]!.id,nursingId:nursing.facts[0]!.id,realOwners:true}));}finally{await fixture?.close();await pool.end();await catalog.close();}
