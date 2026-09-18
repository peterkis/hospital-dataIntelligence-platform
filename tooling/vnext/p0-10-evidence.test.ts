import {test, expect} from 'vitest';
import {mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sealEvidence, verifyEvidencePackage, collectStages} from './p0-10-evidence.ts';
import {readEvidence} from './p0-10-gate.mjs';
import {verifySourceArtifacts,packageSourceArtifacts} from './p0-10-evidence.ts';
import {createHash} from 'node:crypto';

test('evidence source references require real matching artifacts and reject tampering', () => {
  const directory=mkdtempSync(join(tmpdir(),'p0-10-source-'));
  try {
    const body=JSON.stringify({kind:'STANDARDS_REVIEW',candidateDigest:'a'.repeat(64),producerId:'unit-reviewer',sourceRef:'synthetic-test-only',status:'PASS',findings:[],observations:['test review observation']});
    writeFileSync(join(directory,'capture.json'),body);
    const source={path:'capture.json',sha256:createHash('sha256').update(body).digest('hex')};
    expect(verifySourceArtifacts(directory,[source],'a'.repeat(64),'STANDARDS_REVIEW')).toBe(true);
    expect(verifySourceArtifacts(directory,[],'a'.repeat(64),'STANDARDS_REVIEW')).toBe(false);
    expect(verifySourceArtifacts(directory,[source],'b'.repeat(64),'STANDARDS_REVIEW')).toBe(false);
    const archive=join(directory,'archive');mkdirSync(archive);mkdirSync(join(archive,'sources'));
    const mappings=packageSourceArtifacts(directory,join(archive,'sources'),[source]);
    rmSync(join(directory,'capture.json'));
    expect(verifySourceArtifacts(archive,[source],'a'.repeat(64),'STANDARDS_REVIEW',Object.fromEntries(mappings.map(entry=>[entry.sourcePath,entry.packagedPath])))).toBe(true);
    writeFileSync(join(directory,'capture.json'),'{}');
    expect(verifySourceArtifacts(directory,[source],'a'.repeat(64),'STANDARDS_REVIEW')).toBe(false);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('sealed evidence rejects missing and unlisted files and an independently retained digest mismatch',()=>{
  const directory=mkdtempSync(join(tmpdir(),'p0-10-manifest-'));
  try {
    writeFileSync(join(directory,'report.json'),'{}');
    const digest=sealEvidence(directory,{});
    expect(()=>verifyEvidencePackage(directory,'0'.repeat(64))).toThrow(/EVIDENCE_MANIFEST_CHANGED/);
    writeFileSync(join(directory,'extra.json'),'{}');
    expect(()=>verifyEvidencePackage(directory,digest)).toThrow(/EVIDENCE_FILE_SET_CHANGED/);
    rmSync(join(directory,'extra.json'));rmSync(join(directory,'report.json'));
    expect(()=>verifyEvidencePackage(directory,digest)).toThrow(/EVIDENCE_FILE_SET_CHANGED/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('malformed optional evidence becomes a blocked observation instead of aborting the evidence package', () => {
  const directory=mkdtempSync(join(tmpdir(),'p0-10-malformed-'));
  try {
    const path=join(directory,'browser.json');writeFileSync(path,'{');
    expect(readEvidence(path)).toEqual({status:'BLOCKED',errorCode:'EVIDENCE_INVALID'});
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('a failed stage retains earlier results and gives every unfinished stage an explicit result', async () => {
  const results = await collectStages([
    {name:'package-coverage',run:async()=>({status:'PASS'})},
    {name:'parser-boundaries',run:async()=>{throw new Error('SYNTHETIC_STAGE_FAILURE');}},
    {name:'db-integration',run:async()=>{throw new Error('MUST_NOT_RUN');}},
  ]);
  expect(results).toEqual({
    'package-coverage':{status:'PASS'},
    'parser-boundaries':{status:'BLOCKED',errorCode:'SYNTHETIC_STAGE_FAILURE'},
    'db-integration':{status:'NOT_RUN',reason:'PREVIOUS_STAGE_BLOCKED'},
  });
});

test('sealed evidence rejects changes to a completed report', () => {
  const directory = mkdtempSync(join(tmpdir(), 'p0-10-evidence-'));
  try {
    writeFileSync(join(directory, 'm0-result.json'), JSON.stringify({status:'BLOCKED'}));
    const digest = sealEvidence(directory, {schemaVersion: 'P0_10_EVIDENCE_V2', scope:'SYNTHETIC'});
    expect(()=>verifyEvidencePackage(directory)).toThrow(/EXTERNAL_DIGEST_REQUIRED/);
    expect(verifyEvidencePackage(directory, digest).status).toBe('PASS');
    writeFileSync(join(directory, 'm0-result.json'), JSON.stringify({status:'PASS'}));
    expect(() => verifyEvidencePackage(directory, digest)).toThrow(/EVIDENCE_FILE_CHANGED/);
  } finally {rmSync(directory, {recursive:true,force:true});}
});
