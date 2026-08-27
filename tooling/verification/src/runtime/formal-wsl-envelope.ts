/** Typed authority shared by preflight and during/post runtime audits. */
export const FROZEN_WSL_ENVELOPE = Object.freeze({
  distribution: 'Anolis-8.9-HDI-POC',
  osId: 'anolis',
  osVersion: '8.9',
  architecture: 'x86_64',
  initProcess: 'systemd',
  timezone: 'Asia/Shanghai',
  processorCount: 8,
  memoryBytes: 4 * 1024 ** 3,
  memoryToleranceBytes: 384 * 1024 ** 2,
  swapBytes: 0,
  rootDeviceBytes: 10 * 1024 ** 3,
  rootSizeToleranceBytes: 512 * 1024 ** 2,
  minimumRootAvailableBytes: 2 * 1024 ** 3,
  minimumMntDAvailableBytes: 5 * 1024 ** 3,
  wslConfigMemoryValues: ['4GB', '4096MB'] as const,
  wslConfigSwapValues: ['0', '0B', '0GB', '0MB'] as const,
});
