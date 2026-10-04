import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {validationKeys} from './p3-01-validation-keys.mjs';
import {openDepartment} from '../../apps/governance-api/src/modules/department-master/index.js';
import {departmentFixture} from './p2-01-fixture.js';
import {locationFixture} from './p3-06-fixture.js';
import {operatingScenario} from './operating-scenario.js';
// Run against the real 0151 prefix through its public Owners before migration.
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=validationKeys(receipt),catalog=await openCatalog(connection,provider),department=openDepartment(connection,provider);
const pool=new Pool({connectionString:connection,max:1}),role=(await pool.query('select current_user r')).rows[0].r;await pool.end();
let location:Awaited<ReturnType<typeof locationFixture>>|undefined,operating:Awaited<ReturnType<typeof operatingScenario>>|undefined;
try{
 const f=await departmentFixture(receipt,catalog,provider),value=await f.input(),i=await department.stage('maker',value);
 await department.verify('reviewer',{requestId:randomUUID(),inputId:i.inputId,inputDigest:i.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'TEST prefix logical Department',evidenceId:f.artifact.artifactId}]});
 const requestId=randomUUID(),c=await department.plan('maker',{inputId:i.inputId,requestId});await department.readApplyCandidate('reviewer',{candidateId:c.candidateId});await department.approveApplyUnit('reviewer',c);assert.equal((await department.applyUnit('maker',{candidateId:c.candidateId,requestId})).status,'COMMITTED');
 operating=await operatingScenario(receipt,connection,provider,catalog);const subject=await operating.createSubject(),campus=await operating.createCampus();await operating.activateCampus(campus);operating.grantPair(subject.id,campus.id);const license=await operating.addLicense(subject);await operating.verifyScope(subject,campus,license,['DEMO_MEDICAL_A']);
 location=await locationFixture(receipt,role,catalog,provider,connection);const campusId=await location.newCampus(),outcome=await location.apply(await location.input(campusId,location.tree(campusId)));assert.equal(outcome.facts.length,4);
 console.log(JSON.stringify({status:'PASS',gate:'P3_01_POPULATED_0151',publicOwners:['Department','Campus','Subject','License','VerifiedScope','Location'],locationNodes:4}));
}finally{await location?.owner.close();await location?.campus.close();await operating?.close();await department.close();await catalog.close();}
