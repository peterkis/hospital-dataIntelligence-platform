// Closed vocabulary: neither callers nor stored evidence can create label names.
export const METRIC_DEFINITIONS = {
  release_publish_total: { type: 'counter', help: 'Committed canonical releases.', labels: [] },
  consumer_apply_total: { type: 'counter', help: 'APPLIED closures or reported callback failures.', labels: ['mode', 'result'] },
  consumer_digest_failure_total: { type: 'counter', help: 'Primary digest verification failures.', labels: ['mode', 'bounded_reason'] },
  consumer_replay_total: { type: 'counter', help: 'Terminal real replay attempts, including recovery attempts.', labels: ['mode', 'result'] },
  consumer_checkpoint_lag_seconds: { type: 'gauge', help: 'Maximum eligible publication time gap; zero is not proof of application.', labels: ['criticality'] },
  consumer_sla_breached: { type: 'gauge', help: 'Currently overdue ACTIVE consumers with configured SLA.', labels: ['criticality'] },
} as const;
export type ConsumerMetricName = keyof typeof METRIC_DEFINITIONS;
export interface ConsumerMetricFact {
  name: ConsumerMetricName;
  projectionType: string;
  projectionSchemaVersion: string;
  labels: Readonly<Record<string, string>>;
  value: string;
}
const VALUES = {
  mode: ['normal', 'replay'], result: ['success', 'failed'],
  bounded_reason: ['content_digest_mismatch', 'schema_digest_mismatch', 'processing_digest_mismatch'],
  criticality: ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'],
} as const;

export function renderConsumerMetrics(facts: readonly ConsumerMetricFact[],
  pairs: readonly { projectionType: string; schemaVersion: string }[]): string {
  const allowed = new Set(pairs.map(pair => `${pair.projectionType}@${pair.schemaVersion}`));
  allowed.add('unknown@unknown'); // Failed resolution has no assigned projection.
  const samples = new Map<string, number>();
  const key = (name: ConsumerMetricName, type: string, version: string, labels: Readonly<Record<string, string>>) =>
    `${name}{projection_type="${type}",projection_schema_version="${version}"${Object.keys(labels).sort().map(label => `,${label}="${labels[label]}"`).join('')}}`;
  for (const pair of [...pairs, { projectionType: 'unknown', schemaVersion: 'unknown' }]) {
    if (!/^[a-z][a-z0-9.-]{0,63}$/u.test(pair.projectionType) || !/^[a-z0-9.-]{1,32}$/u.test(pair.schemaVersion)) {
      throw new Error('METRIC_LABEL_INVALID');
    }
    for (const [name, definition] of Object.entries(METRIC_DEFINITIONS)) {
      let combinations: Record<string, string>[] = [{}];
      for (const label of definition.labels) combinations = combinations.flatMap(prior => VALUES[label].map(value => ({ ...prior, [label]: value })));
      for (const labels of combinations) samples.set(key(name as ConsumerMetricName, pair.projectionType, pair.schemaVersion, labels), 0);
    }
  }
  for (const fact of facts) {
    const definition = METRIC_DEFINITIONS[fact.name];
    if (!definition || Object.keys(fact.labels).sort().join(',') !== [...definition.labels].sort().join(',') ||
        !Object.entries(fact.labels).every(([label, value]) => (VALUES[label as keyof typeof VALUES] as readonly string[] | undefined)?.includes(value))) {
      throw new Error('METRIC_LABEL_INVALID');
    }
    const known = allowed.has(`${fact.projectionType}@${fact.projectionSchemaVersion}`);
    const sample = key(fact.name, known ? fact.projectionType : 'unknown', known ? fact.projectionSchemaVersion : 'unknown', fact.labels);
    const value = Number(fact.value);
    if (!/^\d+(?:\.\d+)?$/u.test(fact.value) || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER ||
        (definition.type === 'counter' && !Number.isSafeInteger(value))) throw new Error('METRIC_VALUE_INVALID');
    const previous = samples.get(sample)!;
    const combined = fact.name === 'consumer_checkpoint_lag_seconds' ? Math.max(previous, value) : previous + value;
    if (combined > Number.MAX_SAFE_INTEGER) throw new Error('METRIC_VALUE_INVALID');
    samples.set(sample, combined);
  }
  return '# Synthetic/non-production only; Asia/Shanghai\n' + Object.entries(METRIC_DEFINITIONS).map(([name, definition]) =>
    `# HELP ${name} ${definition.help}\n# TYPE ${name} ${definition.type}\n` + [...samples].filter(([sample]) => sample.startsWith(`${name}{`))
      .sort(([a], [b]) => a.localeCompare(b)).map(([sample, value]) => `${sample} ${value}\n`).join('')).join('');
}
