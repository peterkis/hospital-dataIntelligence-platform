import { test } from 'node:test';
import assert from 'node:assert/strict';
import { functionTokens } from './person-engagement-temporal-schema.mjs';
test('normalization ignores unquoted case/space while preserving SQL literal content and operators', () => {
  assert.deepEqual(functionTokens("BEGIN IF NEW.x <> 'Keep SPACE' THEN RETURN NEW; END IF; END;"),
    functionTokens("begin\n if new.x <> 'Keep SPACE' then return new; end if; end;"));
  assert.notDeepEqual(functionTokens("x <> 'A'"), functionTokens("x = 'A'"));
  assert.notDeepEqual(functionTokens("x = 'A B'"), functionTokens("x = 'a b'"));
  assert.notDeepEqual(functionTokens('"Mixed" = 10'), functionTokens('"mixed" = 1 0'));
  assert.throws(() => functionTokens("E'unsupported'"), /UNSUPPORTED/u);
});
