export async function readAllWorkspacePages<T extends {id:string}>(load:(after:string|undefined)=>Promise<{data?:T[];error?:unknown}>,limit=100):Promise<{data?:T[];error?:unknown}>{
 const rows:T[]=[];let after:string|undefined;
 for(;;){
  const page=await load(after);
  if(page.error)return {error:page.error};
  if(!page.data)return {error:new Error('WORKSPACE_PAGE_UNAVAILABLE')};
  rows.push(...page.data);
  if(page.data.length<limit)return {data:rows};
  const next=page.data.at(-1)?.id;
  if(!next||next===after)return {error:new Error('WORKSPACE_CURSOR_STALLED')};
  after=next;
 }
}
