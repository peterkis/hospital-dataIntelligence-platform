import {useState} from 'react';
import {WorkspaceLicenseSelection} from './workspace-reference-fields.js';
import {textField,objectField} from './workspace-fields.js';
type Reference={owner:'organization-master/license';id:string;version:string;versionId:string};

/** Pending additions are not saved scope selections. Each saved card below is authoritative. */
export function BundleScopeLicenseAdder({actor,subjectId,disabled,onAdd}:{actor:string;subjectId:string;disabled:boolean;onAdd:(reference:Reference)=>void}){
 const [pending,setPending]=useState<Reference|null>(null);
 return <section><h4>追加证照范围核验</h4><p>先选择准确证照，再追加；已有范围的证照见各自卡片。</p>
  <WorkspaceLicenseSelection actor={actor} subjectId={subjectId} disabled={disabled} multiple={false} selected={pending?[pending]:[]} onChange={refs=>{if(!disabled)setPending(refs[0]??null);}}/>
  <button type="button" disabled={disabled||!pending} onClick={()=>{if(disabled||!pending)return;onAdd(pending);setPending(null);}}>追加所选证照范围</button>
 </section>;
}
export function BundleScopeLicenseSummary({scope}:{scope:Record<string,unknown>}){
 const license=objectField(scope,'license');
 if(textField(license,'kind')==='ROW_LICENSE'){
  const subject=objectField(license,'subject');
  return <div data-scope-license="ROW_LICENSE"><p>证照依据：本工作簿主体证照（提交时解析，不是平台既有证照版本）</p><dl>
   <dt>主体引用方式</dt><dd>{textField(subject,'kind')||'未填写'}</dd>
   <dt>主体数据集</dt><dd>{textField(subject,'dataset')||'未填写'}</dd>
   <dt>主体别名 / ID</dt><dd>{textField(subject,'alias')||textField(subject,'id')||'未填写'}</dd>
  </dl></div>;
 }
 const owner=textField(license,'owner'),id=textField(license,'id'),version=textField(license,'version'),versionId=textField(license,'versionId');
 return <div data-scope-license="EXACT"><p>已保存的准确证照依据</p><dl>
  <dt>Owner</dt><dd>{owner||'未填写'}</dd><dt>证照 ID</dt><dd>{id||'未填写'}</dd>
  <dt>证照版本</dt><dd>{version?'v'+version:'未填写'}</dd><dt>版本 ID</dt><dd>{versionId||'未填写'}</dd>
 </dl>{(owner!=='organization-master/license'||!id||!version||!versionId)&&<p role="alert">证照引用不完整；请移除此项并明确重新选择，不会自动采用最新版本。</p>}</div>;
}
