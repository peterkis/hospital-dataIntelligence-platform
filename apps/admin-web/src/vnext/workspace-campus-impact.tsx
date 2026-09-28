import {useEffect,useRef,useState} from 'react';
import {createCampusClient,type VNextOperations as Operations} from '@hospital-data-intelligence/generated-api-client';
import {textField,objectField,Group} from './workspace-fields.js';
type Report=Operations['assessCampusImpact']['responses'][200]['content']['application/json'];
const labels={BUSINESS_UNIT:'业务单元',LOCATION:'地点',ASSIGNMENT:'人员任职',CONSUMPTION:'在途消费'};
export function WorkspaceCampusImpact({actor,command,disabled,onChange}:{actor:string;command:unknown;disabled:boolean;onChange:(patch:Record<string,unknown>)=>void}){
 const id=textField(objectField(command,'target'),'id'),from=textField(command,'validFrom');
 const [report,setReport]=useState<Report|null>(null),[message,setMessage]=useState(''),[pending,setPending]=useState(false);
 const epoch=useRef(0);useEffect(()=>{epoch.current++;setReport(null);setMessage('');setPending(false);return()=>{epoch.current++;};},[actor,id,from]);
 async function refresh(){const token=++epoch.current;setPending(true);setReport(null);try{
  const result=await createCampusClient(location.origin,actor).assessImpact({id,validFrom:from,validTo:null});
  if(token!==epoch.current)return;
  if(result.error){setMessage(result.error.message+' ['+result.error.code+']');return;}
  setReport(result.data);setMessage('已读取；提交和应用前仍会重新核验。');onChange({assessmentDigest:result.data.digest});
 }catch{if(token===epoch.current)setMessage('影响读取失败，不能按无依赖处理。');}finally{if(token===epoch.current)setPending(false);}}
 return <Group title="退出依赖与处置状态"><p>永久退出不等于处置结案。登记证据和结案的业务生效时间须与原退出时间一致。</p><button type="button" className="secondary" disabled={disabled||pending||!id||!from} onClick={()=>void refresh()}>读取并绑定最新影响评估</button><p role="status">{message}</p>{report&&<CampusImpactDetails report={report}/>}</Group>;
}
function CampusImpactDetails({report}:{report:Report}){return <><p>处置状态：{report.completed?'已结案（合成范围）':'未结案'}</p><ul>{report.dependencies.map(d=><li key={d.id}>{d.owner} · {d.id} · v{d.version} · {d.outstanding?'仍需原 Owner 处置':d.active?'退出后期间已结束，历史保留':'历史证据保留'}</li>)}</ul>{report.unavailable.map(owner=>{const declaration=report.dispositions.filter(d=>d.owner===owner).at(-1);return <p key={owner}>{labels[owner]}：NOT_EVALUABLE（尚未接入） · 手工声明：{declaration?.status==='CLEAR'&&declaration.dependencyDigest===report.dependencyDigest?'本次范围已核查，仍非系统集成验证':'未知或需重新核查'}</p>;})}<p>未知在途或尚未处置的依赖会阻断结案。</p></>;}

export function WorkspaceCandidateImpact({actor,command,onReady}:{actor:string;command:unknown;onReady:(ready:boolean)=>void}){
 const id=textField(objectField(command,'target'),'id'),from=textField(command,'validFrom'),expected=textField(command,'assessmentDigest');
 const [report,setReport]=useState<Report|null>(null),[message,setMessage]=useState('正在核验候选影响依据…');
 useEffect(()=>{
  let active=true;onReady(false);setReport(null);
  void createCampusClient(location.origin,actor).assessImpact({id,validFrom:from,validTo:null}).then(result=>{
   if(!active)return;
   if(result.error){setMessage(result.error.message);return;}
   if(result.data.digest!==expected){setMessage('依赖或版本已变化，当前报告与候选不一致，不能批准。');return;}
   setReport(result.data);setMessage('影响清单与准确候选一致；应用前仍会重新核验。');onReady(true);
  }).catch(()=>{if(active)setMessage('影响报告读取失败，不能按无依赖批准。');});
  return()=>{active=false;};
 },[actor,id,from,expected,onReady]);
 return <section aria-label="候选影响报告"><h4>候选影响报告</h4><p role="status">{message}</p>{report&&<CampusImpactDetails report={report}/>}</section>;
}

export function WorkspaceCampusDisposition({actor,id,from,asOf}:{actor:string;id:string;from:string;asOf:string}){
 const [report,setReport]=useState<Report|null>(null),[message,setMessage]=useState('正在读取退出处置状态…');
 useEffect(()=>{
  let active=true;setReport(null);
  void createCampusClient(location.origin,actor).assessImpact({id,validFrom:from,validTo:null,asOf}).then(result=>{
   if(!active)return;if(result.error){setMessage('处置报告不可读取，不能按无依赖或已完成处理。');return;}
   setReport(result.data);setMessage('沿用当前详情的记录时点；历史证据继续保留。');
  }).catch(()=>{if(active)setMessage('处置报告读取失败。');});
  return()=>{active=false;};
 },[actor,id,from,asOf]);
 return <section aria-label="退出处置状态"><h3>退出处置状态</h3><p role="status">{message}</p>{report&&<CampusImpactDetails report={report}/>}</section>;
}
