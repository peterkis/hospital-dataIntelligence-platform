import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const forbidden=['/platform/campus/campus-reference-reader.', '/platform/database/database-types.generated.', '/modules/department-master/', '/composition/create-scoped-modules.', '/composition/create-department-governance-http-dependencies.', '/composition/phase-01-vertical-slice.', '/prototype-main.'];
/** Check reachable source imports, not unrelated dormant files elsewhere in the repo. */
export function verifyCampusBoundaries(entries,root=process.cwd()){
 const seen=new Set();
 function visit(file){
  file=resolve(file);const name='/'+relative(root,file).replaceAll('\\','/');
  if(forbidden.some(part=>name.includes(part)))throw new Error('LEGACY_CAMPUS_AUTHORITY_DEPENDENCY:'+name);
  if(seen.has(file))return;seen.add(file);
  if(file.endsWith('.json'))return;
  const source=readFileSync(file,'utf8');
  if(/\bplatform\s*\.\s*campus\b/u.test(source))throw new Error('LEGACY_CAMPUS_AUTHORITY_SQL:'+name);
  const follow=value=>{
   if(value.startsWith('file:')||isAbsolute(value)||/^[a-zA-Z]:/u.test(value))throw new Error('UNRESOLVED_LOCAL_IMPORT:'+value);
   if(value.startsWith('@hospital-data-intelligence/')){const entry=resolve(root,'packages',value.slice('@hospital-data-intelligence/'.length),'src/index.ts');if(!existsSync(entry))throw new Error('UNRESOLVED_WORKSPACE_IMPORT:'+value);visit(entry);return;}
   if(value.startsWith('#'))throw new Error('UNRESOLVED_WORKSPACE_IMPORT:'+value);
   if(!value.startsWith('.'))return; // Third-party packages are not local database authorities.
   const base=resolve(dirname(file),value),candidates=[base,base.replace(/\.js$/u,'.ts'),base.replace(/\.js$/u,'.tsx'),base+'.ts',resolve(base,'index.ts')];
   const target=candidates.find(p=>existsSync(p));if(!target)throw new Error('UNRESOLVED_CURRENT_IMPORT:'+name+':'+value);
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
