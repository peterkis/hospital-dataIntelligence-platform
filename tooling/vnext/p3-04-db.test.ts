import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {randomUUID,createHmac} from 'node:crypto';
import {beforeAll,afterAll,test,expect} from 'vitest';
import {openCatalog,canonicalPlan,planBinding,type Catalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {unitWardFixture} from './p3-04-fixture.js';
import {validationKeys} from './p3-04-validation-keys.mjs';
import {peer,quote} from './lineage.mjs';
import {ORG10_FIELDS,openUnitCapabilities} from '../../apps/governance-api/src/modules/care-organization/index.js';
import {openParameterValues} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {unitCapabilityUpstreamPorts} from '../../apps/governance-api/src/composition/unit-capability-dependencies.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {createUnitWardClient} from '../../packages/generated-api-client/src/index.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Catalog,f:Awaited<ReturnType<typeof unitWardFixture>>;
beforeAll(async()=>{const provider=validationKeys(receipt),pool=new Pool({connectionString:connection,max:1});try{catalog=await openCatalog(connection,provider);const role=(await pool.query('select current_user r')).rows[0].r;f=await unitWardFixture(receipt,role,catalog,provider,connection,process.env['VNEXT_P3_04_UPGRADED']==='1');}finally{await pool.end();}});
afterAll(async()=>{await f?.close();await catalog?.close();});
test('review repair: protected staging retains participant order and exact request replay',async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),rule=f.shared([a.unit.id,b.unit.id]);if(rule.kind!=='SHARED_BOUNDARY')throw new Error('TEST_RULE_REQUIRED');rule.participants.reverse();const e=f.entry(a),v=await f.input([{...e,rule,row:{...e.row,relation_type:'共享',sharing_rule:'TEST source participant order'}}]),staged=await f.owner.stage('maker',v);
 expect((await f.owner.readInput('maker',{inputId:staged.inputId})).entries[0]!.rule).toEqual(rule);expect(await f.owner.stage('maker',v)).toEqual(staged);
 await expect(f.owner.stage('maker',{...v,entries:v.entries.map(entry=>({...entry,rule:{...rule,participants:[...rule.participants].reverse()}}))})).rejects.toThrow('REQUEST_CONFLICT');
});
test('review repair: independent verification retains its participant-order evidence',async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),rule=f.shared([a.unit.id,b.unit.id]),e=f.entry(a),v=await f.input([{...e,rule,row:{...e.row,relation_type:'共享',sharing_rule:'TEST reviewer participant order'}}]),staged=await f.owner.stage('maker',v),verification=f.verification(v,staged);
 for(const row of verification.rows)if(row.rule.kind==='SHARED_BOUNDARY')row.rule={...row.rule,participants:[...row.rule.participants].reverse()};const checked=await f.owner.verify('reviewer',verification);expect(await f.owner.verify('reviewer',verification)).toEqual(checked);
 await expect(f.owner.verify('reviewer',{...verification,rows:verification.rows.map(row=>({...row,rule}))})).rejects.toThrow('REQUEST_CONFLICT');
 expect((await f.owner.preview('maker',{inputId:staged.inputId})).decision).toBe('PASS');
});
test('review repair: empty sharing-rule source text remains distinct from native null through publication and END',async()=>{
 const a=await f.endpoint(),e=f.entry(a),entry={...e,row:{...e.row,sharing_rule:''}},out=await f.apply(await f.input([entry])),id=out.facts[0]!.id,original=await f.owner.exact('maker',{id,version:'1'});
 expect(original.facts.sharingRule).toBe('');await f.apply(await f.input([{...entry,action:'END',target:{owner:'care-organization/unit-ward-relation',id,expectedHead:'1'},endAt:'2026-03-01T00:00:00',row:{...entry.row,record_status:'RETIRED'}}]));expect((await f.owner.history('maker',{id})).versions.at(-1)!.facts.sharingRule).toBe('');expect(await f.owner.exact('maker',{id,version:'1'})).toEqual(original);
 const b=await f.endpoint(),nativeEntry=f.entry(b),native=await f.apply(await f.input([nativeEntry])),nativeId=native.facts[0]!.id;expect((await f.owner.exact('maker',{id:nativeId,version:'1'})).facts.sharingRule).toBeNull();
 await expect(f.prepare(await f.input([{...nativeEntry,action:'END',target:{owner:'care-organization/unit-ward-relation',id:nativeId,expectedHead:'1'},endAt:nativeEntry.row.valid_from,row:{...nativeEntry.row,sharing_rule:'',record_status:'RETIRED'}}]))).rejects.toThrow('UNIT_WARD_CONTENT_CHANGED');expect((await f.owner.history('maker',{id:nativeId})).versions).toHaveLength(1);
});
test.each(['participants','window'] as const)('review repair: differing shared %s block Owner and independently signed restricted SQL admission',async difference=>{
 const a=await f.endpoint(),b=await f.sameWard(a),extra=await f.sameWard(a),ea=f.entry(a),eb=f.entry(b),first=f.shared([a.unit.id,b.unit.id]);
 if(first.kind!=='SHARED_BOUNDARY')throw new Error('TEST_RULE_REQUIRED');
 const second={...first,...(difference==='participants'?{participants:[...first.participants,extra.unit.id].sort()}:{validTo:'2026-04-01T00:00:00'})};
 const entry=(e:typeof ea,rule:typeof first)=>({...e,rule,row:{...e.row,valid_to:'2026-03-01T00:00:00',relation_type:'共享' as const,sharing_rule:'TEST complete governed boundary'}});
 const q1=await f.prepare(await f.input([entry(ea,first)])),q2=await f.prepare(await f.input([entry(eb,second)])),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:q2.candidateId});
 await f.owner.applyUnit('maker',q1);
 await expect(f.owner.applyUnit('maker',q2)).rejects.toThrow('STALE_VALIDATION');
 const value=candidate.unit.commands[0]!.value,pool=new Pool({connectionString:connection,max:1}),client=await pool.connect(),key=Buffer.from(planBinding(validationKeys(receipt),'UNIT_WARD_SQL_AUTHORITY_V1',{}),'hex');
 try{await client.query('BEGIN');const transaction=(await client.query('select pg_current_xact_id()::text v')).rows[0].v,point=(await client.query('select care_organization.unit_ward_record_time() r')).rows[0].r,ticket=canonicalPlan({operation:'APPLY',actor:'maker',transaction,inputId:value['inputId'],writes:JSON.parse(value['writes']!),writeIndex:1,writesDigest:value['writesDigest'],candidateId:q2.candidateId,digest:candidate.digest,...point});await expect(client.query('select care_organization.unit_ward_mutate($1,$2)',[ticket,createHmac('sha256',key).update(ticket).digest('hex')])).rejects.toMatchObject({message:'SHARING_POLICY_CONFLICT'});}finally{await client.query('ROLLBACK');client.release();await pool.end();key.fill(0);}
 expect(await f.owner.resumeOutcome('maker',q2)).toBeNull();expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(1);
 const combined=await f.input([entry(eb,second),{...entry(ea,first),action:'REVISE',target:{owner:'care-organization/unit-ward-relation',id:(await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items[0]!.id,expectedHead:'1'}}]);
 await expect(f.prepare(combined)).rejects.toThrow('SHARING_POLICY_CONFLICT');
});
test('review repair: equivalent participant order and local time precision preserve shared admission',async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),rule=f.shared([a.unit.id,b.unit.id]);if(rule.kind!=='SHARED_BOUNDARY')throw new Error('TEST_RULE_REQUIRED');
 const other={...rule,participants:[...rule.participants].reverse(),validFrom:rule.validFrom+'.000000'},entries=[f.entry(a),f.entry(b)].map((e,i)=>({...e,rule:i?other:rule,row:{...e.row,relation_type:'共享' as const,sharing_rule:'TEST equivalent boundary'}}));
 expect((await f.apply(await f.input(entries))).facts).toHaveLength(2);
});
test('review repair: generated HTTP accepts independently reviewed equivalent rule timestamp precision',async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),rule=f.shared([a.unit.id,b.unit.id]);if(rule.kind!=='SHARED_BOUNDARY')throw new Error('TEST_RULE_REQUIRED');rule.validTo='2026-04-01T00:00:00';
 const entries=[f.entry(a),f.entry(b)].map(e=>({...e,rule,row:{...e.row,valid_to:'2026-03-01T00:00:00',relation_type:'共享' as const,sharing_rule:'TEST independently reviewed precise boundary'}})),v=await f.input(entries);
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner:f.owner,actor:r=>actor(r.headers)}),url=await app.listen({host:'127.0.0.1',port:0});
 try{const maker=createUnitWardClient(url,'maker'),reviewer=createUnitWardClient(url,'reviewer'),staged=await maker.stage({...v,entries:v.entries.map(e=>({...e,row:{...e.row,version_no:Number(e.row.version_no)}}))});expect(staged.response.status).toBe(200);const verification=f.verification(v,staged.data!);for(const row of verification.rows)if(row.rule.kind==='SHARED_BOUNDARY')row.rule={...row.rule,participants:[...row.rule.participants].reverse(),validFrom:row.rule.validFrom+'.000000',validTo:row.rule.validTo!+'.0'};
  expect((await reviewer.verify(verification)).response.status).toBe(200);const requestId=randomUUID(),planned=await maker.plan({inputId:staged.data!.inputId,requestId});expect(planned.response.status,JSON.stringify(planned.error)).toBe(200);expect((await reviewer.review({candidateId:planned.data!.candidateId})).response.status).toBe(200);expect((await reviewer.approve(planned.data!)).response.status).toBe(200);const out=await maker.apply({candidateId:planned.data!.candidateId,requestId});expect(out.response.status).toBe(200);expect(out.data).toMatchObject({status:'COMMITTED',facts:expect.any(Array)});expect((await maker.readInput({inputId:staged.data!.inputId})).data!.entries[0]!.row.valid_from).toBe(entries[0]!.row.valid_from);
 }finally{await app.close();}
});
test.each([['primary',409,'UNIT_WARD_PRIMARY_CONFLICT'],['duplicate',409,'UNIT_WARD_DUPLICATE_RELATION'],['review',503,'SHARING_REVIEW_REQUIRED']] as const)('review repair: generated real HTTP plan preserves %s status and finite code',async(kind,status,code)=>{
 const a=await f.endpoint(),b=kind==='duplicate'?a:await f.sameWard(a),rule=f.shared([a.unit.id,b.unit.id]),entries=[f.entry(a),f.entry(b)].map(e=>({...e,rule:kind==='primary'?rule:e.rule,row:{...e.row,is_primary:kind==='primary'?'Y' as const:'N' as const,sharing_rule:kind==='primary'?'TEST sharing primary':null}})),v=await f.input(entries);
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner:f.owner,actor:r=>actor(r.headers)}),url=await app.listen({host:'127.0.0.1',port:0});
 try{const maker=createUnitWardClient(url,'maker'),reviewer=createUnitWardClient(url,'reviewer'),staged=await maker.stage({...v,entries:v.entries.map(e=>({...e,row:{...e.row,version_no:Number(e.row.version_no)}}))});expect(staged.response.status).toBe(200);expect((await reviewer.verify(f.verification(v,staged.data!))).response.status).toBe(200);const planned=await maker.plan({inputId:staged.data!.inputId,requestId:randomUUID()});expect(planned.response.status).toBe(status);expect(planned.error).toEqual(expect.objectContaining({code}));expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(0);}finally{await app.close();}
});
test('a reviewed admission relation is published through the real Owner and keeps its source identity separate',async()=>{
 const s=await f.endpoint(),entry=f.entry(s),out=await f.apply(await f.input([entry])),id=out.facts[0]!.id;
 expect(id).not.toBe(entry.row.unit_ward_rel_id);expect((await f.owner.read('maker',{id,businessAt:'2026-02-01T00:00:00'})).state).toBe('ACTIVE');expect((await f.owner.history('maker',{id})).versions[0]!.facts.source.sourceVersion).toBe('9');
});
test('P3-04-AC-01 two reviewed Units may share a Ward and management has an independent primary bucket',async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),rule=f.shared([a.unit.id,b.unit.id]),ea=f.entry(a),eb=f.entry(b),management=f.entry({...a,purpose:'MANAGEMENT'});
 const out=await f.apply(await f.input([{...ea,rule,row:{...ea.row,relation_type:'共享',is_primary:'Y',sharing_rule:'TEST explicit shared boundary'}},{...eb,rule,row:{...eb.row,relation_type:'共享',sharing_rule:'TEST explicit shared boundary'}},{...management,row:{...management.row,is_primary:'Y'}}]));
 expect(out.facts).toHaveLength(3);expect((await f.owner.evaluateWindow('maker',{applicability:a,validFrom:'2026-02-01T00:00:00',validTo:'2026-03-01T00:00:00',mode:'CURRENT_ADMISSION'})).status).toBe('SATISFIED');
});
test('P3-04-AC-02 two overlapping primary declarations are rejected in both purpose buckets',async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),rule=f.shared([a.unit.id,b.unit.id]);
 for(const purpose of ['ADMISSION','MANAGEMENT'] as const){const ea=f.entry({...a,purpose}),eb=f.entry(purpose==='MANAGEMENT'?{...a,purpose}:{...b,purpose}),v=await f.input([ea,eb].map(e=>({...e,rule:purpose==='ADMISSION'?rule:e.rule,row:{...e.row,is_primary:'Y',sharing_rule:purpose==='ADMISSION'?'TEST shared primary':null}}))),i=await f.owner.stage('maker',v);await f.owner.verify('reviewer',f.verification(v,i));expect((await f.owner.preview('maker',{inputId:i.inputId})).issues).toContainEqual(expect.objectContaining({code:'UNIT_WARD_PRIMARY_CONFLICT'}));await expect(f.owner.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow();}
 expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(0);
});
test('P3-04-AC-03 unknown sharing remains a protected review input and cannot publish',async()=>{
 const s=await f.endpoint(),e=f.entry(s),v=await f.input([{...e,rule:{kind:'UNKNOWN'},row:{...e.row,sharing_rule:'UNKNOWN TEST boundary'}}]),i=await f.owner.stage('maker',v);await f.owner.verify('reviewer',f.verification(v,i));
 expect((await f.owner.readInput('maker',{inputId:i.inputId})).entries[0]!.row.sharing_rule).toBe('UNKNOWN TEST boundary');expect((await f.owner.preview('maker',{inputId:i.inputId})).issues).toContainEqual(expect.objectContaining({code:'LEGAL_REVIEW_REQUIRED',status:'BLOCKED'}));await expect(f.owner.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('LEGAL_REVIEW_REQUIRED');
});
test('adding a sharing participant requires same-revision repair of the prior no-sharing declaration',async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),old=f.entry(a),out=await f.apply(await f.input([old])),id=out.facts[0]!.id,rule=f.shared([a.unit.id,b.unit.id]),next=f.entry(b),addition={...next,rule,row:{...next.row,relation_type:'共享' as const,sharing_rule:'TEST shared boundary'}};
 await expect(f.prepare(await f.input([addition]))).rejects.toThrow('SHARING');
 const corrected={...old,action:'REVISE' as const,target:{owner:'care-organization/unit-ward-relation' as const,id,expectedHead:'1'},rule,row:{...old.row,relation_type:'共享' as const,sharing_rule:'TEST shared boundary'}};
 const result=await f.apply(await f.input([addition,corrected]));expect(result.facts).toHaveLength(2);expect((await f.owner.history('maker',{id})).versions).toHaveLength(2);
});
test('P3-04-AC-04 a fault after the second formal write rolls back the entire approved revision',async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),rule=f.shared([a.unit.id,b.unit.id]),entries=[f.entry(a),f.entry(b)].map(e=>({...e,rule,row:{...e.row,relation_type:'共享' as const,sharing_rule:'TEST explicit scope'}})),v=await f.input(entries),q=await f.prepare(v);
 peer(receipt.name,`CREATE FUNCTION vnext_control.test_unit_ward_failure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN IF NEW.action LIKE 'UNIT_WARD_%' AND (SELECT count(*) FROM care_organization.unit_ward_version v JOIN care_organization.unit_ward u ON u.id=v.unit_ward_id WHERE u.ward_id=${quote(a.ward.id)}::uuid)>=2 THEN RAISE EXCEPTION 'TEST_LATE_WRITE_FAILURE';END IF;RETURN NEW;END $$;CREATE TRIGGER test_unit_ward_failure BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION vnext_control.test_unit_ward_failure();`);
 try{await expect(f.owner.applyUnit('maker',q)).rejects.toThrow('APPLY_FAILED');expect(await f.owner.resumeOutcome('maker',q)).toBeNull();expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(0);}finally{peer(receipt.name,'DROP TRIGGER test_unit_ward_failure ON vnext_control.audit;DROP FUNCTION vnext_control.test_unit_ward_failure();');}
 expect((await f.owner.applyUnit('maker',q)).status).toBe('COMMITTED');
});
test('half-open adjacent primary intervals pass while one microsecond of overlap blocks the whole revision',async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),ea=f.entry(a),eb=f.entry(b),boundary='2026-03-01T00:00:00.000001',first={...ea,row:{...ea.row,is_primary:'Y' as const,valid_to:boundary}},second={...eb,row:{...eb.row,is_primary:'Y' as const,valid_from:boundary}};
 const out=await f.apply(await f.input([first,second]));expect(out.facts).toHaveLength(2);
 await expect(f.prepare(await f.input([{...first,action:'REVISE',target:{owner:'care-organization/unit-ward-relation',id:out.facts[0]!.id,expectedHead:'1'},row:{...first.row,valid_to:'2026-03-01T00:00:00.000002'}}]))).rejects.toThrow('UNIT_WARD_PRIMARY_CONFLICT');
});
test('finite newest declarations never fall back to the older open period and an END boundary cannot expand',async()=>{
 const s=await f.endpoint(),e=f.entry(s),out=await f.apply(await f.input([e])),id=out.facts[0]!.id,old=await f.owner.exact('maker',{id,version:'1'}),revised={...e,action:'REVISE' as const,target:{owner:'care-organization/unit-ward-relation' as const,id,expectedHead:'1'},row:{...e.row,valid_to:'2026-03-01T00:00:00'}};
 await f.apply(await f.input([revised]));expect((await f.owner.read('maker',{id,businessAt:'2026-04-01T00:00:00'})).state).toBe('NOT_EFFECTIVE');expect((await f.owner.read('maker',{id,businessAt:'2026-04-01T00:00:00',recordAsOf:old.recordedAt})).state).toBe('ACTIVE');
 await expect(f.prepare(await f.input([{...revised,action:'END',target:{...revised.target,expectedHead:'2'},endAt:'2026-03-01T00:00:00.000001',row:{...revised.row,record_status:'RETIRED'}}]))).rejects.toThrow('UNIT_WARD_LIFECYCLE_INVALID');
 await f.apply(await f.input([{...revised,action:'END',target:{...revised.target,expectedHead:'2'},endAt:'2026-03-01T00:00:00',row:{...revised.row,record_status:'RETIRED'}}]));
 await expect(f.prepare(await f.input([{...revised,target:{...revised.target,expectedHead:'3'}}]))).rejects.toThrow('UNIT_WARD_ENDED');
});
test('ACK failure restores the exact committed result and replays no additional relationship',async()=>{
 const s=await f.endpoint(),q=await f.prepare(await f.input([f.entry(s)])),first=await f.owner.applyUnit('maker',q,()=>{throw new Error('TEST_ACK_LOSS');});expect(first.status).toBe('COMMITTED');if(first.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');expect(first.responseStatus).toBe('POST_COMMIT_FAILED');
 const recovered=await f.owner.resumeOutcome('maker',q);expect(recovered).toMatchObject({status:'COMMITTED',facts:first.facts,recordedAt:first.recordedAt});expect((await f.owner.applyUnit('maker',q))).toMatchObject({facts:first.facts,recordedAt:first.recordedAt});expect((await f.owner.reconcileCommittedUnit('maker',q)).status).toBe('MATCHED');expect((await f.owner.list('maker',{campus:'NORTH',wardId:s.ward.id})).items).toHaveLength(1);
});
test('independent verification rejects same-human aliases, missing rows and revoked current access',async()=>{
 const s=await f.endpoint(),v=await f.input([f.entry(s)]),i=await f.owner.stage('maker',v);await expect(f.owner.verify('maker-alias',f.verification(v,i))).rejects.toThrow('ACCESS_DENIED');await expect(f.owner.readInput('outsider',{inputId:i.inputId})).rejects.toThrow('ACCESS_DENIED');
 peer(receipt.name,`INSERT INTO care_organization.unit_ward_access SELECT 'maker-alias',${quote(s.campus.id)}::uuid,'NORTH',p FROM unnest(ARRAY['VERIFY','REVIEW']) p;`);
 try{await expect(f.owner.verify('maker-alias',f.verification(v,i))).rejects.toThrow('MAKER_CHECKER_REQUIRED');await f.owner.verify('reviewer',f.verification(v,i));const candidate=await f.owner.plan('maker',{inputId:i.inputId,requestId:randomUUID()});await expect(f.owner.approveApplyUnit('maker-alias',candidate)).rejects.toThrow('MAKER_CHECKER_REQUIRED');}finally{peer(receipt.name,`DELETE FROM care_organization.unit_ward_access WHERE actor='maker-alias' AND campus_id=${quote(s.campus.id)}::uuid AND permission IN ('VERIFY','REVIEW');`);}
 const extra=f.verification(v,i);extra.rows.push({...extra.rows[0]!,row:2});await expect(f.owner.verify('reviewer',extra)).rejects.toThrow('VERIFICATION_ROW_MISMATCH');
 await f.owner.verify('reviewer',f.verification(v,i));const q=await f.prepare(await f.input([f.entry(s)]));peer(receipt.name,`DELETE FROM care_organization.unit_ward_access WHERE actor='maker' AND campus_id=${quote(s.campus.id)}::uuid AND permission='WRITE';`);
 try{await expect(f.owner.applyUnit('maker',q)).rejects.toThrow('ACCESS_DENIED');}finally{f.grant(s);}
});
test.each(['CSV','JSON','XLSX'] as const)('%s preserves all14 fields and uses the same protected review and Apply path',async format=>{
 const s=await f.endpoint(),e=f.entry(s),cells=ORG10_FIELDS.map(k=>e.row[k]===null?'':String(e.row[k])),bytes=format==='JSON'?Buffer.from(JSON.stringify([e.row])):format==='CSV'?Buffer.from([ORG10_FIELDS.join(','),cells.join(',')].join('\n')):organizationWorkbook({ORG10:[ORG10_FIELDS,cells]}),{row:_row,...operation}=e;
 const received=await f.owner.receiveFile('maker',{requestId:randomUUID(),fileRequestId:randomUUID(),job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_PROTECTED_FILE',profile:'CORE',contractId:f.contract!.id,contractVersionId:f.contract!.versionId,input:{kind:'FILE',format,parserPolicy:'STRICT_UNIT_WARD_V1'}},campus:'NORTH',timePolicy:'LOCAL',retentionSeconds:7200,operations:[operation]},bytes);
 expect(received.issues).toEqual([]);expect(received.input).not.toBeNull();const stored=await f.owner.readInput('maker',{inputId:received.input!.inputId});expect(Object.keys(stored.entries[0]!.row).sort()).toEqual([...ORG10_FIELDS].sort());expect(stored.entries[0]!.row.source_record_id).toBe(e.row.source_record_id);
 await f.owner.verify('reviewer',f.verification(stored,received.input!));const requestId=randomUUID(),q=await f.owner.plan('maker',{inputId:received.input!.inputId,requestId});await f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId});await f.owner.approveApplyUnit('reviewer',q);expect((await f.owner.applyUnit('maker',{candidateId:q.candidateId,requestId})).status).toBe('COMMITTED');
});
test('generated real HTTP performs the approved workflow, reads history and refuses invalid native JSON',async()=>{
 const s=await f.endpoint(),v=await f.input([f.entry(s)]),app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner:f.owner,actor:r=>actor(r.headers)}),url=await app.listen({host:'127.0.0.1',port:0});
 try{const maker=createUnitWardClient(url,'maker'),reviewer=createUnitWardClient(url,'reviewer'),request={...v,entries:v.entries.map(e=>({...e,row:{...e.row,version_no:Number(e.row.version_no)}}))};const staged=await maker.stage(request);expect(staged.response.status).toBe(200);const checked=await reviewer.verify(f.verification(v,staged.data!));expect(checked.response.status).toBe(200);const preview=await maker.preview({inputId:staged.data!.inputId});expect(preview.data!.decision).toBe('PASS');const requestId=randomUUID(),planned=await maker.plan({inputId:staged.data!.inputId,requestId});expect(planned.response.status).toBe(200);expect((await reviewer.review({candidateId:planned.data!.candidateId})).response.status).toBe(200);expect((await reviewer.approve(planned.data!)).response.status).toBe(200);const out=await maker.apply({candidateId:planned.data!.candidateId,requestId});expect(out.response.status,JSON.stringify(out.error)).toBe(200);if(out.data?.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');expect((await maker.query({id:out.data.facts[0]!.id,businessAt:'2026-02-01T00:00:00'})).data!.state).toBe('ACTIVE');expect((await maker.history({id:out.data.facts[0]!.id})).data!.versions).toHaveLength(1);
  const bad=await fetch(url+'/api/vnext/unit-ward-relations/inputs',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify({...request,entries:request.entries.map(e=>({...e,row:{...e.row,version_no:'9'}}))})});expect(bad.status).toBe(400);expect((await createUnitWardClient(url,'outsider').query({id:out.data.facts[0]!.id})).response.status).toBe(403);
 }finally{await app.close();}
});
test('two concurrent primary candidates cannot both commit against the same Ward purpose',async()=>{
 const a=await f.endpoint(),b=await f.sameWard(a),ea=f.entry(a),eb=f.entry(b),q1=await f.prepare(await f.input([{...ea,row:{...ea.row,is_primary:'Y'}}])),q2=await f.prepare(await f.input([{...eb,row:{...eb.row,is_primary:'Y'}}]));
 const results=await Promise.allSettled([f.owner.applyUnit('maker',q1),f.owner.applyUnit('maker',q2)]);expect(results.filter(r=>r.status==='fulfilled'&&r.value.status==='COMMITTED')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(1);
});
test('controlled SQL rejects forged signatures and application table writes',async()=>{
 const pool=new Pool({connectionString:connection,max:1});try{await expect(pool.query('select care_organization.unit_ward_mutate($1,$2)',['{}','0'.repeat(64)])).rejects.toMatchObject({message:'ACCESS_DENIED'});await expect(pool.query('insert into care_organization.unit_ward_access values($1,$2,$3,$4)',['outsider',randomUUID(),'NORTH','READ'])).rejects.toMatchObject({code:'42501'});}finally{await pool.end();}
});
test('finite dependency readers preserve original pins and END removes future obligations through restricted SQL',async()=>{
 const s=await f.endpoint(),e=f.entry(s),q=await f.prepare(await f.input([e])),out=await f.owner.applyUnit('maker',q);if(out.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
 const id=out.facts[0]!.id,h=await f.owner.history('maker',{id}),department=(await f.base.owner.history('maker',{id:s.unit.id})).departmentId,pool=new Pool({connectionString:connection,max:1});
 try{
  const references=async()=>((await pool.query('select care_organization.unit_ward_department_references($1,$2,$3) r',['maker',JSON.stringify([department]),'NORTH'])).rows[0].r as Array<Record<string,unknown>>).find(r=>r['id']===id)!;
  const before=await references();expect(before).toMatchObject({owner:'UNIT_WARD_RELATION',versionId:h.versions[0]!.id,current:true});expect(before['acceptedVersions']).not.toEqual([]);
  const request=await f.prepare(await f.input([{...e,action:'END',target:{owner:'care-organization/unit-ward-relation',id,expectedHead:'1'},endAt:'2026-03-01T00:00:00',row:{...e.row,record_status:'RETIRED'}}]));await f.owner.applyUnit('maker',request);
  const after=await references();expect(after).toMatchObject({current:false,currentAction:'END'});for(const key of ['versionId','version','acceptedVersions','originalPeriod','originalDigest'])expect(after[key]).toEqual(before[key]);
  const deps=(await pool.query('select care_organization.unit_ward_campus_dependencies($1,$2,$3,$4,$5) r',['maker',s.campus.id,'2026-04-01T00:00:00',null,null])).rows[0].r;expect(deps).toContainEqual(expect.objectContaining({id,active:false,outstanding:false}));
  const ended=await f.owner.history('maker',{id}),proof={owner:'UNIT_WARD_RELATION',id,versionId:ended.versions.at(-1)!.id,...request};
  expect((await pool.query('select department_master.impact_result($1,$2,$3) r',['maker',JSON.stringify(proof),'NORTH'])).rows[0].r).toMatchObject({action:'END',safeShrink:true,departmentIds:[department]});
  await expect(pool.query('select department_master.impact_result($1,$2,$3)',['maker',JSON.stringify({...proof,requestId:randomUUID()}),'NORTH'])).rejects.toThrow();
  await expect(pool.query('select care_organization.unit_ward_department_references($1,$2,$3)',['outsider',JSON.stringify([department]),'NORTH'])).rejects.toThrow('ACCESS_DENIED');
 }finally{await pool.end();}
});
test('management must follow the approved Ward manager and full-period upstream coverage is required',async()=>{
 const s=await f.endpoint(),other=await f.sameWard(s),wrong=f.entry({...other,purpose:'MANAGEMENT'});await expect(f.prepare(await f.input([wrong]))).rejects.toThrow('WARD_MANAGEMENT_MISMATCH');
 const wh=await f.wards.owner.history('maker',{id:s.ward.id}),facts=wh.versions[0]!.facts,from='2026-03-01T00:00:00';
 await f.wards.apply(await f.wards.input([{action:'CLOSE',target:{owner:'care-organization/ward',id:s.ward.id,expectedHead:'1'},row:{...f.wards.row({unit:s.unit,campus:s.campus}),ward_id:facts.source.sourceAlias,ward_code:facts.wardCode,ward_name:facts.wardName,ward_type:facts.wardType,admission_rule_ref:facts.admissionRuleReference,public_phone:facts.publicPhone,valid_from:from,record_status:'RETIRED'},reason:'TEST close before requested relation ends',evidenceId:f.wards.artifact.artifactId}]));
 await expect(f.prepare(await f.input([f.entry(s)]))).rejects.toThrow('WARD_WINDOW_NOT_COVERED');
 const finite=f.entry(s);expect((await f.apply(await f.input([{...finite,row:{...finite.row,valid_to:from}}]))).status).toBe('COMMITTED');
});
test('cross-campus input is preserved but has no implicit special-policy admission',async()=>{
 const a=await f.endpoint(),b=await f.endpoint(),s={...a,ward:b.ward},e=f.entry(s),v=await f.input([e]),i=await f.owner.stage('maker',v);expect((await f.owner.readInput('maker',{inputId:i.inputId})).entries[0]!.row.ward_id).toBe(b.ward.id);expect((await f.owner.preview('maker',{inputId:i.inputId})).issues).toContainEqual(expect.objectContaining({code:'CROSS_CAMPUS_POLICY_REQUIRED',status:'BLOCKED'}));
});
test('FULL never silently becomes CORE and invalid native periods cannot stage',async()=>{
 const s=await f.endpoint(),v=await f.input([f.entry(s)]),i=await f.owner.stage('maker',{...v,profile:'FULL'});await f.owner.verify('reviewer',f.verification({...v,profile:'FULL'},i));expect((await f.owner.preview('maker',{inputId:i.inputId})).issues).toContainEqual(expect.objectContaining({code:'BLOCKED_DEPENDENCY',field:'profile'}));await expect(f.owner.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('BLOCKED_DEPENDENCY');
 const fresh=await f.input([f.entry(s)]);for(const time of ['2026-02-30T00:00:00','2026-01-01T00:00:00+08:00','2026-01-01T00:00:00Z'])await expect(f.owner.stage('maker',{...fresh,entries:fresh.entries.map(e=>({...e,row:{...e.row,valid_from:time}}))})).rejects.toThrow();await expect(f.owner.stage('maker',{...fresh,entries:fresh.entries.map(e=>({...e,row:{...e.row,valid_to:e.row.valid_from}}))})).rejects.toThrow('INVALID_BUSINESS_PERIOD');
});
test.skipIf(process.env['VNEXT_P3_04_UPGRADED']!=='1')('populated0185 Ward histories remain exactly as accepted before the forward upgrade',async()=>{
 const prior=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!+'.p3-04-predecessor.json','utf8'));expect(await f.wards.owner.history('maker',{id:prior.ward.id})).toEqual(prior.ward);
 const parameters=openParameterValues(connection),capabilities=openUnitCapabilities(connection,validationKeys(receipt),unitCapabilityUpstreamPorts(f.base.owner,parameters));try{expect(await capabilities.history('maker',{id:prior.capability.id})).toEqual(prior.capability);}finally{await capabilities.close();await parameters.close();}
});
test('a changed Ward version invalidates both Owner approval and the signed restricted SQL plan',async()=>{
 const s=await f.endpoint(),q=await f.prepare(await f.input([f.entry(s)])),c=await f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId}),h=await f.wards.owner.history('maker',{id:s.ward.id}),d=h.versions[0]!,row={...f.wards.row({unit:s.unit,campus:s.campus}),ward_id:d.facts.source.sourceAlias,ward_code:d.facts.wardCode,ward_name:d.facts.wardName+' changed',ward_type:d.facts.wardType,admission_rule_ref:d.facts.admissionRuleReference,public_phone:d.facts.publicPhone};
 await f.wards.apply(await f.wards.input([{action:'REVISE',target:{owner:'care-organization/ward',id:s.ward.id,expectedHead:'1'},row,reason:'TEST changed current Ward version',evidenceId:f.wards.artifact.artifactId}]));await expect(f.owner.applyUnit('maker',q)).rejects.toThrow('STALE_VALIDATION');
 const value=c.unit.commands[0]!.value,pool=new Pool({connectionString:connection,max:1}),client=await pool.connect(),key=Buffer.from(planBinding(validationKeys(receipt),'UNIT_WARD_SQL_AUTHORITY_V1',{}),'hex');try{await client.query('BEGIN');const transaction=(await client.query('select pg_current_xact_id()::text v')).rows[0].v,point=(await client.query('select care_organization.unit_ward_record_time() r')).rows[0].r,ticket=canonicalPlan({operation:'APPLY',actor:'maker',transaction,inputId:value['inputId'],writes:JSON.parse(value['writes']!),writeIndex:1,writesDigest:value['writesDigest'],candidateId:q.candidateId,digest:c.digest,...point});await expect(client.query('select care_organization.unit_ward_mutate($1,$2)',[ticket,createHmac('sha256',key).update(ticket).digest('hex')])).rejects.toMatchObject({message:'STALE_VALIDATION'});}finally{await client.query('ROLLBACK');client.release();await pool.end();key.fill(0);}
});
test('P3-04-AC-05 Ward closure blocks expansion but permits exact permanent END and retains old B/R',async()=>{
 const s=await f.endpoint(),e=f.entry(s),out=await f.apply(await f.input([e])),id=out.facts[0]!.id,old=await f.owner.exact('maker',{id,version:'1'}),h=await f.wards.owner.history('maker',{id:s.ward.id}),d=h.versions[0]!,binding={unit:s.unit,campus:s.campus},endAt='2026-03-01T00:00:00';
 const row={...f.wards.row(binding),ward_id:d.facts.source.sourceAlias,ward_code:d.facts.wardCode,ward_name:d.facts.wardName,ward_type:d.facts.wardType,admission_rule_ref:d.facts.admissionRuleReference,public_phone:d.facts.publicPhone,valid_from:endAt,valid_to:null,record_status:'RETIRED' as const};
 await f.wards.apply(await f.wards.input([{action:'CLOSE',target:{owner:'care-organization/ward',id:s.ward.id,expectedHead:h.versions.at(-1)!.number},row,reason:'TEST parent permanent closure',evidenceId:f.wards.artifact.artifactId}]));
 expect((await f.owner.evaluateWindow('maker',{applicability:s,validFrom:endAt,validTo:'2026-04-01T00:00:00',mode:'CURRENT_ADMISSION'})).status).toBe('NOT_SATISFIED');
 await f.apply(await f.input([{...e,action:'END',target:{owner:'care-organization/unit-ward-relation',id,expectedHead:'1'},endAt,row:{...e.row,record_status:'RETIRED'}}]));
 expect((await f.owner.read('maker',{id,businessAt:endAt})).state).toBe('ENDED');expect(await f.owner.exact('maker',{id,version:'1'})).toEqual(old);expect((await f.owner.read('maker',{id,businessAt:endAt,recordAsOf:old.recordedAt})).state).toBe('ACTIVE');
 // The native unpadded start denotes the same instant as the database's six-digit form.
 await f.apply(await f.input([{...e,action:'END',target:{owner:'care-organization/unit-ward-relation',id,expectedHead:'2'},endAt:e.row.valid_from,row:{...e.row,record_status:'RETIRED'}}]));
 expect((await f.owner.read('maker',{id,businessAt:e.row.valid_from})).state).toBe('ENDED');expect(await f.owner.exact('maker',{id,version:'1'})).toEqual(old);
});
test('independent relation source version changes invalidate both Owner and signed restricted SQL admission',async()=>{
 const command=<A extends string>(action:A,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'TEST_UNIT_WARD_SOURCE',...extra}),publish=async(d:{id:string;head:string})=>{const s=await catalog.command('maker',command('SUBMIT',{target:d.id,expectedHead:d.head})),impact=await catalog.sourceImpact('reviewer','SYNTHETIC',d.id,'PUBLISH');return catalog.command('reviewer',command('PUBLISH',{target:d.id,expectedHead:s.head,reviewDigest:s.reviewDigest,impactDigest:impact.impactDigest}));};
 const source=await publish(await catalog.command('maker',command('CREATE',{kind:'SOURCE',code:'TEST_UW_'+randomUUID().replaceAll('-','').toUpperCase(),values:{name:'TEST independent relation source',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST_OWNER',technicalRole:'TEST',sourceEvidence:f.base.dep.source.id},validFrom:'2026-01-01T00:00:00',validTo:null}))),pool=new Pool({connectionString:connection,max:1});let own:Awaited<ReturnType<typeof unitWardFixture>>|undefined;
 try{const role=(await pool.query('select current_user r')).rows[0].r;own=await unitWardFixture(receipt,role,catalog,validationKeys(receipt),connection,false,f.wards,source);const scope=await own.endpoint(),request=await own.prepare(await own.input([own.entry(scope)])),candidate=await own.owner.readApplyCandidate('reviewer',{candidateId:request.candidateId}),value=candidate.unit.commands[0]!.value;
  const restricted=async()=>{const client=await pool.connect(),key=Buffer.from(planBinding(validationKeys(receipt),'UNIT_WARD_SQL_AUTHORITY_V1',{}),'hex');try{await client.query('BEGIN');const transaction=(await client.query('select pg_current_xact_id()::text v')).rows[0].v,point=(await client.query('select care_organization.unit_ward_record_time() r')).rows[0].r,ticket=canonicalPlan({operation:'APPLY',actor:'maker',transaction,inputId:value['inputId'],writes:JSON.parse(value['writes']!),writeIndex:1,writesDigest:value['writesDigest'],candidateId:request.candidateId,digest:candidate.digest,...point});return await client.query('select care_organization.unit_ward_mutate($1,$2)',[ticket,createHmac('sha256',key).update(ticket).digest('hex')]).then(()=> 'AUTHORIZED',(error:Error)=>error.message);}finally{await client.query('ROLLBACK');client.release();key.fill(0);}};
  expect(await restricted()).toBe('AUTHORIZED');
  const head=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.id===source.id)!.head;await publish(await catalog.command('maker',command('REVISE',{target:source.id,expectedHead:head,values:{name:'TEST independently republished covering source'},validFrom:'2026-01-01T00:00:00',validTo:null})));
  await expect(own.owner.applyUnit('maker',request)).rejects.toThrow('STALE_VALIDATION');expect(await restricted()).toBe('STALE_VALIDATION');expect((await own.owner.list('maker',{campus:'NORTH',unitId:scope.unit.id})).items).toHaveLength(0);
 }finally{await own?.close();await pool.end();}
});
