import { test } from 'node:test';
import assert from 'node:assert/strict';

test('P0-02 source mapping retains 53 FULL drafts, all 77 conditions and the original field semantics', async () => {
  const { contractSources } = await import('./contract-sources.mjs');
  const source = contractSources();
  assert.equal(source.drafts.length,53);
  assert.equal(new Set(source.drafts.flatMap(draft=>draft.conditionIds)).size,77);
  assert.equal(source.drafts.reduce((count,draft)=>count+draft.definition.fields.length,0),866);
  const legal = source.drafts.find(draft=>draft.dataset==='ORG01');
  assert.equal(legal.profile,'FULL');
  assert.equal(legal.approval,'DRAFT_NOT_APPROVED');
  assert.equal(legal.definition.fields.find(field=>field.code==='unified_credit_code').condition,'UNRESOLVED');
  assert.ok(legal.definition.references.some(reference=>reference.field==='source_system_id'&&reference.target==='GOV01.system_id'));
  assert.ok(source.drafts.every(draft=>draft.adapterReadiness==='NOT_READY'));
});
