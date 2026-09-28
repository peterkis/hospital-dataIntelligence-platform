import {beforeAll,afterAll,test,expect,vi} from 'vitest';
import {request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorkspaceDraftEndpointFields,workspaceEndpointPatch} from '../../apps/admin-web/src/vnext/workspace-endpoint-editor.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';

type Command=Record<string,unknown>;
const wire=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const subject={owner:'organization-master',id:'subject-a'},campus={owner:'organization-master/campus',id:'campus-a'};
const license={owner:'organization-master/license',id:'license-a',version:'2',versionId:'license-version-a'};
const scope={owner:'organization-master/license-scope',id:'scope-a',version:'1',versionId:'scope-version-a'};
for(const action of ['ESTABLISH','VERIFY_SCOPE'])test(`${action} remains editable after saving and restoring incomplete endpoint selections`,()=>{
 let command:Command={action,facts:{services:[]}};
 const onChange=(patch:Command)=>{command=wire({...command,...patch});};
 let field=WorkspaceDraftEndpointFields({actor:'maker',command:wire(command),disabled:false,onChange});
 expect(field.props.disabled).toBe(false);expect(renderToStaticMarkup(field)).not.toContain('disabled=""');
 field.props.onChange(subject.id,'');expect(command).toMatchObject({subject});expect(command).not.toHaveProperty('campus');
 field=WorkspaceDraftEndpointFields({actor:'maker',command:wire(command),disabled:false,onChange});
 field.props.onChange(subject.id,campus.id);expect(command).toMatchObject({subject,campus});
 field=WorkspaceDraftEndpointFields({actor:'maker',command:wire(command),disabled:false,onChange});
 field.props.onChange('subject-b','campus-b');expect(command).toMatchObject({subject:{id:'subject-b'},campus:{id:'campus-b'}});
});
for(const action of ['REVISE_RELATION','REVISE_SCOPE','CLOSE','REVOKE_SCOPE'])test(`${action} cannot change endpoints even with a restored incomplete target`,()=>{
 for(const target of [undefined,{id:'existing-target'}]){
  const onChange=vi.fn(),field=WorkspaceDraftEndpointFields({actor:'maker',command:{action,subject,campus,...(target?{target}:{})},disabled:false,onChange});
  expect(field.props.disabled).toBe(true);field.props.onChange('other-subject','other-campus');expect(onChange).not.toHaveBeenCalled();
 }
});
test('busy and non-EDITING drafts, and explicit revision targets, reject endpoint callbacks',()=>{
 for(const command of [{action:'ESTABLISH'},{action:'VERIFY_SCOPE'},{action:'ESTABLISH',target:{id:'locked'}}]){
  const onChange=vi.fn(),field=WorkspaceDraftEndpointFields({actor:'maker',command,disabled:true,onChange});
  expect(field.props.disabled).toBe(true);expect(renderToStaticMarkup(field)).toContain('disabled=""');
  field.props.onChange(subject.id,campus.id);expect(onChange).not.toHaveBeenCalled();
 }
 const onChange=vi.fn(),field=WorkspaceDraftEndpointFields({actor:'maker',command:{action:'ESTABLISH',target:{id:'locked'}},disabled:false,onChange});
 expect(field.props.disabled).toBe(true);field.props.onChange(subject.id,campus.id);expect(onChange).not.toHaveBeenCalled();
});
test('changing a subject invalidates its license but preserves independent source, evidence and service fields',()=>{
 const command={action:'VERIFY_SCOPE',subject,campus,source:{alias:'original'},evidence:'material',facts:{license,services:['service-a'],catalog:{version:'1'}}};
 const changed=wire({...command,...workspaceEndpointPatch(command,'subject-b',campus.id)});
 expect(changed.facts).not.toHaveProperty('license');expect(changed).toMatchObject({source:command.source,evidence:command.evidence,facts:{services:['service-a'],catalog:{version:'1'}}});
 expect(wire({...command,...workspaceEndpointPatch(command,subject.id,'campus-b')}).facts.license).toEqual(license);
 expect(command.facts.license).toEqual(license);
});
test('changing either side clears pair-specific scope targets, while an unchanged pair does not lose selections',()=>{
 const command={action:'ESTABLISH',subject,campus,facts:{scopeTargets:[scope],services:['service-a'],role:'OPERATOR'}};
 for(const pair of [['subject-b',campus.id],[subject.id,'campus-b'],['',campus.id]]){
  expect(wire({...command,...workspaceEndpointPatch(command,pair[0]!,pair[1]!)})).toMatchObject({facts:{scopeTargets:[],services:['service-a'],role:'OPERATOR'}});
 }
 const onChange=vi.fn(),field=WorkspaceDraftEndpointFields({actor:'maker',command,disabled:false,onChange});
 field.props.onChange(subject.id,campus.id);expect(onChange).not.toHaveBeenCalled();expect(command.facts.scopeTargets).toEqual([scope]);
});

