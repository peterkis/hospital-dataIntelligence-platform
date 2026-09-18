import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerRole} from './validation-owner-session.mjs';
import {migrate,peer,quote} from './lineage.mjs';
import {reconcileValidationCleanup} from './p0-10-cleanup.mjs';

test('cleanup recovers a disposed database with a remaining owner and is repeatable',async()=>{
  const owned=createTemporary('P0-10');let owner;
  try {
    await migrate(owned.receipt);
    owner=await createValidationOwnerSession(owned.receipt);
    dropTemporary(owned.receipt);
    const recovered=reconcileValidationCleanup(owned.receipt,owner);
    expect(recovered.status).toBe('PASS');
    expect(recovered.database.disposition).toBe('ALREADY_ABSENT');
    expect(recovered.owner.status).toBe('PASS');
    const marker=readFileSync(owner.receiptPath+'.disposed.json','utf8');
    expect(reconcileValidationCleanup(owned.receipt,owner).status).toBe('PASS');
    expect(readFileSync(owner.receiptPath+'.disposed.json','utf8')).toBe(marker);
  } catch(error) {
    if(error&&typeof error==='object'&&'ownerSession' in error)owner=error.ownerSession;
    throw error;
  } finally {
    if(peer('postgres',`SELECT count(*) FROM pg_database WHERE datname=${quote(owned.receipt.name)};`)!=='0')dropTemporary(owned.receipt);
    if(owner)dropValidationOwnerRole(owner);
  }
},300000);
