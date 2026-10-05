import {readFileSync,writeFileSync} from 'node:fs';
import {Pool} from 'pg';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {validationKeys} from './p3-08-validation-keys.mjs';
import {wardFixture} from './p3-02-fixture.js';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receiptPath=process.env['VNEXT_TEST_RECEIPT']!,receipt=JSON.parse(readFileSync(receiptPath,'utf8')),provider=validationKeys(receipt),catalog=await openCatalog(connection,provider),pool=new Pool({connectionString:connection,max:1});
let fixture:Awaited<ReturnType<typeof wardFixture>>|undefined;
try{
 const role=(await pool.query('select current_user r')).rows[0].r;fixture=await wardFixture(receipt,role,catalog,provider,connection);
 const binding=await fixture.endpoint(),outcome=await fixture.apply(await fixture.input([fixture.entry(binding)])),history=await fixture.owner.history('maker',{id:outcome.facts[0]!.id}),unit=await fixture.base.owner.history('maker',{id:binding.unit.id}),department=await fixture.base.department.history('maker',unit.departmentId);
 const references=(await pool.query('select care_organization.ward_department_references($1,$2::jsonb,$3) r',['maker',JSON.stringify([unit.departmentId]),'NORTH'])).rows[0].r,reference=references.find((r:{id:string})=>r.id===history.id);
 writeFileSync(receiptPath+'.p3-08-predecessor.json',JSON.stringify({id:history.id,departmentId:unit.departmentId,dependencies:history.bindings[0]!.versions[0]!.dependencies,originalDigest:reference.originalDigest,expectedParts:[{versionId:department.versions[0]!.id,version:'1',from:'2026-01-01T00:00:00.000000',to:null}]},null,2));
 console.log(JSON.stringify({gate:'P3_08_POPULATED_0170_WARD',status:'PASS',wardId:history.id,realOwners:true}));
}finally{await fixture?.close();await pool.end();await catalog.close();}
