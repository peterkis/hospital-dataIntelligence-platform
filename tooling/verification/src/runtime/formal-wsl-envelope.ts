import { loadPodmanRuntimeAuthority } from './podman-runtime-authority.js';

const HOST_AUTHORITY = loadPodmanRuntimeAuthority().authority.host;

/** Derived view of the sole runtime authority shared by preflight and post-runtime audits. */
export const FROZEN_WSL_ENVELOPE = Object.freeze({
  distribution: HOST_AUTHORITY.distribution,
  osId: HOST_AUTHORITY.osId,
  osVersion: HOST_AUTHORITY.osVersion,
  architecture: HOST_AUTHORITY.architecture,
  initProcess: HOST_AUTHORITY.initProcess,
  timezone: HOST_AUTHORITY.timezone,
  processorCount: HOST_AUTHORITY.processorCount,
  memoryBytes: HOST_AUTHORITY.memoryBytes,
  memoryToleranceBytes: HOST_AUTHORITY.memoryToleranceBytes,
  swapBytes: HOST_AUTHORITY.swapBytes,
  rootDeviceBytes: HOST_AUTHORITY.rootFilesystemBytes,
  rootSizeToleranceBytes: HOST_AUTHORITY.rootFilesystemToleranceBytes,
  minimumRootAvailableBytes: HOST_AUTHORITY.minimumRootAvailableBytes,
  minimumMntDAvailableBytes: HOST_AUTHORITY.minimumHostAvailableBytes,
  wslConfigMemoryValues: HOST_AUTHORITY.wslConfigMemoryValues,
  wslConfigSwapValues: HOST_AUTHORITY.wslConfigSwapValues,
});
