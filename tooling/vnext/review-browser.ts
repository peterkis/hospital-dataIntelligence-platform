import {spawn} from 'node:child_process';
import type {Readable,Writable} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
type Json=Record<string,any>;
// Headless Chrome over a private CDP pipe; no application or HTTP replacement.
export function reviewBrowser(){
 const profile=mkdtempSync(resolve(tmpdir(),'workspace-retry-'));
 const child=spawn(process.env['HDIP_REVIEW_BROWSER_EXECUTABLE']??'google-chrome',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--user-data-dir='+profile],{stdio:['ignore','ignore','pipe','pipe','pipe']});
 const input=child.stdio[3] as Writable,output=child.stdio[4] as Readable;
 let sequence=0,buffer='',stderr='',completedDiffs=0;const diffRequests=new Set<string>();
 const pending=new Map<number,{resolve:(value:Json)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const fail=(error:Error)=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();};
 child.stderr!.setEncoding('utf8');child.stderr!.on('data',(part:string)=>{stderr=(stderr+part).slice(-4000);});
 child.on('error',fail);child.on('exit',()=>fail(new Error('BROWSER_EXITED '+stderr)));
 output.setEncoding('utf8');output.on('data',(part:string)=>{
  buffer+=part;let end:number;
  while((end=buffer.indexOf('\0'))>=0){const text=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!text)continue;
   const message=JSON.parse(text) as Json;
   if(message['method']==='Network.responseReceived'&&message['params'].response.url.endsWith('/diff'))diffRequests.add(message['params'].requestId);
   if(message['method']==='Network.loadingFinished'&&diffRequests.delete(message['params'].requestId))completedDiffs++;
   const item=pending.get(message['id']);if(!item)continue;
   pending.delete(message['id']);clearTimeout(item.timer);
   if(message['error'])item.reject(new Error(JSON.stringify(message['error'])));else item.resolve(message['result']??{});
  }
 });
 const call=(method:string,params:Json={},sessionId?:string):Promise<Json>=>new Promise((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('BROWSER_TIMEOUT '+method+' '+stderr));},45000);
  pending.set(id,{resolve,reject,timer});input.write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
 });
 return {call,completedDiffs:()=>completedDiffs,async open(url:string){
  const target=await call('Target.createTarget',{url:'about:blank'}),session=await call('Target.attachToTarget',{targetId:target['targetId'],flatten:true});
  const sessionId=session['sessionId'] as string;await call('Page.enable',{},sessionId);await call('Network.enable',{},sessionId);await call('Page.navigate',{url},sessionId);
  for(let count=0;count<200;count++){
   const result=await call('Runtime.evaluate',{expression:'location.href === '+JSON.stringify(url)+' && document.readyState === "complete"',returnByValue:true},sessionId);
   if(result['result']?.value===true)return sessionId;await delay(25);
  }throw new Error('BROWSER_PAGE_NOT_READY');
 },async close(){
  fail(new Error('BROWSER_CLOSED'));child.kill('SIGTERM');
  for(let i=0;i<40&&child.exitCode===null&&child.signalCode===null;i++)await delay(25);
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await delay(100);}
  rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }};
}
