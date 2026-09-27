import {useLayoutEffect,useRef,useState} from 'react';
import {createVNextCatalogClient} from '@hospital-data-intelligence/generated-api-client';
import {ReviewValues} from './workspace-application.js';

/** Owns comparison requests independently of entity loading and maintenance actions. */
export function WorkspaceVersionComparison({actor,kind,id,versions,disabled}:{actor:string;kind:'ORGANIZATION'|'CAMPUS';id:string;versions:string[];disabled:boolean}){
 const [from,setFrom]=useState(''),[to,setTo]=useState('');
 const [result,setResult]=useState<{from:string;to:string;value:unknown}|null>(null);
 const [message,setMessage]=useState('');
 const generation=useRef(0);
 const versionKey=JSON.stringify(versions);
 useLayoutEffect(()=>{generation.current++;setFrom('');setTo('');setResult(null);setMessage('');return()=>{generation.current++;};},[actor,kind,id,versionKey]);
 useLayoutEffect(()=>{if(disabled){generation.current++;setResult(null);setMessage('');}},[disabled]);
 function change(side:'from'|'to',value:string){
  generation.current++;setResult(null);setMessage('');
  if(side==='from')setFrom(value);else setTo(value);
 }
 async function compare(){
  if(disabled||!versions.includes(from)||!versions.includes(to))return;
  const request=++generation.current;setResult(null);setMessage('正在读取所选版本差异…');
  try{
   const client=createVNextCatalogClient(location.origin,actor);
   const response=await client.POST(kind==='ORGANIZATION'?'/api/vnext/organizations/diff':'/api/vnext/campuses/diff',{body:{id,fromVersion:from,toVersion:to}});
   if(request!==generation.current)return;
   if(response.error){setMessage(response.error.message);return;}
   setResult({from,to,value:response.data});setMessage('');
  }catch{if(request===generation.current)setMessage('版本差异读取失败，请重试；未使用旧结果。');}
 }
 return <section className="version-comparison"><div className="workspace-form">
  <label>比较起始版本<select value={from} disabled={disabled} onChange={e=>change('from',e.target.value)}><option value="">请选择</option>{versions.map(v=><option key={v}>{v}</option>)}</select></label>
  <label>比较目标版本<select value={to} disabled={disabled} onChange={e=>change('to',e.target.value)}><option value="">请选择</option>{versions.map(v=><option key={v}>{v}</option>)}</select></label>
  <button disabled={disabled||!from||!to} onClick={()=>void compare()}>查看版本差异</button>
 </div>{message&&<p role="status">{message}</p>}{result&&<div data-comparison-result><h4>版本差异 · {result.from} → {result.to}</h4><ReviewValues value={result.value}/></div>}</section>;
}
