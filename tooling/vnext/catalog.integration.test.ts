import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Command, Outcome } from '../../apps/governance-api/src/modules/governance-catalog/index.js';

test('AC01/02: owner returns exact baseline 53 datasets and 866 source field descriptors', async () => {
  const { openCatalog } = await import('../../apps/governance-api/src/modules/governance-catalog/index.js');
  const catalog = await openCatalog();
  try {
    const result = await catalog.read('maker', { scope: 'BASELINE' });
    assert.equal(result.items.length, 53);
    assert.equal(result.items.reduce((n, item) => n + (item.payload.fields?.length??0), 0), 866);
    const expected=JSON.parse(readFileSync('db/vnext/sources/catalog-metadata.json','utf8'));
    for(const item of result.items) {
      const original=expected.records.find((r:{code:string})=>r.code===item.code);
      assert.deepEqual(item.payload,original);
      assert.equal(item.status,'DRAFT');
      assert.equal(item.payload.original?.['approval_status'],'待院方确认');
    }
    assert.equal(result.domains.length,11);
    assert.match(JSON.stringify(result.items.find(item=>item.code==='ORG07')?.payload.dependencies),/PER01.person_id/);
  } finally { await catalog.close(); }
});

test('governance permissions, lifecycle, concurrency, history and source readiness',async t=>{
  const {openCatalog}=await import('../../apps/governance-api/src/modules/governance-catalog/index.js');
  const catalog=await openCatalog();
  const command=(action:Command['action'],extra:Partial<Command>={}):Command=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_TEST',...extra});
  const transition=(action:Command['action'],o:Outcome)=>command(action,{target:o.id,expectedHead:o.head,...(['PUBLISH','RETIRE'].includes(action)?{reviewDigest:o.reviewDigest}:{})});
  const publish=async(o:Outcome)=>catalog.command('reviewer',transition('PUBLISH',await catalog.command('maker',transition('SUBMIT',o))));
  let dataset:Outcome;
  try{
    await t.test('GV01/02/03/06: immutable candidates, actor identity and exact approved digest',async()=>{
      const initial=command('CREATE',{kind:'DATASET',code:'ORG07',values:{name:'合成目录候选'},validFrom:'2026-01-01T00:00:00.000001',validTo:null});
      dataset=await catalog.command('maker',initial);
      assert.deepEqual(await catalog.command('maker',initial),dataset);
      assert.deepEqual(await catalog.command('maker-alias',initial),dataset,'ACK-loss retry through same identity alias returns original outcome');
      await assert.rejects(catalog.command('maker-alias',{...initial,reason:'CHANGED_ALIAS_PAYLOAD'}),/REQUEST_CONFLICT/);
      await assert.rejects(catalog.command('maker',{...initial,reason:'DIFFERENT'}),/REQUEST_CONFLICT/);
      const review=await catalog.command('maker',transition('SUBMIT',dataset));
      await assert.rejects(catalog.command('maker-alias',transition('PUBLISH',review)),/SELF_REVIEW_FORBIDDEN/);
      await assert.rejects(catalog.command('reviewer',{...transition('PUBLISH',review),reviewDigest:'wrong'}),/REVIEW_DIGEST_MISMATCH/);
      dataset=await catalog.command('reviewer',transition('PUBLISH',review));
      const oldR=dataset.recordedAt;
      const revisions=await Promise.allSettled([1,2].map(n=>catalog.command('maker',command('REVISE',{target:dataset.id,expectedHead:dataset.head,values:{explanation:'合成修订'+n},validFrom:'2026-01-01T00:00:00.000001',validTo:null}))));
      assert.equal(revisions.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(revisions.filter(r=>r.status==='rejected'&&/STALE_HEAD/.test(String(r.reason))).length,1);
      const history=await catalog.history('maker','SYNTHETIC',dataset.id);
      assert.equal(history.length,4);
      assert.equal((await catalog.read('maker',{scope:'SYNTHETIC',asOf:oldR})).items.find(i=>i.id===dataset.id)?.status,'PUBLISHED');
      const revised=revisions.find(r=>r.status==='fulfilled');
      assert.ok(revised&&revised.status==='fulfilled');
      dataset=await publish(revised.value);
      const retired=await catalog.command('reviewer',transition('RETIRE',dataset));
      assert.equal(retired.status,'RETIRED');
      assert.equal((await catalog.history('maker','SYNTHETIC',dataset.id))[0]?.payload.adopted?.name,'合成目录候选');
    });
    await t.test('AC04/MD06: source draft/review/retired/outside period fail closed',async()=>{
      await assert.rejects(catalog.command('maker',command('CREATE',{kind:'SOURCE',code:'MISSING_ENVIRONMENT',values:{name:'合成',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00'})),/SOURCE_FIELDS_REQUIRED/);
      let source=await catalog.command('maker',command('CREATE',{kind:'SOURCE',code:'SYNTHETIC_MANUAL',values:{name:'合成人工登记源',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'UNRESOLVED_DECLARATION',businessOwnerRole:'合成归口岗位',technicalRole:'合成技术岗位',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00',validTo:'2027-01-01T00:00:00'}));
      await assert.rejects(catalog.resolveSource('maker','SYNTHETIC',source.id,'2026-05-01T00:00:00'),/SOURCE_NOT_READY/);
      source=await catalog.command('maker',transition('SUBMIT',source));
      await assert.rejects(catalog.resolveSource('maker','SYNTHETIC',source.id,'2026-05-01T00:00:00'),/SOURCE_NOT_READY/);
      source=await catalog.command('reviewer',transition('PUBLISH',source));
      assert.equal((await catalog.resolveSource('maker','SYNTHETIC',source.id,'2026-05-01T00:00:00'))['realApply'],'NOT_IMPLEMENTED');
      const approvedSource=source;
      source=await catalog.command('maker',command('REVISE',{target:source.id,expectedHead:source.head,values:{name:'未批准修订'},validFrom:'2026-01-01T00:00:00',validTo:'2027-01-01T00:00:00'}));
      assert.equal((await catalog.resolveSource('maker','SYNTHETIC',source.id,'2026-05-01T00:00:00'))['versionId'],approvedSource.versionId);
      source=await catalog.command('maker',transition('SUBMIT',source));
      assert.equal((await catalog.resolveSource('maker','SYNTHETIC',source.id,'2026-05-01T00:00:00'))['versionId'],approvedSource.versionId);
      source=await catalog.command('reviewer',transition('REJECT',source));
      assert.equal((await catalog.resolveSource('maker','SYNTHETIC',source.id,'2026-05-01T00:00:00'))['versionId'],approvedSource.versionId);
      const childCommand=command('CREATE',{kind:'SOURCE',code:'SYNTHETIC_CHILD',values:{name:'合成子来源',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:source.id},validFrom:'2026-01-01T00:00:00',validTo:'2027-01-01T00:00:00'});
      await assert.rejects(catalog.command('maker',{...childCommand,validTo:null}),/SOURCE_PERIOD_NOT_COVERED/);
      const childReview=await catalog.command('maker',transition('SUBMIT',await catalog.command('maker',childCommand)));
      const publishedChild=await publish(await catalog.command('maker',{...childCommand,code:'CHILD_WITH_PENDING_PARENT',requestId:randomUUID()}));
      assert.equal((await catalog.resolveSource('maker','SYNTHETIC',publishedChild.id,'2026-05-01T00:00:00'))['versionId'],publishedChild.versionId);
      await assert.rejects(catalog.command('maker',command('REVISE',{target:source.id,expectedHead:source.head,values:{sourceEvidence:publishedChild.id},validFrom:'2026-01-01T00:00:00',validTo:'2027-01-01T00:00:00'})),/BOOTSTRAP_ROOT_IMMUTABLE/);
      const grandchild=await publish(await catalog.command('maker',{...childCommand,code:'SYNTHETIC_GRANDCHILD',requestId:randomUUID(),values:{...childCommand.values,sourceEvidence:publishedChild.id}}));
      await assert.rejects(catalog.command('maker',command('REVISE',{target:publishedChild.id,expectedHead:publishedChild.head,values:{sourceEvidence:grandchild.id},validFrom:'2026-01-01T00:00:00',validTo:'2027-01-01T00:00:00'})),/SOURCE_REFERENCE_CYCLE/);
      await assert.rejects(catalog.command('maker',{...childCommand,code:'INVALID_SOURCE_ID',requestId:randomUUID(),values:{...childCommand.values,sourceEvidence:'source-1'}}),/SOURCE_REFERENCE_INVALID/);
      await assert.rejects(catalog.resolveSource('maker','SYNTHETIC',source.id,'2027-01-01T00:00:00'),/SOURCE_NOT_READY/);
      await catalog.command('reviewer',{...transition('RETIRE',source),reviewDigest:approvedSource.reviewDigest,impactDigest:(await catalog.sourceImpact('reviewer','SYNTHETIC',source.id)).impactDigest});
      await assert.rejects(catalog.resolveSource('maker','SYNTHETIC',publishedChild.id,'2026-05-01T00:00:00'),/SOURCE_EVIDENCE_NOT_READY/);
      await assert.rejects(catalog.command('reviewer',transition('PUBLISH',childReview)),/SOURCE_EVIDENCE_NOT_READY/);
      await assert.rejects(catalog.resolveSource('maker','SYNTHETIC',source.id,'2026-05-01T00:00:00'),/SOURCE_NOT_READY/);
    });
    await t.test('AC05/GV07: parent/subscope overlap serialized; distinct groups and half-open successor allowed',async()=>{
      const create=async(code:string,authorityScope:string,role='OWNER',from='2026-01-01T00:00:00',to:string|null='2027-01-01T00:00:00')=>catalog.command('maker',command('CREATE',{kind:'RESPONSIBILITY',code,values:{dataset:'ORG07',authorityScope,fieldGroup:'ALL',role,assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:from,validTo:to}));
      const all=await create('OWNER_ALL','ALL');
      const north=await create('OWNER_NORTH','NORTH');
      const reviews=await Promise.all([all,north].map(o=>catalog.command('maker',transition('SUBMIT',o))));
      const attempts=await Promise.allSettled(reviews.map(o=>catalog.command('reviewer',transition('PUBLISH',o))));
      assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(attempts.filter(r=>r.status==='rejected'&&/OWNER_PERIOD_CONFLICT/.test(String(r.reason))).length,1);
      await publish(await create('COLLABORATOR','ALL','COLLABORATOR'));
      await publish(await create('SUCCESSOR','ALL','OWNER','2027-01-01T00:00:00',null));
      await assert.rejects(create('UNKNOWN_SCOPE',''),/RESPONSIBILITY_SCOPE_REQUIRED/);
    });
    await t.test('GV04: current access, closed fields and invalid business times',async()=>{
      await assert.rejects(catalog.read('outsider',{scope:'BASELINE',asOf:'2020-01-01T00:00:00'}),/ACCESS_DENIED/);
      await assert.rejects(catalog.history('maker','BASELINE',dataset.id),/NOT_FOUND/);
      await assert.rejects(catalog.command('maker',command('CREATE',{kind:'DATASET',code:'ORG04',values:{personId:randomUUID()},validFrom:'2026-01-01T00:00:00'})),/CLOSED_FIELDS_REQUIRED/);
      await assert.rejects(catalog.command('maker',command('CREATE',{kind:'DATASET',code:'ORG04',values:{name:'合成'},validFrom:'2026-01-01T00:00:00Z'})),/LOCAL_TIME_REQUIRED/);
    });
  }finally{await catalog.close();}
});
