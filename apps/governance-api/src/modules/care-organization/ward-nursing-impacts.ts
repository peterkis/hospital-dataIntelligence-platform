import {sql} from 'kysely';
import type {CatalogTransactionScope} from '../governance-catalog/index.js';
import {localTime} from '../organization-master/index.js';
import type {CoverageScope,WardNursingFacts,WardNursingScope} from './ward-nursing-contracts.js';

export interface WardNursingEndpointImpactInput {
 kind:'NURSING'|'WARD';id:string;validFrom:string;validTo:string|null;recordAsOf?:string;
}
export interface WardNursingEndpointImpact {
 owner:'WARD_NURSING_COVERAGE';endpoint:{kind:'NURSING'|'WARD';id:string};
 validFrom:string;validTo:string|null;recordAsOf:string;status:'EVALUATED';clinicalReadiness:'NOT_READY';
 items:Array<{
  id:string;applicability:WardNursingScope;
  original:{versionId:string;version:string;period:{from:string;to:string|null};coverage:CoverageScope;digest:string;dependencies:WardNursingFacts['dependencies']};
  current:{versionId:string;version:string;action:'CREATE'|'REVISE'|'END';period:{from:string;to:string|null};coverage:CoverageScope};
  active:boolean;outstanding:boolean;affectedSpans:Array<{from:string;to:string|null}>;
  lifecycle:Array<{versionId:string;action:'SUSPEND'|'RESUME'|'CLOSE';from:string;to:string|null}>;
  constraint:'SATISFIED'|'UNSATISFIED';
 }>;
}

/** Retained coverage obligations are independent of an endpoint's admission stop. */
export async function readWardNursingEndpointImpactsInTransaction(s:CatalogTransactionScope,actor:string,input:WardNursingEndpointImpactInput):Promise<WardNursingEndpointImpact>{
 const from=localTime(input.validFrom),to=input.validTo===null?null:localTime(input.validTo);
 if(to!==null&&to<=from)throw new Error('INVALID_BUSINESS_PERIOD');
 return (await sql<{r:WardNursingEndpointImpact}>`select care_organization.ward_nursing_endpoint_impacts(${actor},${input.kind},${input.id}::uuid,${from}::timestamp,${to}::timestamp,${input.recordAsOf?localTime(input.recordAsOf):null}::timestamp) r`.execute(s)).rows[0]!.r;
}
