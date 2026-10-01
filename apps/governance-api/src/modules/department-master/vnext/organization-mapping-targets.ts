import {openOrganization,openCampus,covered,intersect} from '../../organization-master/index.js';
import {openDepartment} from './index.js';
import type {CatalogTransactionScope,KeyProviderPort} from '../../governance-catalog/index.js';

export interface MappingTargetReference {owner:'organization-master'|'organization-master/campus'|'department-master';id:string;parts:Array<{from:string;to:string|null;versionId:string;version:string}>}
export interface OrganizationMappingTargetPort {
 read(scope:CatalogTransactionScope,actor:string,input:{type:string;id:string;validFrom:string;validTo:string|null;recordAsOf?:string}):Promise<MappingTargetReference>;
 authorize(scope:CatalogTransactionScope,actor:string,input:{type:string;id:string;validFrom:string;validTo:string|null}):Promise<void>;
 close():Promise<void>;
}
export function createOrganizationMappingTargets(connection:string,provider?:KeyProviderPort):OrganizationMappingTargetPort{
 const organization=openOrganization(connection,provider),campus=openCampus(connection,provider),department=openDepartment(connection,provider);
 const within=(parts:MappingTargetReference['parts'],from:string,to:string|null)=>parts.flatMap(part=>intersect(part,{from,to}).map(span=>({...part,...span})));
 const observe=async(scope:CatalogTransactionScope,actor:string,input:Parameters<OrganizationMappingTargetPort['read']>[2]):Promise<{reference:MappingTargetReference;covered:boolean}>=>{
   if(input.type==='ORG'){
    const {type:_,...coverageInput}=input;
    const result=await department.coverageInTransaction(scope,actor,coverageInput);
    return {reference:{owner:'department-master',id:input.id,parts:within(result.parts,input.validFrom,input.validTo)},covered:result.covered};
   }
   if(input.type==='LEGAL'){
    const result=await organization.registration.inTransaction(scope).read(actor,{id:input.id,...(input.recordAsOf?{asOf:input.recordAsOf}:{})});
    return {reference:{owner:'organization-master',id:input.id,parts:within(result.profiles,input.validFrom,input.validTo)},covered:covered(result.profiles,input.validFrom,input.validTo)};
   }
   if(input.type==='CAMPUS'){
    const result=await campus.references.inTransaction(scope).readCampusReferenceCoverage(actor,{references:[{owner:'organization-master/campus',id:input.id}],validFrom:input.validFrom,validTo:input.validTo,...(input.recordAsOf?{asOf:input.recordAsOf}:{})});
    const item=result.items[0];
    return {reference:{owner:'organization-master/campus',id:input.id,parts:within(item?.segments.map(s=>({from:s.from,to:s.to,versionId:s.profileVersion.versionId,version:s.profileVersion.version}))??[],input.validFrom,input.validTo)},covered:item?.coverage==='COVERED'};
   }
   throw new Error('BLOCKED_DEPENDENCY');
 };
 return {
  async read(scope,actor,input){const result=await observe(scope,actor,input);if(!result.covered)throw new Error('BLOCKED_DEPENDENCY');return result.reference;},
  // Current Owner authorization is mandatory for immutable reads and closure;
  // their accepted coverage is not re-qualified against today's lifecycle.
  async authorize(scope,actor,input){await observe(scope,actor,input);},
  async close(){await Promise.all([organization.close(),campus.close(),department.close()]);},
 };
}
