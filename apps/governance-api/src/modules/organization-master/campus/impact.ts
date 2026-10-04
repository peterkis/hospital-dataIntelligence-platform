import {createHash} from 'node:crypto';
import {sql} from 'kysely';
import {canonicalPlan} from '../../governance-catalog/index.js';
import {localTime} from '../time.js';
import {CampusImpactSchema,type CampusImpact} from './contracts.js';
import {check,type Scope} from './input.js';
export interface CampusBusinessUnitPort {owners?:readonly ('BUSINESS_UNIT'|'NURSING_UNIT')[];readInTransaction(scope:Scope,actor:string,input:{id:string;validFrom:string;validTo:string|null;asOf?:string}):Promise<Array<{owner:'BUSINESS_UNIT'|'NURSING_UNIT';id:string;version:string;active:boolean;outstanding:boolean}>>}

export async function assessImpact(scope:Scope,actor:string,input:{id:string;validFrom:string;validTo:string|null;asOf?:string},units?:CampusBusinessUnitPort):Promise<CampusImpact>{
 check(CampusImpactSchema,input);
 const from=localTime(input.validFrom),to=input.validTo===null?null:localTime(input.validTo);
 if(to!==null&&to<=from)throw new Error('INVALID_BUSINESS_PERIOD');
 const result=(await sql<{r:Omit<CampusImpact,'digest'|'dependencyDigest'>}>`select organization_master.campus_impact(${actor},${input.id}::uuid,${from}::timestamp,${to}::timestamp,${input.asOf?localTime(input.asOf):null}::timestamp) r`.execute(scope)).rows[0]!.r;
 if(units){result.dependencies.push(...await units.readInTransaction(scope,actor,input));result.unavailable=result.unavailable.filter(owner=>!(units.owners??['BUSINESS_UNIT']).includes(owner as 'BUSINESS_UNIT'|'NURSING_UNIT'));}
 const digest=(value:unknown)=>createHash('sha256').update(canonicalPlan(value)).digest('hex');
 return {...result,digest:digest(result),dependencyDigest:digest({campusId:result.campusId,validFrom:result.validFrom,validTo:result.validTo,dependencies:result.dependencies,unavailable:result.unavailable})};
}
