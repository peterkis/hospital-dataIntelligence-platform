import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignmentPeriodCovered } from '../../apps/governance-api/src/modules/person-master/assignment-contracts.js';
import { temporaryOverlaps } from '../../apps/governance-api/src/modules/person-master/assignment-temporary-assessment.js';

test('C04 microsecond interval algorithms agree with independent finite-set containment and intersection oracles',()=>{
  let state=604;
  const draw=(n:number)=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%n;};
  const at=(n:number)=>`2026-07-01T00:00:00.${String(n).padStart(6,'0')}`;
  for(let i=0;i<2000;i++) {
    const start=draw(40),end=start+1+draw(20),from=draw(40),to=from+1+draw(20),open=i%5===0;
    const parent=new Set(Array.from({length:(open?100:end)-start},(_,j)=>j+start));
    const child=Array.from({length:to-from},(_,j)=>j+from);
    assert.equal(assignmentPeriodCovered(at(start),open?null:at(end),at(from),at(to)),child.every(point=>parent.has(point)));
    assert.equal(temporaryOverlaps(at(from),at(to),{assignmentId:'unused',assignmentVersionId:'unused',
      businessValidFrom:at(start),businessValidTo:open?null:at(end),purposeCode:'ORGANIZATIONAL_AFFILIATION',modeCode:'SECONDMENT'}),
      child.some(point=>parent.has(point)));
  }
});
