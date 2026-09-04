import { expect, it } from 'vitest';
import { checkpointLagSeconds } from './consumer-metric-facts.js';

it('measures exact absolute microseconds as seconds, with a zero floor for nonmonotonic timestamps', () => {
  expect(checkpointLagSeconds('123000001', '100000000')).toBe('23.000001');
  expect(checkpointLagSeconds('1', '2')).toBe('0');
  expect(checkpointLagSeconds('123000001', '123000001')).toBe('0');
});
