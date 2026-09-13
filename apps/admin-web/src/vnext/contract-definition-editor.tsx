import React from 'react';
import type {VNextImportContract,VNextParameterDefinition} from '@hospital-data-intelligence/generated-api-client';

type Definition=VNextImportContract['definition'];
export function ContractDefinitionEditor({definition,onChange,parameters,disabled}:{definition:Definition;onChange:(value:Definition)=>void;parameters:VNextParameterDefinition[];disabled:boolean}){
 const field=(index:number,patch:Partial<Definition['fields'][number]>)=>onChange({...definition,fields:definition.fields.map((value,i)=>i===index?{...value,...patch}:value)});
 const codes=(index:number,patch:Partial<Definition['codeSets'][number]>)=>{
  const updated=definition.codeSets.map((value,i)=>i===index?{...value,...patch}:value);
  onChange({...definition,codeSets:updated,...(patch.codes?{fields:definition.fields.map(value=>value.code===updated[index]?.field?{...value,enumValues:patch.codes!}:value)}:{})});
 };
 const reference=(index:number,value:Definition['references'][number])=>onChange({...definition,references:definition.references.map((old,i)=>i===index?value:old)});
 return <fieldset disabled={disabled}><legend>修订完整定义</legend>
  <p>以当前固定定义为起点另存版本。保留未修改的字段、条件、代码集和引用；原版本不会被覆盖。字段类型与 R/C/O 必须符合固定目录版本。</p>
  <label>固定来源版本 UUID<input value={definition.sourceVersionId??''} onChange={event=>onChange({...definition,sourceVersionId:event.target.value||null})}/></label>
  <h4>字段与条件</h4>{definition.fields.map((value,index)=><div className="editor" key={index}>
   <div className="toolbar"><label>字段代码<input value={value.code} onChange={event=>field(index,{code:event.target.value})}/></label>
   <label>字段类型<select value={value.type} onChange={event=>{const type=(['id','text','date','datetime','integer','decimal','code'] as const).find(type=>type===event.target.value);if(type)field(index,{type});}}>{['id','text','date','datetime','integer','decimal','code'].map(type=><option key={type}>{type}</option>)}</select></label>
   <label>必填属性<select value={value.required} onChange={event=>{const required=(['R','C','O'] as const).find(value=>value===event.target.value);if(required)field(index,{required});}}>{['R','C','O'].map(value=><option key={value}>{value}</option>)}</select></label>
   <label>敏感级别<select value={value.privacy} onChange={event=>{const privacy=(['INTERNAL','RESTRICTED','HIGH_RESTRICTED'] as const).find(value=>value===event.target.value);if(privacy)field(index,{privacy});}}>{['INTERNAL','RESTRICTED','HIGH_RESTRICTED'].map(value=><option key={value}>{value}</option>)}</select></label>
   <label>条件状态<select value={value.condition} onChange={event=>{const condition=(['ALWAYS','OPTIONAL','UNRESOLVED','MANUAL_EVIDENCE'] as const).find(value=>value===event.target.value);if(condition)field(index,{condition});}}>{['ALWAYS','OPTIONAL','UNRESOLVED','MANUAL_EVIDENCE'].map(value=><option key={value}>{value}</option>)}</select></label>
   <button type="button" onClick={()=>onChange({...definition,fields:definition.fields.filter((_,i)=>i!==index)})}>移除字段 {value.code}</button></div>
   <small>枚举值由下方对应代码集维护。FULL 缺少目录字段会被服务端拒绝。</small>
  </div>)}
  <button type="button" onClick={()=>onChange({...definition,fields:[...definition.fields,{code:'',type:'text',required:'O',privacy:'INTERNAL',condition:'OPTIONAL',enumValues:[]}]})}>添加目录字段</button>
  <h4>代码集采纳</h4>{definition.codeSets.map((value,index)=><div className="editor" key={index}><div className="toolbar">
   <label>代码集字段<input value={value.field} onChange={event=>codes(index,{field:event.target.value})}/></label>
   <label>代码系统<input value={value.codeSystem} onChange={event=>codes(index,{codeSystem:event.target.value})}/></label>
   <label>代码集版本<input value={value.version} onChange={event=>codes(index,{version:event.target.value})}/></label>
   <label>采纳状态<select value={value.status} onChange={event=>codes(index,{status:event.target.value==='SYNTHETIC_ADOPTED'?'SYNTHETIC_ADOPTED':'CANDIDATE'})}><option value="CANDIDATE">候选（阻断发布）</option><option value="SYNTHETIC_ADOPTED">仅合成采纳</option></select></label>
   <label>代码值（逗号分隔）<input value={value.codes.join(',')} onChange={event=>codes(index,{codes:event.target.value?event.target.value.split(','):[]})}/></label>
   <label>代码集来源版本<input value={value.sourceVersionId} onChange={event=>codes(index,{sourceVersionId:event.target.value})}/></label>
   <label>代码集开始<input value={value.validFrom} onChange={event=>codes(index,{validFrom:event.target.value})}/></label>
   <label>代码集结束<input value={value.validTo??''} onChange={event=>codes(index,{validTo:event.target.value||null})}/></label>
   <button type="button" onClick={()=>onChange({...definition,codeSets:definition.codeSets.filter((_,i)=>i!==index),fields:definition.fields.map(field=>field.code===value.field?{...field,enumValues:[]}:field)})}>移除代码集 {value.field}</button>
  </div></div>)}
  <button type="button" onClick={()=>onChange({...definition,codeSets:[...definition.codeSets,{field:'',codeSystem:'SYNTHETIC_CODES',version:definition.ruleVersion,status:'CANDIDATE',codes:[],sourceVersionId:definition.sourceVersionId??'',validFrom:'2026-01-01T00:00:00',validTo:null}]})}>添加代码集</button>
  <h4>固定引用</h4>{definition.references.map((value,index)=><div className="editor" key={index}><div className="toolbar">
   <label>引用字段<input value={value.field} onChange={event=>reference(index,{...value,field:event.target.value})}/></label>
   <label>引用目标<input value={value.target} onChange={event=>reference(index,{field:value.field,target:event.target.value,status:'BLOCKED_DEPENDENCY'})}/></label>
   {value.target==='GOV09.config_id'&&<label>固定参数定义<select value={value.status==='DECLARED_PARAMETER'?value.parameterVersionId:''} onChange={event=>{const parameter=parameters.find(parameter=>parameter.versionId===event.target.value);reference(index,parameter?{field:value.field,target:'GOV09.config_id',status:'DECLARED_PARAMETER',parameterVersionId:parameter.versionId,parameterDigest:parameter.reviewDigest}:{field:value.field,target:value.target,status:'BLOCKED_DEPENDENCY'});}}>
    <option value="">未绑定（依赖未就绪）</option>{value.status==='DECLARED_PARAMETER'&&!parameters.some(parameter=>parameter.versionId===value.parameterVersionId)&&<option value={value.parameterVersionId}>原固定版本 {value.parameterVersionId}</option>}{parameters.map(parameter=><option key={parameter.versionId} value={parameter.versionId}>{parameter.parameterKey} · v{parameter.version} · {parameter.ownerRole}</option>)}
   </select></label>}
   <button type="button" onClick={()=>onChange({...definition,references:definition.references.filter((_,i)=>i!==index)})}>移除引用 {value.field}</button>
  </div><small>{value.status==='DECLARED_PARAMETER'?value.parameterDigest:'BLOCKED_DEPENDENCY'}</small></div>)}
  <button type="button" onClick={()=>onChange({...definition,references:[...definition.references,{field:'',target:'GOV09.config_id',status:'BLOCKED_DEPENDENCY'}]})}>添加引用</button>
  <h4>来源条件规则</h4>{definition.rules.map((value,index)=><div className="editor" key={index}><strong>{value.id} · {value.field} · {value.status}</strong><label>原条件文本<textarea value={value.text} onChange={event=>onChange({...definition,rules:definition.rules.map((rule,i)=>i===index?{...rule,text:event.target.value}:rule)})}/></label></div>)}
  <p>未解析规则仍阻断发布。可在<a href="/admin/vnext/parameter-definitions">参数定义维护页</a>批准定义后，重新打开契约以刷新可选版本。</p>
 </fieldset>;
}
