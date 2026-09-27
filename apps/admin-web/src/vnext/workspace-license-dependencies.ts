import {createElement,Fragment,type ReactNode} from 'react';
import type {VNextOperations as Operations} from '@hospital-data-intelligence/generated-api-client';
import {licenseVersionActions} from './workspace-license-actions.js';

type License=Operations['readOrganizationLicenses']['responses'][200]['content']['application/json'][number];
type Selected=Pick<License,'id'|'version'>;
type Reference=Selected&{owner:'organization-master/license';versionId:string};
const key=(row:Selected)=>row.id+'/'+row.version;
const reference=(row:License):Reference=>({owner:'organization-master/license',id:row.id,version:row.version,versionId:row.versionId});

/** Dependency choices exclude revocation assertions, not an entire license's history. */
export function licenseDependencyOptions<T extends {revoked:boolean}>(rows:readonly T[]):T[]{
 return rows.filter(row=>row.revoked===false);
}
interface Props {
 rows:readonly License[];
 selected:readonly Selected[];
 multiple:boolean;
 disabled:boolean;
 purpose?:'DEPENDENCY'|'CURRENT_REVISION';
 groupName?:string;
 onChange:(refs:Reference[])=>void;
 label:(row:License)=>ReactNode;
}
export function WorkspaceLicenseDependencyOptions({rows,selected,multiple,disabled,onChange,label,purpose='DEPENDENCY',groupName}:Props){
 // Bundle compilation consumes an exact concurrency target, not a historical revision seed.
 const options=purpose==='CURRENT_REVISION'?rows.filter(row=>licenseVersionActions(row,rows,true).canRevoke):licenseDependencyOptions(rows);
 const isSelected=(row:Selected)=>selected.some(value=>key(value)===key(row));
 const hasRevokedSelection=rows.some(row=>row.revoked===true&&isSelected(row));
 const staleRevision=purpose==='CURRENT_REVISION'&&selected.some(row=>!options.some(option=>key(option)===key(row)));
 return createElement(Fragment,null,
  staleRevision?createElement('p',{role:'alert'},'已保存的证照目标不是当前可修订版本；请明确重新选择或清除，不会自动替换目标。'):null,
  hasRevokedSelection?createElement('p',{role:'alert'},'已选引用包含撤销记录，不能作为核验依据；请清除或重新选择。'):null,
  hasRevokedSelection?createElement('button',{type:'button',className:'secondary',disabled,onClick:()=>{
   if(!disabled)onChange(options.filter(isSelected).map(reference));
  }},'清除已撤销的证照引用'):null,
  ...options.map(row=>createElement('label',{key:row.versionId},
   createElement('input',{type:multiple?'checkbox':'radio',name:groupName,disabled,
    checked:isSelected(row),onChange:(event:{target:{checked:boolean}})=>{
     if(disabled||(!multiple&&!event.target.checked))return;
     // Rebuild from the same eligible rows that are rendered, never raw history.
     onChange(multiple?options.filter(value=>key(value)===key(row)?event.target.checked:isSelected(value)).map(reference):[reference(row)]);
    }}),label(row))),
  !options.length?createElement('p',null,purpose==='CURRENT_REVISION'?'当前主体没有可选择的最新非撤销证照版本。':'当前主体没有可选择的非撤销证照版本。'):null,
 );
}
