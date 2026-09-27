import {createElement,Fragment} from 'react';
import type {VNextOperations as Operations} from '@hospital-data-intelligence/generated-api-client';

export type License=Operations['readOrganizationLicenses']['responses'][200]['content']['application/json'][number];
export type LicenseContext=Operations['organizationObjectContext']['responses'][200]['content']['application/json'];
type DraftContent=Operations['prepareOrganizationRevision']['responses'][200]['content']['application/json'];
export type LicenseVersion=Pick<License,'id'|'version'|'revoked'>;
const versionNumber=/^[1-9][0-9]*$/u;

/** Historical assertions remain readable; only non-revoked rows can seed a revision. */
export function licenseVersionActions(license:LicenseVersion,history:readonly LicenseVersion[],canMaintain:boolean){
 const versions=history.filter(row=>row.id===license.id);
 const canRevise=canMaintain&&license.revoked===false&&versionNumber.test(license.version)
  &&versions.some(row=>row.version===license.version&&row.revoked===false);
 // Include revoked and future-effective assertions when finding the head.
 // Versions are database integers serialized as strings, not lexical sort keys.
 const canRevoke=canRevise&&versions.every(row=>versionNumber.test(row.version)
  &&BigInt(row.version)<=BigInt(license.version));
 return {canRevise,canRevoke};
}

/** A click must re-read LICENSE context; never silently retarget a stale row. */
export function licenseRevocationDraft(license:LicenseVersion,subjectId:string,context:LicenseContext):DraftContent|null{
 if(license.revoked!==false||!versionNumber.test(license.version)||context.kind!=='LICENSE'
  ||context.id!==license.id||context.subjectId!==subjectId||context.head!==license.version
  ||!context.subjectHead||!context.canWrite||!context.canClose||context.terminal)return null;
 return {domain:'ORG01',campus:context.campus,command:{action:'REVOKE_LICENSE',validTo:null,
  target:{id:subjectId,version:context.subjectHead},licenseTarget:{id:license.id,version:context.head}}};
}

interface Props {
 license:LicenseVersion;
 history:readonly LicenseVersion[];
 canMaintain:boolean;
 busy:boolean;
 onRevise:()=>void;
 onRevoke:()=>void;
}

export function WorkspaceLicenseActions({license,history,canMaintain,busy,onRevise,onRevoke}:Props){
 const actions=licenseVersionActions(license,history,canMaintain);
 return createElement(Fragment,null,
  actions.canRevise?createElement('button',{className:'secondary',disabled:busy,
   onClick:()=>{if(!busy)onRevise();}},'以此证照版本修订'):null,
  actions.canRevoke?createElement('button',{className:'secondary',disabled:busy,
   onClick:()=>{if(!busy)onRevoke();}},'撤销此证照断言'):null,
 );
}
