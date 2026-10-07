import {parseExactSafeInteger} from '../serialization/exact-json-integer.js';

/** Inspect decoded object keys before JSON.parse can discard duplicate evidence. */
export function parseStrictJson(text:string,numberPolicy?:'EXACT_SAFE_INTEGER'):unknown{
 const stack:Array<Set<string>|null>=[];
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){
   const start=i;for(i++;i<text.length&&text[i]!=='"';i++)if(text[i]==='\\')i++;
   if(i>=text.length)throw new Error('CLOSED_INPUT_REQUIRED');
   let next=i+1;while(next<text.length&&/\s/.test(text[next]!))next++;
   const object=stack.at(-1);if(object&&text[next]===':'){
    const key:unknown=JSON.parse(text.slice(start,i+1));if(typeof key!=='string'||object.has(key)||key==='__proto__'||key==='constructor')throw new Error('CLOSED_INPUT_REQUIRED');object.add(key);
   }
  }else if(c==='{'||c==='['){if(stack.length>=64)throw new Error('CLOSED_INPUT_REQUIRED');stack.push(c==='{'?new Set():null);}
  else if(c==='}'||c===']'){if(!stack.length||(c==='}'&&stack.at(-1)===null)||(c===']'&&stack.at(-1)!==null))throw new Error('CLOSED_INPUT_REQUIRED');stack.pop();}
 }
 if(stack.length)throw new Error('CLOSED_INPUT_REQUIRED');
 if(numberPolicy!=='EXACT_SAFE_INTEGER')return JSON.parse(text);
 return JSON.parse(text,(_key:string,value:unknown,context?:unknown)=>{
  if(typeof value==='number'&&(!context||typeof context!=='object'||!('source' in context)||typeof context.source!=='string'||parseExactSafeInteger(context.source)===null))throw new Error('CLOSED_INPUT_REQUIRED');
  return value;
 });
}
