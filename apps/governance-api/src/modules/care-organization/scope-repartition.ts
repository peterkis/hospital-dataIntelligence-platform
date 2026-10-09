import {sql} from 'kysely';
import type {CatalogTransactionScope} from '../governance-catalog/index.js';
import {localTime} from '../organization-master/index.js';
import type {ApprovedScopeSet,CoverageScope,NursingHandover,ScopeRevisionProjection} from './ward-nursing-contracts.js';

/** Resolve responsibility through the exact immutable producer's mapping. */
export async function validateScopeRepartition(s:CatalogTransactionScope,actor:string,h:Extract<NursingHandover,{kind:'CONFIRMED_HANDOVER'}>,original:CoverageScope,p:ScopeRevisionProjection){
 const plan=h.partitionPlan,ref=plan?.repartition;if(!plan||!ref||ref.inputId!==p.basis.inputId||ref.digest!==p.basis.inputDigest||localTime(h.cutover)<p.basis.validFrom)throw new Error('HANDOVER_NOT_CONFIRMED');
 const sourceVersion=original.kind==='PARTITIONS'?original.version:p.mapping[0]!.version;
 const set=(await sql<{r:ApprovedScopeSet}>`select care_organization.ward_nursing_scope_version_read(${actor},${p.basis.scopeSetId}::uuid,${sourceVersion}::bigint,timezone('Asia/Shanghai',clock_timestamp())) r`.execute(s)).rows[0]!.r;
 if(original.kind==='PARTITIONS'&&original.scopeSetId!==set.id)throw new Error('SCOPE_BASIS_MISMATCH');
 const oldIds=original.kind==='PARTITIONS'?original.partitionIds:set.partitions.map(p=>p.id);
 const aliases=new Set(p.mapping.filter(m=>oldIds.includes(m.partitionId)&&m.version===sourceVersion).flatMap(m=>m.toAliases)),expected=p.basis.partitions.filter(q=>aliases.has(q.sourceAlias)).map(q=>q.id);
 const ids=plan.successors.flatMap(q=>{if(q.coverage.kind!=='PARTITIONS'||q.coverage.scopeSetId!==set.id||q.coverage.version!==p.basis.version)throw new Error('SCOPE_BASIS_MISMATCH');return q.coverage.partitionIds;});
 if(oldIds.some(id=>!p.mapping.some(m=>m.partitionId===id&&m.version===sourceVersion))||new Set(ids).size!==ids.length||expected.length!==ids.length||expected.some(id=>!ids.includes(id)))throw new Error('SCOPE_MAPPING_INCOMPLETE');
}
