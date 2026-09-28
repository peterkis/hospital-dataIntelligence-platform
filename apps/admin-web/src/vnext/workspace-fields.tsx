import type {ReactNode} from 'react';
/** Display only: historical instants retain their original precision in application state. */
export function displayTime(value:string):string{return value.replace(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d{1,6})?$/u,'$1 $2');}
export function Field({label,value,onChange,disabled=false,hint,type='text',time=false}:{label:string;value:string;onChange:(value:string)=>void;disabled?:boolean;hint?:string;type?:string;time?:boolean}){
 const change=(next:string)=>{if(!time){onChange(next);return;} const seconds=next.replace('T',' ').split('.')[0]!.slice(0,19);onChange(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(seconds)?seconds.replace(' ','T')+'.000000':seconds);};
 return <label>{label}<input type={type} value={time?displayTime(value):value} onChange={event=>change(event.target.value)} disabled={disabled} {...(time?{maxLength:19,placeholder:'yyyy-mm-dd hh24:mm:ss'}:{})}/>{hint&&<small>{hint}</small>}</label>;
}
export function Group({title,children}:{title:string;children:ReactNode}){return <fieldset className="workspace-fieldset"><legend>{title}</legend><div className="workspace-form">{children}</div></fieldset>;}
export function textField(value:unknown,key:string):string{if(!value||typeof value!=='object')return '';const result=Reflect.get(value,key);return typeof result==='string'?result:typeof result==='number'?String(result):'';}
export const objectField=(value:unknown,key:string):Record<string,unknown>=>{if(!value||typeof value!=='object')return {};const result:unknown=Reflect.get(value,key);return result&&typeof result==='object'&&!Array.isArray(result)?result as Record<string,unknown>:{};};
