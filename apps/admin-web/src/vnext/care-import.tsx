import {useEffect,useId,useRef,useState} from 'react';
import {createCareWorkspaceClient,type CareOperation} from '@hospital-data-intelligence/generated-api-client';
import type {FormSchema,ReferenceChoices} from './department-form.js';
import {fieldLabels,initialForm,fixedForm} from './department-form.js';
import {CareForm,careFieldLabels} from './care-form.js';
import {CareOperationPanel,CareFacts,downloadCareBytes} from './care-operation.js';
import {carePipelines,careSchema,careNames,careDatasets,record,text,type CareKind} from './care-model.js';
import {careRequestIds,careError,useCareLocator,newCareRequest} from './care-request.js';
import {departmentValue,definiteFailure} from './department-request.js';
import {encodeWorkbenchFile,MAX_RAW_FILE_BYTES} from './workbench-file.js';
import './care-import.css';

const parsers:Record<Exclude<CareKind,'LIFECYCLE'>,string>={UNIT:'STRICT_UNIT_V1',NURSING:'STRICT_NURSING_V1',WARD:'STRICT_WARD_V1',LOCATION:'STRICT_LOCATION_V1',UNIT_WARD:'STRICT_UNIT_WARD_V1',WARD_NURSING:'STRICT_WARD_NURSING_V1',LOCATION_USE:'STRICT_LOCATION_USE_V1',CAPABILITY:'STRICT_CAPABILITY_V1',PERMISSION:'STRICT_SUBJECT_PERMISSION_V1'};
export interface SavedCareFile {requestId:string;body:{input:Record<string,unknown>;contentBase64:string}}
export interface CareFileIssueLocation {draftId:string;sourceArtifactId:string;row:string;field:string}
interface FileCommand {id:string;expectedVersion:string;requestId:string}
const issueMessages:Record<string,string>={
 INVALID_UTF8:'文件不是有效的 UTF-8 编码，请另存为 UTF-8 后重新上传。',
 CSV_SYNTAX:'CSV 引号或分隔格式有误，请检查该行的逗号、双引号与换行。',
 HEADER_MISMATCH:'文件列与模板不一致，请按当前模板核对列名及顺序。',
 HEADER_REQUIRED:'缺少表头，请使用当前模板保留完整表头。',
 COLUMN_MISMATCH:'这一行的列数与表头不一致，请检查空单元格及分隔符。',
 ROW_LIMIT:'数据行数超过当前解析限制，请减少本次文件的行数。',
 COLUMN_LIMIT:'文件列数超过当前解析限制，请检查表头。',
 CELL_LIMIT:'单元格内容过长，请缩短该字段。',
 BATCH_CONFLICT:'文件数据行数与维护动作条目不一致，请按原文件顺序逐条核对。',
 CLOSED_INPUT_REQUIRED:'维护信息不完整或不符合当前模板，请补齐动作、关联与依据。',
 CLOSED_FILE_REQUIRED:'文件内容或格式不符合当前模板，请重新选择支持的文件。',
 DUPLICATE_KEY:'文件中出现重复业务键，请核对是否为同一条记录。',
 INVALID_BUSINESS_PERIOD:'生效期间无效，请检查开始时间与结束时间。',
 STALE_REVISION:'该任务已有新修订。当前文件与输入已保留，请核对最新任务后继续。',
 LEGAL_REVIEW_REQUIRED:'需要独立核验资料与依据，请进入原申请继续处理。',
};
export const careImportIssueMessage=(code:unknown):string=>issueMessages[text(code)]??'未通过服务端检查。请核对对应字段与模板；如仍无法解决，可展开检查详情。';
/** Reception and staging are not publication; absent row totals must not be inferred. */
export function careImportReceiptState(value:unknown):{label:string;tone:'success'|'warning'|'danger';inputId:string;issues:Record<string,unknown>[]} {
 const receipt=record(value),issues=Array.isArray(receipt['issues'])?receipt['issues'].map(record):[],inputId=text(record(receipt['input'])['inputId']);
 if(receipt['structuralStatus']==='REJECTED')return {label:'文件结构未通过',tone:'danger',inputId,issues};
 if(issues.length)return {label:'预检发现待修正问题',tone:'danger',inputId,issues};
 if(receipt['structuralStatus']==='PARSED'&&inputId)return {label:'文件已接收，申请已暂存',tone:'success',inputId,issues};
 return {label:'接收结果待核对',tone:'warning',inputId,issues};
}
/** Escape report cells without modifying the protected original file. */
export function careImportIssuesCsv(issues:Record<string,unknown>[],worksheet:string):string {
 const cell=(value:unknown)=>{const raw=text(value),safe=/^[\s\u0000-\u001f]*[=+@-]/.test(raw)?"'"+raw:raw;return '"'+safe.replaceAll('"','""')+'"';};
 return '\uFEFF'+[['工作表','原始行号','字段','问题说明','检查代码'],...issues.map(issue=>[worksheet,text(issue['row'])==='0'?'整批':issue['row'],careFieldLabels[text(issue['field'])]??fieldLabels[text(issue['field'])]??issue['field'],careImportIssueMessage(issue['code']),issue['code']])].map(row=>row.map(cell).join(',')).join('\r\n');
}
function templateFields(file:CareOperation):FormSchema {
 const stage=file.replace(/^receive/,'stage').replace(/File$/,'Input') as CareOperation,entries=careSchema(stage).properties?.['entries']?.items;
 return (entries?.anyOf?.find(branch=>branch.properties?.['row'])??entries)?.properties?.['row']??{};
}
function fieldRule(schema:FormSchema):string {
 if(schema.enum)return '允许值：'+schema.enum.map(text).join('、');
 if(schema.type==='integer')return '整数'+(schema.minimum!==undefined?'，最小 '+schema.minimum:'');
 return (schema.minLength||schema.pattern?'需填写':'可留空')+(schema.maxLength?'，最多 '+schema.maxLength+' 字符':'');
}
export function CareImport({actor,kind,campus,transport,payload,choices,onInput,onLock,onRequest,savedFile,savedIdentity,issueLocation}:{actor:string;kind:CareKind;campus:string;transport:{contractId:string;contractVersionId:string}|undefined;payload:unknown;choices:ReferenceChoices;onInput:(inputId:string)=>void;onLock:(locked:boolean)=>void;onRequest:(body:Record<string,unknown>)=>Promise<FileCommand>;savedFile:SavedCareFile|undefined;savedIdentity:{id:string;version:string}|undefined;issueLocation?:CareFileIssueLocation|undefined}){
 const careLocator=useCareLocator();
 const file=carePipelines[kind].file,workspace=createCareWorkspaceClient(location.origin,actor),fileId=useId();
 const [body,setBody]=useState<Record<string,unknown>>({}),[received,setReceived]=useState<Record<string,unknown>|null>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState('');
 const pending=useRef<Record<string,unknown>|null>(null),pendingMode=useRef<'SAVE'|'RECEIVE'|null>(null),generation=useRef(0),restored=useRef<{command:FileCommand;body:Record<string,unknown>}|null>(null),editor=useRef<HTMLDetailsElement|null>(null);
 const [issue,setIssue]=useState<Record<string,unknown>|null>(null);
 const [filename,setFilename]=useState(''),[readingFile,setReadingFile]=useState(false),[priorReceipt,setPriorReceipt]=useState<Record<string,unknown>|null>(null),fileControl=useRef<HTMLInputElement|null>(null);
 useEffect(()=>()=>{generation.current++;},[]);
 useEffect(()=>{if(busy||pending.current)return;restored.current=null;setReceived(null);setIssue(null);setUncertain(false);setDirty(false);setError('');setPriorReceipt(null);setFilename('');},[savedIdentity?.id,savedFile?.requestId]);
 useEffect(()=>{if(!file||kind==='LIFECYCLE'||busy||dirty||pending.current)return;
  const operations=Array.isArray(record(payload)['entries'])?(record(payload)['entries'] as unknown[]).map(value=>{const {row:_row,...operation}=record(value);return operation;}):[];
  setBody(savedFile?.body??{...record(initialForm(careSchema(file))),input:{campus,timePolicy:'LOCAL',retentionSeconds:7200,job:{action:'CREATE',...transport,profile:'CORE',scope:'SYNTHETIC',reason:'CARE_WORKSPACE',input:{kind:'FILE',format:'CSV',parserPolicy:parsers[kind]}},operations},contentBase64:''});
 },[file,transport?.contractVersionId,payload,savedFile]);
 useEffect(()=>{if(!savedFile||!savedIdentity||busy||dirty||pending.current)return;const token=generation.current;let active=true;
  const url=new URL(location.href),sameDraft=url.searchParams.get('draft')===savedIdentity.id,requestId=(sameDraft?url.searchParams.get('fileRequest'):null)??savedFile.requestId,expectedVersion=(sameDraft?url.searchParams.get('fileVersion'):null)??savedIdentity.version,command={id:savedIdentity.id,expectedVersion,requestId};restored.current=null;setReceived(null);setIssue(null);
  void (async()=>{try{const frame=await departmentValue(workspace.savedFile(command));if(!active||token!==generation.current)return;if(frame.kind!==kind||frame.campus!==campus)throw new Error('原文件工作区不匹配。');restored.current={command,body:frame.file.body};setBody(frame.file.body);const receipt=await departmentValue(workspace.fileReceipt(command));if(!active||token!==generation.current)return;setReceived(receipt);setError(receipt?'已恢复服务器原文件接收回执和原问题。':'原接收请求尚无已保存回执，可以继续同一请求。');}catch(error){if(active&&token===generation.current)setError(careError(error));}})();return()=>{active=false;};
 },[savedFile?.requestId,savedIdentity?.id,savedIdentity?.version]);
 useEffect(()=>{onLock(busy||readingFile||uncertain||dirty);},[busy,readingFile,uncertain,dirty]);
 useEffect(()=>{if(!issueLocation||busy||uncertain||savedIdentity?.id!==issueLocation.draftId||received?.['sourceArtifactId']!==issueLocation.sourceArtifactId||!editor.current)return;editor.current.open=true;setIssue({row:issueLocation.row,field:issueLocation.field});editor.current.querySelector<HTMLButtonElement>('button[data-care-file-revision]:not([disabled])')?.focus();},[issueLocation,received,busy,uncertain,savedIdentity?.id]);
 if(!file||kind==='LIFECYCLE')return null;
 const schema=careSchema(file),inputSchema=schema.properties?.['input']??{},input=record(body['input']),job=record(input['job']),format=text(record(job['input'])['format'])||'CSV',hasFile=!!text(body['contentBase64']),locked=busy||readingFile||uncertain||!!received;
 const fields=templateFields(file),operations=Array.isArray(input['operations'])?input['operations']:[],maxOperations=inputSchema.properties?.['operations']?.maxItems;
 const visibleSchema={...inputSchema,properties:Object.fromEntries(Object.entries(inputSchema.properties??{}).filter(([key])=>!['requestId','fileRequestId','job','campus','retentionSeconds'].includes(key)))};
 const receipt=received?careImportReceiptState(received):null,activeStep=received?3:hasFile?2:1;
 const updateBody=(value:Record<string,unknown>)=>{restored.current=null;setBody(record(newCareRequest(value)));setDirty(true);setReceived(null);setError('');};
 async function selectFile(selected:File|undefined){
  if(!selected)return;const extension=selected.name.split('.').at(-1)?.toUpperCase();
  if(!['CSV','JSON','XLSX'].includes(extension??'')){setError('请选择 CSV、JSON 或 XLSX 文件。原先选择的文件仍保留。');return;}
  const token=generation.current;setReadingFile(true);setError('');
  try{const bytes=await encodeWorkbenchFile(selected);if(token!==generation.current)return;updateBody({...body,contentBase64:bytes,input:{...input,job:{...job,input:{...record(job['input']),kind:'FILE',format:extension,parserPolicy:parsers[kind as Exclude<CareKind,'LIFECYCLE'>]}}}});setFilename(selected.name);}
  catch{if(token===generation.current)setError('文件读取失败：请确认文件非空且不超过 1 MiB。原先选择的文件仍保留。');}
  finally{if(token===generation.current)setReadingFile(false);}
 }
 async function saveEditing(){const replay=!!pending.current,token=generation.current,input=pending.current??record(careRequestIds(careSchema(file!),body));pending.current=input;pendingMode.current='SAVE';setBody(input);setBusy(true);setError('');try{const command=await onRequest(input);if(token!==generation.current)return;restored.current={command,body:input};pending.current=null;pendingMode.current=null;setDirty(false);setUncertain(false);onLock(false);careLocator({fileRequest:command.requestId,fileVersion:command.expectedVersion});setError('已保存不完整导入草稿；接收时仍需完整原 Owner 契约。');}catch(error){if(token===generation.current){const unknown=replay||!definiteFailure(error);setUncertain(unknown);if(!unknown){pending.current=null;pendingMode.current=null;}setError(careError(error));}}finally{if(token===generation.current)setBusy(false);}}
 async function receive(){const replay=!!pending.current,token=generation.current,input=pending.current??record(careRequestIds(careSchema(file!),fixedForm(careSchema(file!),body)));pending.current=input;pendingMode.current='RECEIVE';setBody(input);setBusy(true);setError('');
  try{const original=restored.current,command=original&&JSON.stringify(original.body)===JSON.stringify(input)?original.command:await onRequest(input);restored.current={command,body:input};careLocator({fileRequest:command.requestId,fileVersion:command.expectedVersion});const value=await departmentValue(workspace.receiveFile(command));if(token!==generation.current)return;setReceived(record(value));pending.current=null;setUncertain(false);setDirty(false);onLock(false);if(value.input)onInput(value.input.inputId);}
  catch(error){if(token===generation.current){const unknown=replay||!definiteFailure(error);setUncertain(unknown);if(!unknown)pending.current=null;setError(careError(error)+(unknown?' 原请求已保留，刷新后可从服务器恢复。':''));}}
  finally{if(token===generation.current)setBusy(false);}
 }
 function revise(){if(!received)return;restored.current=null;setPriorReceipt(received);const input=record(body['input']),{contractId:_contract,contractVersionId:_version,profile:_profile,...job}=record(input['job']);setBody(record(newCareRequest({...body,input:{...input,job:{...job,action:'REVISE',jobId:received['jobId'],expectedCurrentRevision:received['revisionId']}}})));setReceived(null);setDirty(true);setError('请重新选择修正后的文件，再次接收预检。新结果将追加为修订，原文件和原问题保留。');requestAnimationFrame(()=>fileControl.current?.focus());}
 function locateIssue(item:Record<string,unknown>){setIssue(item);if(editor.current){editor.current.open=true;editor.current.querySelector<HTMLButtonElement>('button[data-care-file-revision]:not([disabled])')?.focus();}}
 return <details ref={editor} data-care-import className="care-import"><summary>导入 {careNames[kind]} · CSV / Excel</summary>
  <div className="care-import-content">
   <p className="care-import-intro">按当前模板上传，检查原行问题，再进入申请完成独立核验与审批。</p>
   <ol className="care-import-steps" aria-label="导入流程">{['选择文件','核对字段与动作','接收与预检','核验、审批与提交'].map((label,index)=><li key={label} aria-current={activeStep===index+1?'step':undefined}><span>{index+1}</span>{label}</li>)}</ol>
   <section className="care-import-section" aria-labelledby={fileId+'-title'}>
    <h3 id={fileId+'-title'}>1. 选择文件</h3>
    <p>导入对象：{careNames[kind]} · {campus==='NORTH'?'北院区':campus==='SOUTH'?'南院区':campus}。支持 CSV、XLSX 和 JSON，单文件不超过 {MAX_RAW_FILE_BYTES/1024/1024} MiB{maxOperations?'，最多 '+maxOperations+' 条维护动作':''}。</p>
    {transport&&<details className="care-import-template"><summary>下载当前对象模板</summary><CareOperationPanel key={transport.contractVersionId} actor={actor} operation="downloadImportTemplate" label="下载准确契约模板" initial={{contractId:transport.contractId,versionId:transport.contractVersionId,format:'CSV'}} choices={choices} omitFormFields={['contractId','versionId']}/></details>}
    <label className="care-import-file" htmlFor={fileId}>导入原文件<input ref={fileControl} id={fileId} type="file" accept=".csv,.xlsx,.json" disabled={locked} onChange={event=>{void selectFile(event.target.files?.[0]);event.target.value='';}}/></label>
    <p className="care-import-file-status" role="status">{readingFile?'正在读取文件…':hasFile?(filename||'已恢复的原文件')+' · '+format+' · '+(dirty?'尚有未保存内容':'当前文件已保存到草稿'):'尚未选择文件'}</p>
    <p className="care-import-help">CSV 使用 UTF-8 编码、逗号分隔，第 1 行为表头。业务 Excel 模板的第 3 行为字段表头、第 4 行起为数据，使用 {careDatasets[kind]} 工作表。业务编码请保留文本格式和前导零。</p>
   </section>
   <section className="care-import-section" aria-labelledby={fileId+'-fields'}>
    <h3 id={fileId+'-fields'}>2. 核对字段与维护动作</h3>
    <p>列名和顺序按模板匹配。下方动作按文件数据行顺序逐条对应，当前共 {operations.length} 条。接收后以服务端检查结果为准。</p>
    <details className="care-import-field-guide"><summary>查看模板字段与填写要求</summary><div className="care-import-table-scroll"><table><caption>{careDatasets[kind]} 字段对照（模板要求）</caption><thead><tr><th scope="col">文件列名</th><th scope="col">业务字段</th><th scope="col">填写要求</th></tr></thead><tbody>{Object.entries(fields.properties??{}).map(([key,field])=><tr key={key}><td><code>{key}</code></td><td>{careFieldLabels[key]??fieldLabels[key]??key}</td><td>{fieldRule(field)}</td></tr>)}</tbody></table></div><p className="care-import-help">当前接收接口不提供逐格预览或自动列映射。此表仅说明模板字段；不能代替文件的服务端预检。</p></details>
    {job['action']==='CREATE'&&<label className="care-import-profile">校验范围<select disabled={locked} value={text(job['profile'])||'CORE'} onChange={event=>updateBody({...body,input:{...input,job:{...job,profile:event.target.value}}})}><option value="CORE">核心字段</option><option value="FULL">完整字段与依赖</option></select></label>}
    <details className="care-import-actions-editor"><summary>维护动作与关联信息 · {operations.length} 条</summary><CareForm schema={visibleSchema} value={input} onChange={value=>updateBody({...body,input:record(value)})} choices={choices} disabled={locked}/></details>
    <details className="care-import-technical"><summary>高级：文件保留设置与任务依据</summary><CareForm schema={{type:'object',properties:{retentionSeconds:inputSchema.properties?.['retentionSeconds']??{type:'integer'}}}} value={input} onChange={value=>updateBody({...body,input:record(value)})} choices={choices} disabled={locked}/><CareFacts value={{campus:input['campus'],job}}/></details>
   </section>
   {priorReceipt&&<aside className="care-import-notice" aria-label="修正轨迹"><strong>正在修正原任务</strong><p>原文件有 {careImportReceiptState(priorReceipt).issues.length} 项问题。修改后的文件将建立新修订并重新检查；原结果仍保留。</p><details><summary>查看上次问题</summary><CareFacts value={priorReceipt}/></details></aside>}
   {issue&&<p className="care-import-notice" role="status">待修正位置：{text(received?.['worksheet']??priorReceipt?.['worksheet'])||'原文件'} · {text(issue['row'])==='0'?'整批':'原始行 '+text(issue['row'])} · {careFieldLabels[text(issue['field'])]??fieldLabels[text(issue['field'])]??(text(issue['field'])||'整行')}。请修正原文件后重新上传。</p>}
   <div className="care-import-actions">
    <button disabled={busy||readingFile||uncertain&&pendingMode.current!=='SAVE'||!!received} onClick={()=>void saveEditing()}>{uncertain&&pendingMode.current==='SAVE'?'恢复同一导入草稿保存请求':'保存不完整导入草稿'}</button>
    <button className="care-import-primary" disabled={busy||readingFile||uncertain&&pendingMode.current==='SAVE'||(!transport&&!savedFile)||!!received||!hasFile} onClick={()=>void receive()}>{busy?'正在处理…':uncertain?'恢复同一接收请求':'保存文件并接收预检'}</button>
   </div>
   {uncertain&&<p className="care-import-notice" role="alert"><strong>结果待确认</strong>：请求可能已经到达服务器。编辑已暂时锁定，请恢复同一请求查询结果，勿新建重复任务。</p>}
   {error&&<p className="care-import-feedback" role={uncertain?'alert':'status'}>{error}</p>}
   {received&&receipt&&<section className="care-import-section care-import-receipt" aria-labelledby={fileId+'-receipt'}>
    <h3 id={fileId+'-receipt'}>3. 服务端预检结果</h3>
    <p role="status"><span className={'care-import-status care-import-status-'+receipt.tone}>{receipt.label}</span> · {receipt.issues.length} 项待处理问题</p>
    {receipt.inputId?<p>候选申请已暂存，尚未正式发布。请进入原申请查看业务校验结果，并由有权限的人员独立核验、审批与提交。</p>:<p>尚未形成可继续处理的申请。请按问题修正原文件和维护动作，再以新修订重新预检。</p>}
    {receipt.issues.length>0&&<><div className="care-import-table-scroll"><table className="care-import-issues"><caption>原文件问题 · {text(received['worksheet'])||'单表来源'}</caption><thead><tr><th scope="col">原始行</th><th scope="col">字段</th><th scope="col">问题与修正提示</th><th scope="col">操作</th></tr></thead><tbody>{receipt.issues.map((item,index)=><tr key={index}><td>{Number(item['row'])>0?text(item['row']):'整批'}</td><td>{careFieldLabels[text(item['field'])]??fieldLabels[text(item['field'])]??(text(item['field'])||'整行')}</td><td>{careImportIssueMessage(item['code'])}<details><summary>检查详情</summary><code>{text(item['code'])}</code></details></td><td><button disabled={busy} onClick={()=>locateIssue(item)}>定位修正</button></td></tr>)}</tbody></table></div><button onClick={()=>downloadCareBytes(btoa(String.fromCharCode(...new TextEncoder().encode(careImportIssuesCsv(receipt.issues,text(received['worksheet']))))),'导入问题.csv')}>下载问题清单</button></>}
    <div className="care-import-actions"><button data-care-file-revision disabled={busy} onClick={revise}>以新修订纠正原文件</button>{receipt.inputId&&<button className="care-import-primary" onClick={()=>onInput(receipt.inputId)}>进入准确原申请</button>}</div>
    <details className="care-import-technical"><summary>查看原接收回执与任务标识</summary><CareFacts value={received}/></details>
   </section>}
  </div>
 </details>;
}
