import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const forbidden=['/platform/campus/campus-reference-reader.', '/platform/database/database-types.generated.', '/modules/department-master/', '/composition/create-scoped-modules.', '/composition/create-department-governance-http-dependencies.', '/composition/phase-01-vertical-slice.', '/prototype-main.'];
/** Check reachable source imports, not unrelated dormant files elsewhere in the repo. */
export function verifyCampusBoundaries(entries,root=process.cwd()){
 const seen=new Set();
 const exportedNames=file=>{const source=readFileSync(file,'utf8');return [...source.matchAll(/\bexport\s+(?:(?:declare|async)\s+)?(?:const|let|var|function|type|interface|class|enum)\s+([A-Za-z_$][\w$]*)/gu)].map(match=>match[1]).concat([...source.matchAll(/\bexport\s+(?:type\s+)?\{([^}]+)\}/gu)].flatMap(match=>match[1].split(',').map(part=>part.trim().replace(/^type\s+/u,'').split(/\s+as\s+/u).at(-1))));};
 const names=clause=>clause.split(',').map(part=>part.trim().replace(/^type\s+/u,'').split(/\s+as\s+/u)).filter(parts=>/^[A-Za-z_$][\w$]*$/u.test(parts[0]??''));
 const localTarget=(file,value)=>{const base=resolve(dirname(file),value);return [base,base.replace(/\.js$/u,'.ts'),base.replace(/\.js$/u,'.tsx'),base+'.ts',resolve(base,'index.ts')].find(p=>existsSync(p));};
 // The public Department barrel also contains the dormant legacy API. Follow
 // only a named, explicitly delegated current export; importing a legacy name,
 // namespace or side-effect still fails the original authority fence.
 const currentDepartmentExport=(file,names)=>{
  if(!names?.length)throw new Error('LEGACY_CAMPUS_AUTHORITY_DEPENDENCY:'+file);
  const remaining=new Set(names);
  for(const match of readFileSync(file,'utf8').matchAll(/\bexport\s+(?:type\s+)?(\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/gu)){
   if(!match[2].startsWith('./vnext/'))continue;
   const target=localTarget(file,match[2]);if(!target)throw new Error('UNRESOLVED_CURRENT_IMPORT:'+file);
   const exports=match[1]==='*'?exportedNames(target):match[1].slice(1,-1).split(',').map(part=>part.trim().replace(/^type\s+/u,'').split(/\s+as\s+/u).at(-1));
   if(exports.some(name=>remaining.has(name))){visit(target);for(const name of exports)remaining.delete(name);}
  }
  if(remaining.size)throw new Error('LEGACY_CAMPUS_AUTHORITY_DEPENDENCY:'+file+':'+[...remaining].join(','));
 };
 function visit(file){
  file=resolve(file);const name='/'+relative(root,file).replaceAll('\\','/');
  if(forbidden.some(part=>name.includes(part)&&(part!=='/modules/department-master/'||!name.includes('/modules/department-master/vnext/'))))throw new Error('LEGACY_CAMPUS_AUTHORITY_DEPENDENCY:'+name);
  if(seen.has(file))return;seen.add(file);
  if(file.endsWith('.json'))return;
  const source=readFileSync(file,'utf8');
  if(/\bplatform\s*\.\s*campus\b/u.test(source))throw new Error('LEGACY_CAMPUS_AUTHORITY_SQL:'+name);
  const namedImports=new Map(),wholeImports=new Set();
  for(const match of source.matchAll(/\b(?:import|export)\s+(?:type\s+)?([^;]+?)\s+from\s+['"]([^'"]+)['"]/gu)){if(!/^\{[^}]+\}$/u.test(match[1].trim()))wholeImports.add(match[2]);}
  for(const match of source.matchAll(/\b(?:import|require)\s*(?:\(\s*)?['"]([^'"]+)['"]/gu))wholeImports.add(match[1]);
  for(const match of source.matchAll(/\b(?:import|export)\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gu)){
   const selected=names(match[1]).map(parts=>parts[0]);namedImports.set(match[2],[...(namedImports.get(match[2])??[]),...selected]);
  }
  const follow=value=>{
   if(value.startsWith('file:')||isAbsolute(value)||/^[a-zA-Z]:/u.test(value))throw new Error('UNRESOLVED_LOCAL_IMPORT:'+value);
   if(value.startsWith('@hospital-data-intelligence/')){const entry=resolve(root,'packages',value.slice('@hospital-data-intelligence/'.length),'src/index.ts');if(!existsSync(entry))throw new Error('UNRESOLVED_WORKSPACE_IMPORT:'+value);visit(entry);return;}
   if(value.startsWith('#'))throw new Error('UNRESOLVED_WORKSPACE_IMPORT:'+value);
   if(!value.startsWith('.'))return; // Third-party packages are not local database authorities.
   const base=resolve(dirname(file),value),candidates=[base,base.replace(/\.js$/u,'.ts'),base.replace(/\.js$/u,'.tsx'),base+'.ts',resolve(base,'index.ts')];
   const target=candidates.find(p=>existsSync(p));if(!target)throw new Error('UNRESOLVED_CURRENT_IMPORT:'+name+':'+value);
   if(relative(root,target).replaceAll('\\','/').endsWith('/modules/department-master/index.ts')){currentDepartmentExport(target,wholeImports.has(value)?null:namedImports.get(value));return;}
   visit(target);
  };
  // Same literal-import boundary used by the repository's module gate; include
  // re-exports, side-effect imports and literal dynamic imports/type queries.
  for(const match of source.matchAll(/(?:\bfrom\s+|\bimport\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/gu))follow(match[1]);
  // The existing parser worker chooses the same primitive's .ts/.js entry.
  const rest=source.replace(/\bimport\s*\(\s*new URL\(import\.meta\.url\.endsWith\('\.ts'\)\?'([^']+)':'([^']+)',import\.meta\.url\)\.href,\s*\)/gu,(_match,a,b)=>{follow(a);follow(b);return '';});
  if(/\b(?:import|require)\s*\(\s*[^\s'"]/u.test(rest))throw new Error('UNRESOLVED_DYNAMIC_IMPORT:'+name);
 }
 entries.forEach(entry=>visit(resolve(root,entry)));
 return {status:'PASS',gate:'P1-03-CURRENT-CAMPUS-BOUNDARY',files:seen.size,entries};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const manifest=JSON.parse(readFileSync('tooling/vnext/p1-03-call-sites.json','utf8'));
 console.log(JSON.stringify(verifyCampusBoundaries(manifest.runtimeEntries)));
}
