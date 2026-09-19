/** Lossless hospital-local time. Date-only license boundaries mean midnight. */
export function localTime(value:string):string {
 const m=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?)?$/.exec(value);
 if(!m)throw new Error('LOCAL_TIME_REQUIRED');
 const y=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
 const leap=y%4===0&&(y%100!==0||y%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||month<1||month>12||day<1||day>days[month-1]!||Number(m[4]??0)>23||Number(m[5]??0)>59||Number(m[6]??0)>59)throw new Error('LOCAL_TIME_REQUIRED');
 return `${m[1]}-${m[2]}-${m[3]}T${m[4]??'00'}:${m[5]??'00'}:${m[6]??'00'}.${(m[7]??'').padEnd(6,'0')}`;
}
export function licenseEnd(value:string|null,kind:'FINITE'|'VERIFIED_UNBOUNDED'|'UNKNOWN',publish=false):string|null {
 if(kind==='FINITE'){if(value===null)throw new Error('LICENSE_END_REQUIRED');return localTime(value);}
 if(value!==null)throw new Error('LICENSE_END_CONFLICT');
 if(kind==='UNKNOWN'&&publish)throw new Error('LICENSE_END_UNKNOWN');
 return null;
}
export function covered(spans:readonly {from:string;to:string|null}[],from:string,to:string|null):boolean {
 let cursor=localTime(from);const end=to===null?null:localTime(to);
 if(end!==null&&end<=cursor)throw new Error('INVALID_BUSINESS_PERIOD');
 for(const span of spans.map(s=>({from:localTime(s.from),to:s.to===null?null:localTime(s.to)})).sort((a,b)=>a.from.localeCompare(b.from))){
  if(span.to!==null&&span.to<=cursor)continue;
  if(span.from>cursor)return false;
  if(span.to===null)return true;
  cursor=span.to;if(end!==null&&cursor>=end)return true;
 }
 return false;
}
export interface Span {from:string;to:string|null}
export function intersect(left:Span,right:Span):Span[] {
 const from=left.from>right.from?left.from:right.from;
 const to=left.to===null?right.to:right.to===null?left.to:left.to<right.to?left.to:right.to;
 return to===null||from<to?[{from,to}]:[];
}
/** Remove later assertions only where their business intervals overlap. */
export function subtract(span:Span,later:readonly Span[]):Span[] {
 let result=[span];
 for(const cut of later)result=result.flatMap(current=>{
  const overlap=intersect(current,cut)[0];if(!overlap)return [current];
  const parts:Span[]=[];if(current.from<overlap.from)parts.push({from:current.from,to:overlap.from});
  if(overlap.to!==null&&(current.to===null||overlap.to<current.to))parts.push({from:overlap.to,to:current.to});
  return parts;
 });
 return result;
}
