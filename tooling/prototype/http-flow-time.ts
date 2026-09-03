export function buildPriceResolutionTimes(
  flowStartedAt: Date,
  publishedRecordedFrom: string,
): {
  readonly serviceOccurredAt: string;
  readonly recordAsOf: string;
} {
  return {
    serviceOccurredAt: asiaShanghaiLocalDateTime(
      new Date(flowStartedAt.getTime() - 1_000),
    ),
    recordAsOf: publishedRecordedFrom,
  };
}

function asiaShanghaiLocalDateTime(value: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(value).replace(' ', 'T');
}
