import {useEffect,useRef,useState} from 'react';
import {createCareWorkspaceClient} from '@hospital-data-intelligence/generated-api-client';
import type {ReferenceChoices} from './department-form.js';
import {initialForm,fixedForm} from './department-form.js';
import {CareForm} from './care-form.js';
import {CareOperationPanel,CareFacts} from './care-operation.js';
import {carePipelines,careSchema,record,text,type CareKind} from './care-model.js';
import {careRequestIds,careError,careLocator,newCareRequest} from './care-request.js';
import {departmentValue,definiteFailure} from './department-request.js';

const parsers:Record<Exclude<CareKind,'LIFECYCLE'>,string>={UNIT:'STRICT_UNIT_V1',NURSING:'STRICT_NURSING_V1',WARD:'STRICT_WARD_V1',LOCATION:'STRICT_LOCATION_V1',UNIT_WARD:'STRICT_UNIT_WARD_V1',WARD_NURSING:'STRICT_WARD_NURSING_V1',LOCATION_USE:'STRICT_LOCATION_USE_V1',CAPABILITY:'STRICT_CAPABILITY_V1',PERMISSION:'STRICT_SUBJECT_PERMISSION_V1'};
export interface SavedCareFile {requestId:string;body:{input:Record<string,unknown>;contentBase64:string}}
export interface CareFileIssueLocation {draftId:string;sourceArtifactId:string;row:string;field:string}
interface FileCommand {id:string;expectedVersion:string;requestId:string}
export function CareImport({actor,kind,campus,transport,payload,choices,onInput,onLock,onRequest,savedFile,savedIdentity,issueLocation}:{actor:string;kind:CareKind;campus:string;transport:{contractId:string;contractVersionId:string}|undefined;payload:unknown;choices:ReferenceChoices;onInput:(inputId:string)=>void;onLock:(locked:boolean)=>void;onRequest:(body:Record<string,unknown>)=>Promise<FileCommand>;savedFile:SavedCareFile|undefined;savedIdentity:{id:string;version:string}|undefined;issueLocation?:CareFileIssueLocation|undefined}){
 const file=carePipelines[kind].file,workspace=createCareWorkspaceClient(location.origin,actor);
 const [body,setBody]=useState<Record<string,unknown>>({}),[received,setReceived]=useState<Record<string,unknown>|null>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState('');
 const pending=useRef<Record<string,unknown>|null>(null),pendingMode=useRef<'SAVE'|'RECEIVE'|null>(null),generation=useRef(0),restored=useRef<{command:FileCommand;body:Record<string,unknown>}|null>(null),editor=useRef<HTMLDetailsElement|null>(null);
 const [issue,setIssue]=useState<Record<string,unknown>|null>(null);
 useEffect(()=>()=>{generation.current++;},[]);
 useEffect(()=>{if(busy||pending.current)return;restored.current=null;setReceived(null);setIssue(null);setUncertain(false);setDirty(false);setError('');},[savedIdentity?.id,savedFile?.requestId]);
 useEffect(()=>{if(!file||kind==='LIFECYCLE'||busy||dirty||pending.current)return;
  const operations=Array.isArray(record(payload)['entries'])?(record(payload)['entries'] as unknown[]).map(value=>{const {row:_row,...operation}=record(value);return operation;}):[];
  setBody(savedFile?.body??{...record(initialForm(careSchema(file))),input:{campus,timePolicy:'LOCAL',retentionSeconds:7200,job:{action:'CREATE',...transport,scope:'SYNTHETIC',reason:'CARE_WORKSPACE',input:{kind:'FILE',format:'CSV',parserPolicy:parsers[kind]}},operations},contentBase64:''});
 },[file,transport?.contractVersionId,payload,savedFile]);
 useEffect(()=>{if(!savedFile||!savedIdentity||busy||dirty||pending.current)return;const token=generation.current;let active=true;
  const url=new URL(location.href),sameDraft=url.searchParams.get('draft')===savedIdentity.id,requestId=(sameDraft?url.searchParams.get('fileRequest'):null)??savedFile.requestId,expectedVersion=(sameDraft?url.searchParams.get('fileVersion'):null)??savedIdentity.version,command={id:savedIdentity.id,expectedVersion,requestId};restored.current=null;setReceived(null);setIssue(null);
  void (async()=>{try{const frame=await departmentValue(workspace.savedFile(command));if(!active||token!==generation.current)return;if(frame.kind!==kind||frame.campus!==campus)throw new Error('原文件工作区不匹配。');restored.current={command,body:frame.file.body};setBody(frame.file.body);const receipt=await departmentValue(workspace.fileReceipt(command));if(!active||token!==generation.current)return;setReceived(receipt);setError(receipt?'已恢复服务器原文件接收回执和原问题。':'原接收请求尚无已保存回执，可以继续同一请求。');}catch(error){if(active&&token===generation.current)setError(careError(error));}})();return()=>{active=false;};
 },[savedFile?.requestId,savedIdentity?.id,savedIdentity?.version]);
 useEffect(()=>{onLock(busy||uncertain||dirty);},[busy,uncertain,dirty]);
 useEffect(()=>{if(!issueLocation||busy||uncertain||savedIdentity?.id!==issueLocation.draftId||received?.['sourceArtifactId']!==issueLocation.sourceArtifactId||!editor.current)return;editor.current.open=true;editor.current.querySelector<HTMLButtonElement>('button[data-care-file-revision]:not([disabled])')?.focus();},[issueLocation,received,busy,uncertain,savedIdentity?.id]);
 if(!file||kind==='LIFECYCLE')return null;
 async function saveEditing(){const replay=!!pending.current,token=generation.current,input=pending.current??record(careRequestIds(careSchema(file!),body));pending.current=input;pendingMode.current='SAVE';setBody(input);setBusy(true);setError('');try{const command=await onRequest(input);if(token!==generation.current)return;restored.current={command,body:input};pending.current=null;pendingMode.current=null;setDirty(false);setUncertain(false);onLock(false);careLocator({fileRequest:command.requestId,fileVersion:command.expectedVersion});setError('已保存不完整导入草稿；接收时仍需完整原 Owner 契约。');}catch(error){if(token===generation.current){const unknown=replay||!definiteFailure(error);setUncertain(unknown);if(!unknown){pending.current=null;pendingMode.current=null;}setError(careError(error));}}finally{if(token===generation.current)setBusy(false);}}
 async function receive(){const replay=!!pending.current,token=generation.current,input=pending.current??record(careRequestIds(careSchema(file!),fixedForm(careSchema(file!),body)));pending.current=input;pendingMode.current='RECEIVE';setBody(input);setBusy(true);setError('');
  try{const original=restored.current,command=original&&JSON.stringify(original.body)===JSON.stringify(input)?original.command:await onRequest(input);restored.current={command,body:input};careLocator({fileRequest:command.requestId,fileVersion:command.expectedVersion});const value=await departmentValue(workspace.receiveFile(command));if(token!==generation.current)return;setReceived(record(value));pending.current=null;setUncertain(false);setDirty(false);onLock(false);if(value.input)onInput(value.input.inputId);}
  catch(error){if(token===generation.current){const unknown=replay||!definiteFailure(error);setUncertain(unknown);if(!unknown)pending.current=null;setError(careError(error)+(unknown?' 原请求已保留，刷新后可从服务器恢复。':''));}}
  finally{if(token===generation.current)setBusy(false);}
 }
 function revise(){if(!received)return;restored.current=null;const input=record(body['input']),{contractId:_contract,contractVersionId:_version,profile:_profile,...job}=record(input['job']);setBody(record(newCareRequest({...body,input:{...input,job:{...job,action:'REVISE',jobId:received['jobId'],expectedCurrentRevision:received['revisionId']}}})));setReceived(null);setDirty(true);setError('纠错将追加新修订，原文件和原问题保留。');}
 return <details ref={editor} data-care-import><summary>导入 CSV／JSON／XLSX</summary><p>准确来源文件、维护动作和原请求先保存到私有服务器草稿。接收、预检、独立核验和审批分别执行。</p>
  {issue&&<p role="status">来源定位：{text(received?.['worksheet'])||'单表来源'} · 原始行 {text(issue['row'])||'整包'} · 字段 {text(issue['field'])||'整行'}。纠正原文件后，以新修订接收；原文件和原问题保留。</p>}
  {transport&&<CareOperationPanel key={transport.contractVersionId} actor={actor} operation="downloadImportTemplate" label="下载准确契约模板" initial={{contractId:transport.contractId,versionId:transport.contractVersionId,format:'CSV'}} choices={choices}/>}
  <CareForm schema={careSchema(file)} value={body} onChange={value=>{restored.current=null;setBody(record(newCareRequest(value)));setDirty(true);setReceived(null);setError('');}} choices={choices} disabled={busy||uncertain||!!received}/>
  <button disabled={busy||uncertain&&pendingMode.current!=='SAVE'||!!received} onClick={()=>void saveEditing()}>{uncertain&&pendingMode.current==='SAVE'?'恢复同一导入草稿保存请求':'保存不完整导入草稿'}</button>
  <button disabled={busy||uncertain&&pendingMode.current==='SAVE'||(!transport&&!savedFile)||!!received} onClick={()=>void receive()}>{busy?'正在接收并预检…':uncertain?'恢复同一接收请求':'保存文件并接收预检'}</button>
  {error&&<p role={uncertain?'alert':'status'}>{error}</p>}{received&&<><CareFacts value={received} onIssue={item=>{setIssue(item);if(editor.current){editor.current.open=true;editor.current.querySelector<HTMLButtonElement>('button[data-care-file-revision]:not([disabled])')?.focus();}}}/><p>原文件定位：{text(received['worksheet'])||'单表来源'} · {text(received['sourceArtifactId'])}</p><button data-care-file-revision disabled={busy} onClick={revise}>以新修订纠正原文件</button>{record(received['input'])['inputId']&&<button onClick={()=>onInput(text(record(received['input'])['inputId']))}>进入准确原申请</button>}</>}
 </details>;
}
