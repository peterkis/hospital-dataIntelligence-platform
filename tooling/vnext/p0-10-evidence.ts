import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync} from 'node:fs';
import {resolve, relative, isAbsolute} from 'node:path';
import {canonicalJson} from '../verification/src/evidence/recorder.js';

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const browserSteps=['makerCheckerDataset','makerCheckerSource','contractCoreCandidate','contractValidationAccept','makerCheckerContract','brEffectivePublishedRead','retireImpactAndRetire','historyAndNoDomainWriteBoundary','AC-01','AC-02','AC-03','AC-04','AC-05'];
export async function collectStages(stages: {name:string;run:()=>Promise<Record<string,unknown>>}[]) {
  const results: Record<string, Record<string,unknown>> = {};
  let blocked = false;
  for (const stage of stages) {
    if (blocked) {results[stage.name] = {status:'NOT_RUN',reason:'PREVIOUS_STAGE_BLOCKED'};continue;}
    try {
      results[stage.name] = await stage.run();
      blocked = results[stage.name]?.status !== 'PASS';
    } catch(error) {
      results[stage.name] = {status:'BLOCKED',errorCode:error instanceof Error && /^[A-Z][A-Z0-9_]+$/u.test(error.message) ? error.message : 'STAGE_EXECUTION_FAILED'};
      blocked = true;
    }
  }
  return results;
}
export function writeEvidence(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {flag:'wx'});
}
export function verifySourceArtifacts(directory: string, sources: unknown, candidateDigest: string, kind: string, mapping?: Record<string,string>): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  try {
    return sources.every(source => {
      if (!source || typeof source.path !== 'string' || !/^[a-f0-9]{64}$/u.test(source.sha256)) return false;
      const locate=(path:string)=>safePath(directory,mapping ? mapping[path] ?? '' : path);
      const bytes=readFileSync(locate(source.path));
      if(hash(bytes)!==source.sha256)return false;
      const record=JSON.parse(bytes.toString());
      const matched = record.kind===kind && record.candidateDigest===candidateDigest
        && typeof record.producerId==='string' && record.producerId.length>0
        && Array.isArray(record.observations) && record.observations.length>0;
      if(!matched)return false;
      if(kind==='BROWSER_CAPTURE') {
        const receiptBytes=readFileSync(locate(record.session.receipt.path));
        if(hash(receiptBytes)!==record.session.receipt.sha256)return false;
        const receipt=JSON.parse(receiptBytes.toString());
        if(receipt.purpose!=='TEMPORARY_VALIDATION' || receipt.oid!==record.session.oid || receipt.requestId!==record.session.requestId)return false;
        if(!Array.isArray(record.captures)||record.captures.length===0)return false;
        return browserSteps.every(key=>{const refs=record.steps?.[key];return Array.isArray(refs)&&refs.length>0&&refs.every(index=>Number.isInteger(index)&&typeof record.captures[index]?.text==='string'&&record.captures[index].text.length>0);});
      }
      return record.status==='PASS' && Array.isArray(record.findings) && record.findings.length===0 && typeof record.sourceRef==='string' && record.sourceRef.length>0;
    });
  } catch {return false;}
}
export function packageSourceArtifacts(directory:string, destination:string, references: {path:string;sha256:string}[]) {
  const mappings: {sourcePath:string;packagedPath:string;sha256:string}[]=[];
  for(const ref of references) {
    const bytes=readFileSync(safePath(directory,ref.path));
    if(hash(bytes)!==ref.sha256)throw new Error('EVIDENCE_SOURCE_CHANGED');
    const filename=ref.sha256+'.json';
    const path=resolve(destination,filename);
    try {writeFileSync(path,bytes,{flag:'wx'});} catch(error) {
      if(!(error instanceof Error && 'code' in error && error.code==='EEXIST') || hash(readFileSync(path))!==ref.sha256)throw error;
    }
    mappings.push({sourcePath:ref.path,packagedPath:'sources/'+filename,sha256:ref.sha256});
  }
  return mappings;
}
function safePath(directory: string, path: string) {
  if (!path || path.includes('\\') || isAbsolute(path) || path.split('/').some(p => !p || p === '..' || p === '.')) throw new Error('EVIDENCE_PATH_INVALID');
  const target = resolve(directory, path);
  const rel = relative(realpathSync(directory), realpathSync(target));
  if (rel.startsWith('..') || isAbsolute(rel) || lstatSync(target).isSymbolicLink()) throw new Error('EVIDENCE_PATH_INVALID');
  return target;
}
function files(directory: string, prefix = ''): string[] {
  return readdirSync(resolve(directory, prefix), {withFileTypes:true}).flatMap(entry => {
    const path = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error('EVIDENCE_PATH_INVALID');
    return entry.isDirectory() ? files(directory, path + '/') : [path];
  }).filter(path => path !== 'manifest.json' && path !== 'manifest.sha256').sort();
}
export function sealEvidence(directory: string, context: Record<string, unknown>) {
  const entries = files(directory).map(path => {
    const bytes = readFileSync(safePath(directory, path));
    return {path, byteLength:bytes.length, sha256:hash(bytes)};
  });
  const manifest = {schemaVersion:'P0_10_EVIDENCE_V2', context, entries};
  const bytes = canonicalJson(manifest as Parameters<typeof canonicalJson>[0]) + '\n';
  writeFileSync(resolve(directory, 'manifest.json'), bytes, {flag:'wx'});
  const digest = hash(bytes);
  writeFileSync(resolve(directory, 'manifest.sha256'), digest + '\n', {flag:'wx'});
  return digest;
}
export function verifyEvidencePackage(directory: string, expectedDigest?: string) {
  const bytes = readFileSync(resolve(directory, 'manifest.json'));
  const digest = hash(bytes);
  if (digest !== readFileSync(resolve(directory, 'manifest.sha256'),'utf8').trim() || (expectedDigest && digest !== expectedDigest)) throw new Error('EVIDENCE_MANIFEST_CHANGED');
  const manifest = JSON.parse(bytes.toString());
  if (manifest.schemaVersion !== 'P0_10_EVIDENCE_V2' || !Array.isArray(manifest.entries)) throw new Error('EVIDENCE_MANIFEST_INVALID');
  const paths = manifest.entries.map((entry: {path:string}) => entry.path);
  if (new Set(paths).size !== paths.length || JSON.stringify(paths) !== JSON.stringify(files(directory))) throw new Error('EVIDENCE_FILE_SET_CHANGED');
  for (const entry of manifest.entries) {
    const artifact = readFileSync(safePath(directory, entry.path));
    if (artifact.length !== entry.byteLength || hash(artifact) !== entry.sha256) throw new Error('EVIDENCE_FILE_CHANGED');
  }
  return {status:'PASS', manifestDigest:digest, files:paths.length};
}
