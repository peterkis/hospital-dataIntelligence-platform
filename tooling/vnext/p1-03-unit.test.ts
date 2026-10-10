import {test,expect} from 'vitest';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {verifyCampusBoundaries} from './p1-03-boundaries.mjs';
test('AC01 actual vNext runtime and client graph excludes dormant campus authority',()=>{
 const manifest=JSON.parse(readFileSync('tooling/vnext/p1-03-call-sites.json','utf8'));expect(verifyCampusBoundaries(manifest.runtimeEntries).status).toBe('PASS');
});
test('AC01 the dependency gate rejects indirect legacy authority and unresolved dynamic loaders',()=>{
 const root=mkdtempSync(resolve(tmpdir(),'p1-03-boundary-'));
 const write=(path:string,body:string)=>{const file=resolve(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,body);};
 try{
  write('entry.ts',"export * from './barrel.js';");write('barrel.ts','export const valid=true;');
  write('platform/campus/campus-reference-reader.ts','export const bad=true;');
  expect(verifyCampusBoundaries(['entry.ts'],root).status).toBe('PASS');
  write('barrel.ts',"export * from './platform/campus/campus-reference-reader.js';");
  expect(()=>verifyCampusBoundaries(['entry.ts'],root)).toThrow('LEGACY_CAMPUS_AUTHORITY_DEPENDENCY');
  write('barrel.ts',"import 'file:///tmp/platform/campus/campus-reference-reader.js';");expect(()=>verifyCampusBoundaries(['entry.ts'],root)).toThrow('UNRESOLVED_LOCAL_IMPORT');
  write('barrel.ts',"import '/tmp/platform/campus/campus-reference-reader.js';");expect(()=>verifyCampusBoundaries(['entry.ts'],root)).toThrow('UNRESOLVED_LOCAL_IMPORT');
  write('barrel.ts',"const sql='select * from platform.campus';");expect(()=>verifyCampusBoundaries(['entry.ts'],root)).toThrow('LEGACY_CAMPUS_AUTHORITY_SQL');
  write('barrel.ts','const path="x"; import(path);');expect(()=>verifyCampusBoundaries(['entry.ts'],root)).toThrow('UNRESOLVED_DYNAMIC_IMPORT');
  write('apps/api/src/modules/department-master/index.ts',"export const legacy=true; export {current} from './vnext/owner.js';");write('apps/api/src/modules/department-master/vnext/owner.ts','export const current=true;');
  write('barrel.ts',"import {current} from './apps/api/src/modules/department-master/index.js'; export {current};");expect(verifyCampusBoundaries(['entry.ts'],root).status).toBe('PASS');
  for(const clause of ['{legacy}','* as all']){write('barrel.ts',`import ${clause} from './apps/api/src/modules/department-master/index.js';`);expect(()=>verifyCampusBoundaries(['entry.ts'],root)).toThrow('LEGACY_CAMPUS_AUTHORITY_DEPENDENCY');}
  write('barrel.ts',"import {current} from './apps/api/src/modules/department-master/index.js'; import * as all from './apps/api/src/modules/department-master/index.js';");expect(()=>verifyCampusBoundaries(['entry.ts'],root)).toThrow('LEGACY_CAMPUS_AUTHORITY_DEPENDENCY');
  write('barrel.ts',"import './apps/api/src/modules/department-master/index.js';");expect(()=>verifyCampusBoundaries(['entry.ts'],root)).toThrow('LEGACY_CAMPUS_AUTHORITY_DEPENDENCY');
 }finally{if(!root.startsWith(resolve(tmpdir(),'p1-03-boundary-')))throw new Error('TEMP_OWNERSHIP_REQUIRED');rmSync(root,{recursive:true});}
});
