import { describe, expect, it } from 'vitest';
import { METRIC_DEFINITIONS, renderConsumerMetrics, type ConsumerMetricFact } from './consumer-metrics.js';

const pairs = [{ projectionType: 'hdi.department-master', schemaVersion: '1' }];
const fact: ConsumerMetricFact = { name: 'consumer_apply_total', projectionType: 'hdi.department-master',
  projectionSchemaVersion: '1', labels: { mode: 'normal', result: 'success' }, value: '1' };
describe('closed operational metrics', () => {
  it('has stable zero series, deterministic bytes, six families and a state gauge for SLA', () => {
    const text = renderConsumerMetrics([], pairs);
    expect(renderConsumerMetrics([], pairs)).toBe(text);
    expect(Object.keys(METRIC_DEFINITIONS)).toHaveLength(6);
    expect(text).toContain('# TYPE consumer_sla_breached gauge');
    expect(text.split('\n').filter(line => line && !line.startsWith('#'))).toHaveLength(46);
  });
  it.each(['subscriptionId', 'releaseId', 'governanceObjectId', 'servicePrincipalId', 'requestId', 'correlationId', 'departmentId', 'error'])(
    'rejects the unbounded label %s at runtime', label => {
      expect(() => renderConsumerMetrics([{ ...fact, labels: { ...fact.labels, [label]: 'private' } }], pairs)).toThrow('METRIC_LABEL_INVALID');
    });
  it.each([{ mode: 'dry-run', result: 'success' }, { mode: 'normal', result: 'HTTP_200' }, { mode: 'normal', bounded_reason: 'private error' }])(
    'rejects unregistered label values', labels => {
      expect(() => renderConsumerMetrics([{ ...fact, labels }], pairs)).toThrow('METRIC_LABEL_INVALID');
    });
  it('collapses arbitrary projection values without serializing or allocating arbitrary series', () => {
    const text = renderConsumerMetrics(Array.from({ length: 2000 }, (_, i) => ({ ...fact, projectionType: `private-${i}` })), pairs);
    expect(text).not.toContain('private');
    expect(text).toContain('consumer_apply_total{projection_type="unknown",projection_schema_version="unknown",mode="normal",result="success"} 2000');
    expect(text.split('\n').filter(line => line && !line.startsWith('#'))).toHaveLength(46);
  });
  it('uses maximum lag rather than summing seconds across consumers', () => {
    const lag: ConsumerMetricFact = { ...fact, name: 'consumer_checkpoint_lag_seconds', labels: { criticality: 'NORMAL' }, value: '1.25' };
    expect(renderConsumerMetrics([lag, { ...lag, value: '3.5' }], pairs)).toContain('criticality="NORMAL"} 3.5');
  });
  it.each(['NaN', '-1', 'Infinity', '1\nsecret', '9007199254740992', '0.5'])('rejects invalid counter values %s', value => {
    expect(() => renderConsumerMetrics([{ ...fact, value }], pairs)).toThrow('METRIC_VALUE_INVALID');
  });
});
