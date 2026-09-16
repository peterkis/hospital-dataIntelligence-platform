import {sql,Kysely,PostgresDialect} from 'kysely';
import {Pool} from 'pg';
import type {DB} from '../../apps/governance-api/src/platform/database/vnext-types.generated.js';
import {applyCoordinator,type ApplyOwnerPort,type ObservedOwnerUnit,type OwnerFact} from '../../apps/governance-api/src/modules/governance-catalog/apply-coordinator.js';
import {protectedArtifacts,type KeyProviderPort,type ProtectedReadInput} from '../../apps/governance-api/src/modules/governance-catalog/protected-artifact.js';

/** Test composition only. The runner verifies the receipt and grants this finite port. */
export function finiteCoordinator(connectionString:string,provider?:KeyProviderPort,protectedRead?:ProtectedReadInput){
 const pool=new Pool({connectionString,max:4});
 const db=new Kysely<DB>({dialect:new PostgresDialect({pool})});
 const owner:ApplyOwnerPort={
  async authorize(scope,actor,input,action){await sql`select p0_08_owner.authorize(${actor},${JSON.stringify(input)}::jsonb,${action})`.execute(scope);},
  async observe(scope,actor,input){return (await sql<{result:ObservedOwnerUnit}>`select p0_08_owner.observe(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(scope)).rows[0]!.result;},
  async validate(scope,actor,unit){
   await owner.authorize(scope,actor,unit.input,'READ');
   if(unit.atomicRule!=='FINITE_PAIR_ALL_ROWS_V1'||unit.commands.some(c=>!['FINITE_LEFT','FINITE_RIGHT'].includes(c.owner)))throw new Error('BLOCKED_DEPENDENCY');
   for(const command of unit.commands){
    if(command.target&&!(await owner.exactRead(scope,actor,unit.input,command.target)))throw new Error('STALE_VALIDATION');
    if(!['CREATE','REVISE'].includes(command.intent)||(command.intent==='REVISE')!==!!command.target)throw new Error('BLOCKED_DEPENDENCY');
   }
  },
  async apply(scope,_actor,command,resolved){
   if(command.row===2&&protectedRead){
    const bytes=await protectedArtifacts(scope,provider).authorizeSensitiveRead('maker',protectedRead);
    bytes.fill(0);
   }
   const mode=(await sql<{mode:string|null}>`select p0_08_owner.intermediate_read(${command.row}) as mode`.execute(scope)).rows[0]!.mode;
   await scope.protectedReadCompleted();
   if(mode==='REJECT')return {ok:false};
   if(mode==='THROW')throw new Error('OWNER_REJECTED');
   if(mode==='NETWORK')throw Object.assign(new Error('socket closed'),{code:'ECONNRESET'});
   const value={...command.value};
   for(const alias of command.aliases){const fact=resolved.get(alias);if(!fact)throw new Error('BLOCKED_DEPENDENCY');value['alias_'+alias]=fact.id;}
   const input=JSON.stringify({...command,value});
   const result=command.owner==='FINITE_LEFT'?
    await sql<{fact:OwnerFact}>`select p0_08_owner.write_left(${input}::jsonb) as fact`.execute(scope):
    await sql<{fact:OwnerFact}>`select p0_08_owner.write_right(${input}::jsonb) as fact`.execute(scope);
   return {ok:true,fact:result.rows[0]!.fact};
  },
  async exactRead(scope,actor,input,fact){return (await sql<{result:OwnerFact|null}>`select p0_08_owner.exact_read(${actor},${JSON.stringify(input)}::jsonb,${JSON.stringify(fact)}::jsonb) as result`.execute(scope)).rows[0]!.result;}
 };
 return {coordinator:applyCoordinator(db,provider,owner),db,pool,close:()=>db.destroy()};
}
