import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync, existsSync} from 'node:fs';
import {evidenceRunDirectory} from './p0-10-run-directory.mjs';
import {resolve, relative, isAbsolute} from 'node:path';
import {canonicalJson} from '../verification/src/evidence/recorder.js';

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const browserSteps=['makerCheckerDataset','makerCheckerSource','contractCoreCandidate','contractValidationAccept','makerCheckerContract','brEffectivePublishedRead','retireImpactAndRetire','historyAndNoDomainWriteBoundary','AC-01','AC-02','AC-03','AC-04','AC-05'];
const makerSelected=/pop up button[^\n]*Description: 合成验证身份, Value: 编制者 · Maker,/u;
const reviewerSelected=/pop up button[^\n]*Description: 合成验证身份, Value: 复核者 · Reviewer,/u;
const independentSelected=/pop up button[^\n]*Description: 合成操作者, Value: 独立复核人,/u;
// These are the visible outcomes of the fixed synthetic UI protocol, not an
// authenticity signature. The producer's tool transcript remains the trust source.
const browserOutcomes:Record<string,RegExp[][]>={
  makerCheckerDataset:[[makerSelected,/ORG07/u,/已保存 · DRAFT/u],[makerSelected,/ORG07/u,/已保存 · REVIEW/u],[reviewerSelected,/ORG07/u,/已保存 · PUBLISHED/u]],
  makerCheckerSource:[[makerSelected,/P0_\w*SOURCE/u,/已保存 · DRAFT/u],[makerSelected,/P0_\w*SOURCE/u,/已保存 · REVIEW/u],[reviewerSelected,/P0_\w*SOURCE/u,/已保存 · PUBLISHED/u]],
  contractCoreCandidate:[[/CORE/u,/草稿/u,/命令已接受/u]],
  contractValidationAccept:[[/校验 ACCEPT/u]],
  makerCheckerContract:[[/\[SELF_REVIEW_FORBIDDEN\]/u],[independentSelected,/已批准 · 命令已接受/u],[independentSelected,/已发布 · 命令已接受/u]],
  brEffectivePublishedRead:[[/B\/R 有效发布/u,/text 1 当前查询契约/u]],
  retireImpactAndRetire:[[/审批绑定摘要： [a-f0-9]{64}/u],[/已废止 · 命令已接受/u,/text 0 当前查询契约/u]],
  historyAndNoDomainWriteBoundary:[[/下载 v1 原版本 schema/u,/下载 v2 原版本 schema/u],[/不执行文件导入或业务 apply/u]],
  'AC-01':[[/\[UNKNOWN_FIELD\]/u],[/\[CODESET_AUTHORITY_INVALID\]/u]],
  'AC-02':[[/校验 REVIEW · UNRESOLVED_REQUIRED_CONDITION/u],[independentSelected,/\[CONTRACT_VALIDATION_BLOCKED\]/u]],
  'AC-03':[[/已发布 · 命令已接受/u,/下载 v3 原版本 schema/u]],
  'AC-04':[[/\[IMMUTABLE_RULE_VERSION\]/u,/下载 v1 原版本 schema/u,/下载 v2 原版本 schema/u]],
  'AC-05':[[/校验 REVIEW · CODESET_NOT_ADOPTED/u],[independentSelected,/\[CONTRACT_VALIDATION_BLOCKED\]/u]],
};
function browserOutcomesMatch(record:{sourceRef?:unknown;session:{url:string};captures:{text:string;at:string;action?:{command:string;sourceRef:string}}[];steps:Record<string,number[]>}) {
  if(typeof record.sourceRef!=='string'||!record.sourceRef)return false;
  const identities=new Map<string,string>();
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
  for(const key of browserSteps) {
    const refs=record.steps?.[key];
    if(!Array.isArray(refs)||!refs.length||new Set(refs).size!==refs.length)return false;
    if(!refs.every((index,position)=>Number.isInteger(index)&&index>=0&&typeof record.captures[index]?.text==='string'
      &&Number.isFinite(Date.parse(record.captures[index]!.at))&&(position===0||index>refs[position-1]!)))return false;
    const selected=refs.map(index=>record.captures[index]!.text);
    const kind=key==='makerCheckerDataset'?'DATASET':key==='makerCheckerSource'?'SOURCE':'CONTRACT';
    for(const text of selected) {
      const observedUrl=/^Browser tab:[^\n]*, URL: "([^"]+)"\.$/u.exec(text.split('\n')[0]!);
      if(!observedUrl)return false;
      const url=new URL(observedUrl[1]!);
      const id=url.searchParams.get('id') ?? '';
      if(url.origin!==new URL(record.session.url).origin||url.searchParams.get('scope')!=='SYNTHETIC'||!uuid.test(id))return false;
      if(url.pathname!==(kind==='CONTRACT'?'/admin/vnext/contracts':'/admin/vnext/catalog')||(kind!=='CONTRACT'&&url.searchParams.get('kind')!==kind))return false;
      if(identities.has(kind)&&identities.get(kind)!==id.toLowerCase())return false;
      identities.set(kind,id.toLowerCase());
    }
    if(!browserOutcomes[key]!.every(patterns=>selected.some(text=>patterns.every(pattern=>pattern.test(text)))))return false;
  }
  const acceptedRefs=new Set([...record.steps.contractValidationAccept!,...record.steps.makerCheckerContract!,...record.steps['AC-03']!,...record.steps.brEffectivePublishedRead!,record.steps.retireImpactAndRetire![0]!]);
  const versions=[...acceptedRefs].map(index=>/text 契约版本： ([a-f0-9-]+)/iu.exec(record.captures[index]!.text)?.[1]?.toLowerCase());
  if(versions.some(id=>!id||!uuid.test(id))||new Set(versions).size!==1)return false;
  const rejected=record.steps['AC-02']!.map(index=>record.captures[index]!).filter(capture=>independentSelected.test(capture.text)&&/\[CONTRACT_VALIDATION_BLOCKED\]/u.test(capture.text));
  if(rejected.length!==2||Date.parse(rejected[0]!.at)>=Date.parse(rejected[1]!.at))return false;
  if(!['APPROVE_CONTRACT','PUBLISH_CONTRACT'].every((command,index)=>rejected[index]!.action?.command===command
    &&typeof rejected[index]!.action?.sourceRef==='string'&&rejected[index]!.action!.sourceRef.length>0))return false;
  if(rejected[0]!.action!.sourceRef===rejected[1]!.action!.sourceRef)return false;
  const replay=record.steps['AC-03']!.map(index=>record.captures[index]!);
  if(replay.length!==2||!replay.every(item=>/已发布 · 命令已接受/u.test(item.text))||Date.parse(replay[0]!.at)>=Date.parse(replay[1]!.at))return false;
  const history=(text:string)=>text.split('\n').map(line=>line.trim().replace(/^\d+ /u,'')).filter(line=>/^text (?:草稿|已批准|已发布|已废止)\s+· v \d+\s+· /u.test(line)||/^button 下载 v\d+ 原版本 schema$/u.test(line));
  const firstHistory=history(replay[0]!.text);
  const fullRows=firstHistory.filter(line=>line.startsWith('text '));
  const timestamp='\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?';
  const rowShape=new RegExp('^text (?:草稿|已批准|已发布|已废止)\\s+· v [1-9][0-9]*\\s+·\\s+\\S+ ('+timestamp+') \\[ ('+timestamp+') ,\\s+(无界|'+timestamp+') \\)$','u');
  if(!fullRows.every(row=>{const match=rowShape.exec(row);return match && [match[1],match[2],...(match[3]==='无界'?[]:[match[3]])].every(time=>Number.isFinite(Date.parse(time!)));}))return false;
  const rows=fullRows.length;
  return rows>=3 && firstHistory.length===rows*2 && JSON.stringify(firstHistory)===JSON.stringify(history(replay[1]!.text));
}
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
export function finalizeP0Evidence(directory:string,currentCandidate:string) {
  evidenceRunDirectory(directory);
  const read=(name:string)=>{try{return JSON.parse(readFileSync(resolve(directory,name+'.json'),'utf8'));}catch{return undefined;}};
  const pending=read('pending-finalization');
  const terminal=read('wrapper-cleanup');
  const gate=['PASS','BLOCKED'].includes(pending?.gate?.status) && Array.isArray(pending.gate.blockers)?pending.gate:{status:'BLOCKED',blockers:['PENDING_EVIDENCE_MISSING']};
  const context=pending?.context ?? {candidateDigest:currentCandidate};
  const cleanupPassed=terminal?.status==='DATABASE_SESSION_CLOSED'&&terminal.ready===true&&terminal.targetExitCode===0&&terminal.cleanupPassed===true;
  if(!cleanupPassed){gate.status='BLOCKED';gate.blockers.push('WRAPPER_CLEANUP_REQUIRED');}
  if(context.candidateDigest!==currentCandidate){gate.status='BLOCKED';gate.blockers.push('CANDIDATE_CHANGED');}
  for(const name of ['package-coverage','parser-boundaries','db-integration','browser','review','guardrails']) {
    if(read(name)?.status!=='PASS'){gate.status='BLOCKED';gate.blockers.push('REQUIRED_STAGE_'+name);}
    if(!existsSync(resolve(directory,name+'.json')))writeEvidence(resolve(directory,name+'.json'),{status:'NOT_RUN',reason:'WRAPPER_TARGET_DID_NOT_COMPLETE'});
  }
  gate.wrapperCleanupPassed=cleanupPassed;
  writeEvidence(resolve(directory,'m0-result.json'),gate);
  const manifestDigest=sealEvidence(directory,context);
  verifyEvidencePackage(directory,manifestDigest);
  return {status:gate.status,blockers:gate.blockers,manifestDigest,evidence:directory};
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
        return browserOutcomesMatch(record);
      }
      return record.status==='PASS' && Array.isArray(record.findings) && record.findings.length===0 && typeof record.sourceRef==='string' && record.sourceRef.length>0;
    });
  } catch {return false;}
}
export function verifyIndependentReviews(directory:string,standards:unknown,spec:unknown,candidateDigest:string,mapping?:Record<string,string>) {
  if(!Array.isArray(standards)||!Array.isArray(spec)
    ||!verifySourceArtifacts(directory,standards,candidateDigest,'STANDARDS_REVIEW',mapping)
    ||!verifySourceArtifacts(directory,spec,candidateDigest,'SPEC_REVIEW',mapping))return false;
  const identities=(sources:{path:string}[])=>sources.map(source=>JSON.parse(readFileSync(safePath(directory,mapping?mapping[source.path]??'':source.path),'utf8')).producerId.trim().toLowerCase());
  const first=identities(standards),second=identities(spec);
  return first.every(id=>id.length>0)&&second.every(id=>id.length>0&&!first.includes(id));
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
  const manifest = {schemaVersion:'P0_10_EVIDENCE_V3', context, entries};
  const bytes = canonicalJson(manifest as Parameters<typeof canonicalJson>[0]) + '\n';
  writeFileSync(resolve(directory, 'manifest.json'), bytes, {flag:'wx'});
  const digest = hash(bytes);
  writeFileSync(resolve(directory, 'manifest.sha256'), digest + '\n', {flag:'wx'});
  return digest;
}
export function verifyEvidencePackage(directory: string, expectedDigest?: string) {
  if(typeof expectedDigest!=='string' || !/^[a-f0-9]{64}$/u.test(expectedDigest))throw new Error('EXTERNAL_DIGEST_REQUIRED');
  const bytes = readFileSync(resolve(directory, 'manifest.json'));
  const digest = hash(bytes);
  if (digest !== readFileSync(resolve(directory, 'manifest.sha256'),'utf8').trim() || (expectedDigest && digest !== expectedDigest)) throw new Error('EVIDENCE_MANIFEST_CHANGED');
  const manifest = JSON.parse(bytes.toString());
  if (manifest.schemaVersion !== 'P0_10_EVIDENCE_V3' || !Array.isArray(manifest.entries)) throw new Error('EVIDENCE_MANIFEST_INVALID');
  const paths = manifest.entries.map((entry: {path:string}) => entry.path);
  if (new Set(paths).size !== paths.length || JSON.stringify(paths) !== JSON.stringify(files(directory))) throw new Error('EVIDENCE_FILE_SET_CHANGED');
  for (const entry of manifest.entries) {
    const artifact = readFileSync(safePath(directory, entry.path));
    if (artifact.length !== entry.byteLength || hash(artifact) !== entry.sha256) throw new Error('EVIDENCE_FILE_CHANGED');
  }
  return {status:'PASS', manifestDigest:digest, files:paths.length};
}