let app:Awaited<ReturnType<typeof buildCatalogServer>>,base:string;
const reached:string[]=[];
beforeAll(async()=>{
 app=await buildCatalogServer();app.addHook('preHandler',async request=>{reached.push(request.url);});
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('ADDRESS_REQUIRED');base='http://127.0.0.1:'+address.port;
});
afterAll(async()=>{await app?.close();});
// Exercise the socket parser, including chunked transfer; app.inject is deliberately not used.
function post(path:string,body:string,chunked:boolean):Promise<{status:number;code:string;cache:string|undefined}>{
 return new Promise((resolve,reject)=>{
  const bytes=Buffer.from(body),request=httpRequest(base+path,{method:'POST',headers:{'content-type':'application/json',...(chunked?{}:{'content-length':bytes.length})}},response=>{
   const parts:Buffer[]=[];response.on('data',part=>parts.push(Buffer.from(part)));response.on('error',reject);
   response.on('end',()=>{try{resolve({status:response.statusCode!,code:JSON.parse(Buffer.concat(parts).toString()).code,cache:response.headers['cache-control']});}catch(error){reject(error);}});
  });
  request.on('error',reject);request.setTimeout(15000,()=>request.destroy(new Error('HTTP_TIMEOUT')));
  if(chunked){for(let offset=0;offset<bytes.length;offset+=16384)request.write(bytes.subarray(offset,offset+16384));request.end();}else request.end(bytes);
 });
}
const content={domain:'BUNDLE',campus:'NORTH',metadata:{},bytesBase64:Buffer.alloc(1048576).toString('base64')};
for(const route of ['workbook/preview','drafts/save','capabilities'])for(const chunked of [false,true])test(`${route} accepts a one-MiB file over ${chunked?'chunked':'Content-Length'} HTTP without raising the global cap`,async()=>{
 const path='/api/vnext/organization-workspace/'+route,body=JSON.stringify({...content,...(route==='drafts/save'?{requestId:randomUUID()}:{})});
 expect(Buffer.byteLength(body)).toBeGreaterThan(1398104);const before=reached.length;
 expect(await post(path,body,chunked)).toEqual({status:503,code:'BLOCKED_DEPENDENCY',cache:'no-store'});
 expect(reached.slice(before)).toEqual([path]); // Missing Owner is reached only after successful body parsing and schema validation.
});
for(const chunked of [false,true])test(`workspace body ceiling rejects excess bytes and ordinary routes retain 300000 bytes (${chunked?'chunked':'length'})`,async()=>{
 const path='/api/vnext/organization-workspace/drafts/save',body=JSON.stringify({...content,requestId:randomUUID()}),atLimit=body+' '.repeat(2000000-Buffer.byteLength(body));
 expect((await post(path,atLimit,chunked)).status).toBe(503);
 let before=reached.length;expect(await post(path,atLimit+' ',chunked)).toMatchObject({status:413,code:'FST_ERR_CTP_BODY_TOO_LARGE'});expect(reached.length).toBe(before);
 before=reached.length;expect(await post('/api/vnext/organization-workspace/drafts/list','{}'+' '.repeat(299999),chunked)).toMatchObject({status:413,code:'FST_ERR_CTP_BODY_TOO_LARGE'});expect(reached.length).toBe(before);
});
