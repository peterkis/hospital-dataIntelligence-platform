import type {VNextOperations as Operations} from '@hospital-data-intelligence/generated-api-client';
import {Group,textField,objectField} from './workspace-fields.js';
import {WorkspaceLicenseSelection} from './workspace-reference-fields.js';

type Contract=Operations['listImportContracts']['responses'][200]['content']['application/json']['items'][number];
export type BundleSourceContract=Pick<Contract,'id'|'versionId'|'dataset'|'profile'|'status'>&{definition:Pick<Contract['definition'],'sourceVersionId'|'templateVersion'>};
export interface BundleSourceBinding {dataset?:string;contractId?:string;contractVersionId?:string}
type Row=Record<string,unknown>;
type Target={owner:'organization-master'|'organization-master/campus'|'organization-master/operating-relation';id:string;expectedVersion:string};

/** A row's source comes from its own exact file binding, never the other sheets. */
export function bundleRowSourceVersions(dataset:string,bindings:readonly BundleSourceBinding[],contracts:readonly BundleSourceContract[]):string[]{
 const bound=bindings.filter(binding=>binding.dataset===dataset);
 if(bound.length!==1)return [];
 const binding=bound[0]!;
 if(!binding.contractId||!binding.contractVersionId)return [];
 const matches=contracts.filter(contract=>contract.dataset===dataset&&contract.id===binding.contractId&&contract.versionId===binding.contractVersionId&&contract.profile==='CORE'&&contract.status==='PUBLISHED'&&contract.definition.templateVersion===dataset+'_BUNDLE_CORE_V1');
 const source=matches.length===1?matches[0]!.definition.sourceVersionId:undefined;
 return source?[source]:[];
}

export function bundleRowIntentPatch(current:Row,intent:'CREATE'|'REVISE'|''):Row{
 if(intent==='REVISE')return {intent};
 const license=objectField(current,'license');
 return {intent:intent||undefined,target:undefined,...(license['target']!==undefined||license['intent']==='REVISE'?{license:{...license,target:undefined,...(license['intent']==='REVISE'?{intent:undefined}:{})}}:{})};
}
export function bundleRowTargetPatch(current:Row,target:Target|undefined):Row{
 const license=objectField(current,'license');
 return {target,...(textField(objectField(current,'target'),'id')!==(target?.id??'')&&license['target']!==undefined?{license:{...license,target:undefined}}:{})};
}
export function bundleLicenseIntentPatch(current:Row,intent:'CREATE'|'REVISE'|''):Row{
 const license=objectField(current,'license');
 return {license:{...license,intent:intent||undefined,...(intent!=='REVISE'?{target:undefined}:{})}};
}
export function bundleLicenseSelected(current:Row):Array<{id:string;version:string}>{
 const target=objectField(objectField(current,'license'),'target'),id=textField(target,'id'),version=textField(target,'version');
 return id&&version?[{id,version}]:[];
}

export function BundleRowAdoptionFields({dataset,current,bindings,contracts,disabled,onChange}:{dataset:string;current:Row;bindings:readonly BundleSourceBinding[];contracts:readonly BundleSourceContract[];disabled:boolean;onChange:(patch:Row)=>void}){
 const sources=bundleRowSourceVersions(dataset,bindings,contracts),selected=textField(current,'sourceVersionId');
 return <Group title="本行采纳清单"><label>操作意图<select disabled={disabled} value={textField(current,'intent')} onChange={event=>{
  const intent=event.target.value;if(!disabled&&(intent===''||intent==='CREATE'||intent==='REVISE'))onChange(bundleRowIntentPatch(current,intent));
 }}><option value="">请选择</option><option value="CREATE">创建新身份</option><option value="REVISE">修订明确既有对象</option></select></label><label>本行治理范围<select disabled={disabled} value={textField(current,'governanceScope')} onChange={event=>{
  const scope=event.target.value;if(!disabled&&(scope===''||scope==='NORTH'||scope==='SOUTH'))onChange({governanceScope:scope||undefined});
 }}><option value="">请选择</option><option>NORTH</option><option>SOUTH</option></select></label><label>准确来源版本<select disabled={disabled} value={selected} onChange={event=>{
  const source=event.target.value;if(!disabled&&(!source||sources.includes(source)))onChange({sourceVersionId:source||undefined});
 }}><option value="">请选择</option>{selected&&!sources.includes(selected)&&<option value={selected} disabled>原清单来源不属于本行契约，请重新选择</option>}{sources.map(source=><option value={source} key={source}>{dataset} 文件契约来源 · {source.slice(-8)}</option>)}</select></label></Group>;
}

export function BundleLicenseIntentField({current,disabled,onChange}:{current:Row;disabled:boolean;onChange:(patch:Row)=>void}){
 const canRevise=textField(current,'intent')==='REVISE'&&!!textField(objectField(current,'target'),'id');
 return <label>证照操作<select disabled={disabled} value={textField(objectField(current,'license'),'intent')} onChange={event=>{
  const intent=event.target.value;if(!disabled&&(intent===''||intent==='CREATE'||(intent==='REVISE'&&canRevise)))onChange(bundleLicenseIntentPatch(current,intent));
 }}><option value="">请选择</option><option value="CREATE">新增证照</option><option value="REVISE" disabled={!canRevise}>修订准确证照</option></select></label>;
}

export function BundleLicenseTargetField({actor,current,disabled,onChange}:{actor:string;current:Row;disabled:boolean;onChange:(patch:Row)=>void}){
 const license=objectField(current,'license'),target=objectField(license,'target'),subjectId=textField(objectField(current,'target'),'id');
 const selected=bundleLicenseSelected(current),hasTarget=license['target']!==undefined;
 const change=(reference:unknown)=>{if(!disabled)onChange({license:{...license,target:reference}});};
 return <><WorkspaceLicenseSelection actor={actor} subjectId={subjectId} disabled={disabled||!subjectId} multiple={false} purpose="CURRENT_REVISION" selected={selected} onChange={references=>{if(subjectId)change(references[0]);}}/>
 {hasTarget&&<p>已选证照修订目标：{textField(target,'id')} · v{textField(target,'version')}</p>}
 <button type="button" className="secondary" disabled={disabled||!hasTarget} onClick={()=>{if(hasTarget)change(undefined);}}>清除证照修订目标</button></>;
}
