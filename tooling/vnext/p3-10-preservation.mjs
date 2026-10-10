import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {assertP311Preserved} from './p3-11-preservation.mjs';
import {careWorkspaceFunctions} from './p3-10-provisioning.mjs';

// Only these native public workspace/Owner ports are added to the service role.
// Existing ACL entries retain their exact bytes and order; tables, schemas,
// other roles, grant options and every unlisted routine remain byte-exact.
const allowed=new Set([...careWorkspaceFunctions,'governance_catalog.parameter_value_boundaries(text,jsonb)'].map(signature=>'FUNCTION:'+signature.replaceAll(/\btimestamp\b/g,'timestamp without time zone')));
export function assertP310Preserved(before,after,role,options={}){
 assert.match(role,/^hdi_owner_[a-f0-9]{16}$/);
 for(const table of before.tables){const prior=new Map(),current=new Map();for(const hash of before.rows[table])prior.set(hash,(prior.get(hash)??0)+1);for(const hash of after.rows[table])current.set(hash,(current.get(hash)??0)+1);for(const [hash,count] of prior)assert.equal(current.get(hash),count,'ORIGINAL_DUPLICATE_COUNT_CHANGED:'+table);}
 const projected={...after,acl:{...after.acl}},additions=[];
 for(const [name,acl] of Object.entries(before.acl)){
  const current=after.acl[name];if(isDeepStrictEqual(current,acl))continue;
  assert.ok(allowed.has(name)&&Array.isArray(acl)&&Array.isArray(current),'UNEXPECTED_ACL_CHANGE:'+name);
  assert.deepEqual(current.slice(0,acl.length),acl,'ORIGINAL_ACL_ENTRY_CHANGED:'+name);
  assert.deepEqual(current.slice(acl.length),[role+'=X/postgres'],'UNEXPECTED_EXECUTE_GRANT:'+name);
  additions.push({routine:name,entry:current.at(-1)});projected.acl[name]=acl;
 }
 for(const [name,acl] of Object.entries(after.acl)){
  if(Object.hasOwn(before.acl,name))continue;
  if(name.startsWith('TABLE:')){
   assert.ok(acl===null||isDeepStrictEqual(acl,['postgres=arwdDxtm/postgres']),'NEW_TABLE_ACL_NOT_OWNER_ONLY:'+name);
  }else if(name.startsWith('FUNCTION:')){
   if(isDeepStrictEqual(acl,['postgres=X/postgres']))continue;
   assert.ok(allowed.has(name),'NEW_ROUTINE_EXECUTE_NOT_LISTED:'+name);
   assert.deepEqual(acl,['postgres=X/postgres',role+'=X/postgres'],'NEW_ROUTINE_EXECUTE_INVALID:'+name);
   additions.push({routine:name,entry:role+'=X/postgres'});
  }else assert.fail('UNEXPECTED_NEW_ACL_OBJECT:'+name);
 }
 const preserved=assertP311Preserved(before,projected,options);
 return {...preserved,originalAclEntriesPreserved:true,originalAclBytesUnchanged:additions.length===0,additionalPublicExecuteGrants:additions};
}
