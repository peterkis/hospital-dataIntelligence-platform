import {test,expect} from 'vitest';
import {assertP310Preserved} from './p3-10-preservation.mjs';
const role='hdi_owner_0000000000000001',routine='FUNCTION:organization_master.use_location_boundaries(text,uuid,timestamp without time zone,timestamp without time zone,timestamp without time zone)';
const before=()=>({ledger:[{version:'0252',checksum:'original'}],keyDigest:'same-key',tables:['care_organization.unit'],columns:{'care_organization.unit':[{name:'id',type:'uuid',notNull:true}]},rows:{'care_organization.unit':['duplicate','duplicate']},acl:{[routine]:['postgres=X/postgres'],'TABLE:care_organization.unit':['postgres=arwdDxtm/postgres']}});
test('retained preservation permits exactly one listed public Execute addition and reports it separately',()=>{
 const original=before(),current=structuredClone(original);current.acl[routine]!.push(role+'=X/postgres');
 expect(assertP310Preserved(original,current,role,{exactRows:true})).toMatchObject({originalAclEntriesPreserved:true,originalAclBytesUnchanged:false,additionalPublicExecuteGrants:[{routine,entry:role+'=X/postgres'}]});expect(current.acl[routine]).toHaveLength(2);
});
test('an added copy of an original row is not disguised as a permitted new synthetic fact',()=>{
 const original=before(),current=structuredClone(original);current.rows['care_organization.unit'].push('duplicate');expect(()=>assertP310Preserved(original,current,role)).toThrow('ORIGINAL_DUPLICATE_COUNT_CHANGED');
});
test.each(['changed-original','grant-option','wrong-role','table-change','removed-duplicate','changed-ledger'] as const)('retained preservation refuses %s',kind=>{
 const original=before(),current=structuredClone(original);current.acl[routine]!.push(role+'=X/postgres');
 if(kind==='changed-original')current.acl[routine]![0]='postgres=X*/postgres';
 if(kind==='grant-option')current.acl[routine]![1]=role+'=X*/postgres';
 if(kind==='wrong-role')current.acl[routine]![1]='hdi_owner_0000000000000002=X/postgres';
 if(kind==='table-change')current.acl['TABLE:care_organization.unit']!.push(role+'=r/postgres');
 if(kind==='removed-duplicate')current.rows['care_organization.unit'].pop();
 if(kind==='changed-ledger')current.ledger[0]!.checksum='changed';
 expect(()=>assertP310Preserved(original,current,role)).toThrow();
});
test('an unlisted routine cannot acquire even a same-role Execute grant',()=>{
 const original=before();original.acl['TABLE:care_organization.unit']=[];const key='FUNCTION:organization_master.mutate(text,text)';const baseline={...original,acl:{...original.acl,[key]:['postgres=X/postgres']}},current=structuredClone(baseline);current.acl[key]!.push(role+'=X/postgres');expect(()=>assertP310Preserved(baseline,current,role)).toThrow('UNEXPECTED_ACL_CHANGE');
});
test('new private objects retain only the migration Owner while a listed public routine gets the single service Execute',()=>{
 const original=before(),current={...structuredClone(original),acl:{...original.acl,'TABLE:care_organization.workspace_draft_revision':null,'FUNCTION:care_organization.workspace_basis_authorize(text,jsonb,boolean)':['postgres=X/postgres'],'FUNCTION:care_organization.workspace_basis_record(text,text)':['postgres=X/postgres',role+'=X/postgres']}};
 expect(assertP310Preserved(original,current,role).additionalPublicExecuteGrants).toEqual([{routine:'FUNCTION:care_organization.workspace_basis_record(text,text)',entry:role+'=X/postgres'}]);
});
test.each(['new-table-read','new-private-execute','new-public-wrong-role','new-public-grant-option','new-function-public-default'] as const)('new object preservation refuses %s',kind=>{
 const original=before(),acl:Record<string,unknown>={...original.acl};
 if(kind==='new-table-read')acl['TABLE:care_organization.workspace_draft_revision']=['postgres=arwdDxtm/postgres',role+'=r/postgres'];
 if(kind==='new-private-execute')acl['FUNCTION:care_organization.workspace_basis_authorize(text,jsonb,boolean)']=['postgres=X/postgres',role+'=X/postgres'];
 if(kind==='new-public-wrong-role')acl['FUNCTION:care_organization.workspace_basis_record(text,text)']=['postgres=X/postgres','hdi_owner_0000000000000002=X/postgres'];
 if(kind==='new-public-grant-option')acl['FUNCTION:care_organization.workspace_basis_record(text,text)']=['postgres=X/postgres',role+'=X*/postgres'];
 if(kind==='new-function-public-default')acl['FUNCTION:care_organization.workspace_basis_authorize(text,jsonb,boolean)']=null;
 expect(()=>assertP310Preserved(original,{...structuredClone(original),acl},role)).toThrow();
});
