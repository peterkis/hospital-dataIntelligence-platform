import {WorkspaceCandidateImpact} from './workspace-campus-impact.js';
import {displayTime} from './workspace-fields.js';
import {WorkspaceMaterial} from './workspace-material.js';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createVNextCatalogClient,createOrganizationWorkspaceClient,type VNextOperations as Operations} from '@hospital-data-intelligence/generated-api-client';
export type Application=Operations['listOrganizationApplications']['responses'][200]['content']['application/json'][number];
const routes={
 ORG01:{plan:'/api/vnext/organizations/plan',review:'/api/vnext/organizations/review',approve:'/api/vnext/organizations/approve',apply:'/api/vnext/organizations/apply',resume:'/api/vnext/organizations/resume',withdraw:'/api/vnext/organizations/withdraw'},
 ORG02:{plan:'/api/vnext/campuses/plan',review:'/api/vnext/campuses/review',approve:'/api/vnext/campuses/approve',apply:'/api/vnext/campuses/apply',resume:'/api/vnext/campuses/resume',withdraw:'/api/vnext/campuses/withdraw'},
 RELATION:{plan:'/api/vnext/operating-relations/plan',review:'/api/vnext/operating-relations/review',approve:'/api/vnext/operating-relations/approve',apply:'/api/vnext/operating-relations/apply',resume:'/api/vnext/operating-relations/resume',withdraw:'/api/vnext/operating-relations/withdraw'},
 SCOPE:{plan:'/api/vnext/license-scope-evidence/plan',review:'/api/vnext/license-scope-evidence/review',approve:'/api/vnext/license-scope-evidence/approve',apply:'/api/vnext/license-scope-evidence/apply',resume:'/api/vnext/license-scope-evidence/resume',withdraw:'/api/vnext/license-scope-evidence/withdraw'}
} as const;
const labels:Record<string,string>={assessmentDigest:'评估依据',plan:'退出处置计划',responsibleOwner:'处置责任Owner',dueAt:'处置目标日期',actions:'分Owner处置安排',resolution:'手工处置声明',status:'核查结果',scope:'声明范围',head:'整体并发版本',profileVersion:'准确资料版本',reference:'准确引用',operationStatus:'院区运营状态',operatingPermission:'运营许可结论',source:'来源记录',systemId:'来源系统',versionId:'准确版本',alias:'来源别名',versionNo:'来源版本号',recordLocator:'来源记录定位（受限）',recordedAt:'来源记录时间',recordStatus:'来源意图',approvalRef:'来源审批依据',action:'申请动作',facts:'申请资料',legalName:'机构名称',entityNature:'机构性质',authority:'登记主管机关',legalAddress:'登记地址',registrationEvidence:'登记证据引用',identifiers:'机构标识',kind:'类型',namespace:'命名空间',value:'原值',validFrom:'业务开始',validTo:'业务结束（排他）',target:'准确目标',expectedVersion:'预期版本',version:'版本',id:'平台标识',owner:'Owner',license:'证照',number:'证照号码（受限）',endKind:'期限语义',evidence:'证据引用',licenseTargets:'核验的证照版本',creditCodeStatus:'统一信用代码适用声明',licenseTarget:'证照目标',campusName:'院区名称',campusCode:'院区代码',campusAddress:'院区地址',nodeRole:'节点角色',nodeKind:'物理类型',adminDivision:'行政区划版本',publicPhone:'公开电话',openingDate:'实际启用日期',sourceOperationStatus:'来源运营状态',plannedOpeningAt:'计划日期',state:'状态',reason:'操作原因',subject:'机构主体',campus:'院区',services:'服务代码',catalog:'服务码表版本',scopeTargets:'许可范围依据',licenseScopeText:'许可范围原文',role:'关系角色',primary:'主运营声明',relationTypeText:'关系类型原文'};
const ownerNames:Record<string,string>={'organization-master':'机构主体','organization-master/campus':'院区','organization-master/license':'证照','organization-master/verification':'登记核验','organization-master/license-scope':'许可范围','organization-master/operating-relation':'运营关系'};
export const applicationStatus:Record<Application['state'],string>={STAGED:'申请已暂存',CANDIDATE:'待独立审批',APPROVED:'已批准 · 应用前重检',COMMITTED:'已提交正式事实',WITHDRAWN:'已撤回'};
const timeField=/^(validFrom|validTo|recordedAt|businessAt|asOf|plannedOpeningAt|observedAt|createdAt|dueAt|from|to|start|end)$/u;
export function ReviewValues({value,source=false,time=false}:{value:unknown;source?:boolean;time?:boolean}){
 if(value===null||value===undefined)return <span className="muted">未填写</span>;
 if(Array.isArray(value))return value.length?<ol>{value.map((item,index)=><li key={index}><ReviewValues value={item} source={source}/></li>)}</ol>:<span className="muted">无</span>;
 if(typeof value==='object')return <dl className="review-values">{Object.entries(value).map(([key,item])=><div key={key}><dt>{key==='recordedAt'?(source?'来源记录时间':'平台记录时间'):labels[key]??key}</dt><dd>{/^(id|owner|systemId|versionId|contractId|contractVersionId|sourceVersionId|assessmentDigest)$/.test(key)?<details><summary>查看准确引用</summary><ReviewValues value={item} time={timeField.test(key)||(['before','after'].includes(key)&&typeof Reflect.get(value,'field')==='string'&&timeField.test(Reflect.get(value,'field')))} source={source||key==='source'}/></details>:key==='validTo'&&item===null?<span>{Reflect.get(value,'endKind')==='UNKNOWN'?'结束时间未知':Reflect.get(value,'endKind')==='VERIFIED_UNBOUNDED'?'已核验无固定期限':'无界结束'}</span>:<ReviewValues value={item} time={timeField.test(key)||(['before','after'].includes(key)&&typeof Reflect.get(value,'field')==='string'&&timeField.test(Reflect.get(value,'field')))} source={source||key==='source'}/>}</dd></div>)}</dl>;
 return <span>{time&&typeof value==='string'?displayTime(value):String(value)}</span>;
}
export function ApplicationPanel({actor,entry,onChanged}:{actor:string;entry:Application;onChanged:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('审批只针对成功读取的准确候选。'),[review,setReview]=useState<{candidateId:string;digest:string;approvedBy:string|null;command:unknown;blockingIssues?:string[]}|null>(null),[confirmed,setConfirmed]=useState(false),[outcome,setOutcome]=useState<{status:string;facts?:Array<{owner:string;id:string;version:string}>}|null>(null);
 const [impactReady,setImpactReady]=useState(false);
 const needsImpact=!!review?.command&&typeof review.command==='object'&&'assessmentDigest' in review.command;
 const [materials,setMaterials]=useState<Array<{artifactId:string;bytesBase64:string}>>([]),[seen,setSeen]=useState<string[]>([]),[materialsReady,setMaterialsReady]=useState(false);
 const generation=useRef(0),planRequest=useRef(entry.requestId??crypto.randomUUID()),withdrawRequest=useRef(crypto.randomUUID());
 useLayoutEffect(()=>{
  const url=new URL(location.href);
  const changed=url.searchParams.get('input')!==entry.inputId||url.searchParams.has('draft')||url.searchParams.has('bundle')||url.searchParams.has('bundleRevision');
  url.searchParams.delete('draft');url.searchParams.delete('bundle');url.searchParams.delete('bundleRevision');url.searchParams.set('input',entry.inputId);
  if(changed)history.replaceState(null,'',url.pathname+url.search);
 },[entry.inputId]);
 useEffect(()=>()=>{generation.current++;},[]);
 const api=()=>createVNextCatalogClient(location.origin,actor),paths=routes[entry.domain==='ORG03'?entry.kind??'RELATION':entry.domain];
 const candidateId=entry.candidateId??review?.candidateId;
 async function run(action:'preflight'|'plan'|'review'|'approve'|'apply'|'resume'|'withdraw'){
  const g=generation.current;setBusy(true);setMessage('正在重检当前身份、版本与权限…');
  try{
   if(action==='preflight'){
    const r=await createOrganizationWorkspaceClient(location.origin,actor).preflight({domain:entry.domain,inputId:entry.inputId});if(g!==generation.current)return;if(r.error){setMessage(r.error.message+' ['+r.error.code+']');return;}setMessage(r.data.status==='BLOCKED'?'预检阻断：'+r.data.codes.join('、'):'当前预检通过，可生成候选；尚未批准或发布。');return;
   }else if(action==='plan'){
    const r=await api().POST(paths.plan,{body:{inputId:entry.inputId,requestId:entry.requestId??planRequest.current}});if(g!==generation.current)return;if(r.error){setMessage(r.error.message+' ['+r.error.code+']');return;}setMessage('候选已冻结，等待另一身份读取并审批。');
   }else if(action==='review'){
    if(!candidateId)return;setReview(null);setImpactReady(false);setMaterials([]);setSeen([]);setMaterialsReady(false);setConfirmed(false);const r=await api().POST(paths.review,{body:{candidateId}});if(g!==generation.current)return;if(r.error){setMessage(r.error.message+' ['+r.error.code+']');return;}
    const proof=await createOrganizationWorkspaceClient(location.origin,actor).reviewMaterials({domain:entry.domain,candidateId});if(g!==generation.current)return;if(proof.error||proof.data.digest!==r.data.digest){setMessage(proof.error?proof.error.message+' ['+proof.error.code+']':'候选依据发生变化，请重新读取。');return;}
    setMaterials(proof.data.materials);setMaterialsReady(true);setReview(r.data);setMessage('已读取准确候选。请展开核对材料原文，并确认完整期间和来源。');
   }else if(action==='approve'){
    if(!review||!confirmed||(needsImpact&&!impactReady))return;const r=await api().POST(paths.approve,{body:{candidateId:review.candidateId,digest:review.digest}});if(g!==generation.current)return;if(r.error){setReview(null);setMessage(r.error.message+' ['+r.error.code+']');return;}setReview({...review,approvedBy:r.data.approvedBy});setMessage('批准已记录。尚未应用，执行时仍会重新核权和核验依赖。');
   }else if(action==='withdraw'){
    const r=await api().POST(paths.withdraw,{body:{inputId:entry.inputId,requestId:withdrawRequest.current}});if(g!==generation.current)return;if(r.error){setMessage(r.error.message+' ['+r.error.code+']');return;}setReview(null);setMessage('申请已撤回，历史输入保留。');
   }else{
    if(!candidateId||!entry.requestId)return;const body={candidateId,requestId:entry.requestId};const r=action==='resume'?await api().POST(paths.resume,{body}):await api().POST(paths.apply,{body});if(g!==generation.current)return;if(r.error){setMessage(r.error.message+' ['+r.error.code+']');return;}setOutcome(r.data);setMessage(r.data?.status==='COMMITTED'?'已确认提交，同一请求恢复原 IDs。':r.data?'结果待确认，请使用恢复原结果。':'当前身份没有可恢复的原请求结果。');
   }
   if(g===generation.current)await onChanged();
  }catch{if(g===generation.current)setMessage('连接中断，结果尚未确认。保留原请求，先刷新申请或恢复原结果。');}
  finally{if(g===generation.current)setBusy(false);}
 }
 return <section className="editor-card application-panel"><div className="section-heading"><h3>{applicationStatus[entry.state]}</h3><span>原提交人：{entry.maker}</span></div><p>平台接收时间：{displayTime(entry.recordedAt)}</p><p role="status">{message}</p><div className="action-bar"><button className="secondary" disabled={busy||!entry.access.canRead||entry.state==='COMMITTED'||entry.state==='WITHDRAWN'} onClick={()=>void run('preflight')}>只读准入预检</button>
 <button disabled={busy||!entry.access.canPlan||entry.state!=='STAGED'} onClick={()=>void run('plan')}>生成候选并校验</button>
 <button className="secondary" disabled={busy||!entry.access.canReview||!candidateId||entry.state==='WITHDRAWN'} onClick={()=>void run('review')}>读取准确候选</button>
 <button className="secondary" disabled={busy||!entry.access.canReview||!review||!confirmed||(needsImpact&&!impactReady)||entry.state!=='CANDIDATE'} onClick={()=>void run('approve')}>批准候选</button>
 <button disabled={busy||!entry.access.canWrite||entry.state!=='APPROVED'} onClick={()=>void run('apply')}>应用批准结果</button>
 <button className="secondary" disabled={busy||!entry.access.canRead||!candidateId||!entry.requestId} onClick={()=>void run('resume')}>恢复原结果</button>
 <button className="secondary" disabled={busy||!entry.access.canWrite||['COMMITTED','WITHDRAWN'].includes(entry.state)} onClick={()=>void run('withdraw')}>撤回申请</button></div>
 {review&&<section className="review-card"><h3>准确候选 · 受限审阅</h3>{!!review.blockingIssues?.length&&<p role="alert">阻断：{review.blockingIssues.join('、')}</p>}<ReviewValues value={review.command}/>{needsImpact&&<WorkspaceCandidateImpact key={review.candidateId} actor={actor} command={review.command} onReady={setImpactReady}/>}<h4>本次 Owner 要求的受控材料</h4>{materials.map(material=><WorkspaceMaterial key={material.artifactId} id={material.artifactId} bytesBase64={material.bytesBase64} onRead={()=>setSeen(values=>[...new Set([...values,material.artifactId])])}/>)}{materialsReady&&!materials.length&&<p className="muted">本次动作没有要求重新读取上游材料。仍需核对准确申请与操作原因。</p>}<label className="confirmation"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy||!materialsReady||(needsImpact&&!impactReady)||materials.some(m=>!seen.includes(m.artifactId))}/>我已核对准确申请内容和受控证据依据</label></section>}
 {outcome&&<section><h3>原请求结果：{outcome.status}</h3><ul>{outcome.facts?.map(f=><li key={f.owner+f.id+f.version}>{ownerNames[f.owner]??'正式对象'} · 版本 {f.version}<details><summary>正式标识</summary>{f.owner} · {f.id}</details></li>)}</ul></section>}
 <details><summary>申请技术标识</summary><dl><dt>输入</dt><dd>{entry.inputId}</dd><dt>候选</dt><dd>{candidateId??'尚未生成'}</dd><dt>应用请求</dt><dd>{entry.requestId??'尚未冻结'}</dd></dl></details></section>;
}
