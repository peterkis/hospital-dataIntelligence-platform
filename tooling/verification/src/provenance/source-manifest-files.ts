export type VerificationSourceFileRole =
  | 'CATALOG'
  | 'COVERAGE_MATRIX'
  | 'GATE_PROOF'
  | 'RUN_PLAN'
  | 'FROZEN_INPUTS'
  | 'SUMMARY_VALIDATOR'
  | 'PRODUCER'
  | 'ORCHESTRATOR'
  | 'REVIEWER'
  | 'CONTRACT_VERSION'
  | 'EVIDENCE_PROTOCOL'
  | 'EVIDENCE_SCHEMA'
  | 'EVIDENCE_RECORDER'
  | 'EVIDENCE_ADAPTER'
  | 'EVIDENCE_VALIDATOR'
  | 'SOURCE_MANIFEST_DEFINITION'
  | 'REVIEWER_COMPATIBILITY'
  | 'RUNTIME_CONTRACT'
  | 'RUNTIME_CONTROLLER'
  | 'TERMINAL_CONTRACT'
  | 'RUNTIME_PREFLIGHT'
  | 'RUNTIME_TEARDOWN'
  | 'WSL_ENVELOPE'
  | 'WSL_HOST'
  | 'NODE_LOADER'
  | 'PACKAGE_DEFINITION'
  | 'RUNTIME_AUTHORITY'
  | 'RUNTIME_AUTHORITY_LOADER'
  | 'RUNTIME_AUTHORITY_SCHEMA'
  | 'PODMAN_MACHINE_INSPECTION'
  | 'RUNTIME_RECEIPT'
  | 'RUNTIME_SCRIPT'
  | 'AR12_HISTORY_EVIDENCE_CONTRACT';

export interface VerificationSourceFileDefinition {
  readonly path: string;
  readonly role: VerificationSourceFileRole;
}

const SOURCE_FILES = [
  ['apps/governance-api/src/composition/phase-01-vertical-slice.integration.test.ts', 'PRODUCER'],
  ['package.json', 'PACKAGE_DEFINITION'],
  ['phase-plan/environment/anolis-8.9-wsl2/bootstrap-phase-01-runtime.sh', 'RUNTIME_SCRIPT'],
  ['phase-plan/environment/anolis-8.9-wsl2/bootstrap-phase-01.sh', 'RUNTIME_SCRIPT'],
  ['phase-plan/environment/anolis-8.9-wsl2/configure-podman-proxy.sh', 'RUNTIME_SCRIPT'],
  ['phase-plan/environment/anolis-8.9-wsl2/podman-phase-01-runtime.sh', 'RUNTIME_SCRIPT'],
  ['phase-plan/environment/anolis-8.9-wsl2/receipt-20260830-podman.json', 'RUNTIME_RECEIPT'],
  ['phase-plan/environment/anolis-8.9-wsl2/runtime-baseline.lock.json', 'RUNTIME_AUTHORITY'],
  ['phase-plan/environment/anolis-8.9-wsl2/verify-phase-01-runtime.sh', 'RUNTIME_SCRIPT'],
  ['tooling/verification/node-ts-loader.mjs', 'NODE_LOADER'],
  ['tooling/verification/package.json', 'PACKAGE_DEFINITION'],
  ['tooling/verification/src/abg-catalog.ts', 'CATALOG'],
  ['tooling/verification/src/abg-coverage-matrix.ts', 'COVERAGE_MATRIX'],
  ['tooling/verification/src/abg-gate-proof.ts', 'GATE_PROOF'],
  ['tooling/verification/src/authoritative-abg-plan.ts', 'RUN_PLAN'],
  ['tooling/verification/src/evidence/adapters.ts', 'EVIDENCE_ADAPTER'],
  ['tooling/verification/src/evidence/protocol.ts', 'EVIDENCE_PROTOCOL'],
  ['tooling/verification/src/evidence/recorder.ts', 'EVIDENCE_RECORDER'],
  ['tooling/verification/src/evidence/schema.ts', 'EVIDENCE_SCHEMA'],
  ['tooling/verification/src/evidence/validate-producer-evidence.ts', 'EVIDENCE_VALIDATOR'],
  ['tooling/verification/src/formal-summary-validator.ts', 'SUMMARY_VALIDATOR'],
  ['tooling/verification/src/frozen-inputs.ts', 'FROZEN_INPUTS'],
  ['tooling/verification/src/produce-abg-gate.ts', 'PRODUCER'],
  ['tooling/verification/src/provenance/reviewer-compatibility.ts', 'REVIEWER_COMPATIBILITY'],
  ['tooling/verification/src/provenance/source-manifest-files.ts', 'SOURCE_MANIFEST_DEFINITION'],
  ['tooling/verification/src/provenance/source-manifest-schema.ts', 'SOURCE_MANIFEST_DEFINITION'],
  ['tooling/verification/src/provenance/source-manifest.ts', 'SOURCE_MANIFEST_DEFINITION'],
  ['tooling/verification/src/provenance/verify-current-source-manifest.ts', 'SOURCE_MANIFEST_DEFINITION'],
  ['tooling/verification/src/rebaseline/ar-12-execution-workspace.ts', 'ORCHESTRATOR'],
  ['tooling/verification/src/rebaseline/ar-12-history-evidence-contract.ts', 'AR12_HISTORY_EVIDENCE_CONTRACT'],
  ['tooling/verification/src/rebaseline/ar-12-orchestrator.ts', 'ORCHESTRATOR'],
  ['tooling/verification/src/review-formal-abg-evidence.ts', 'REVIEWER'],
  ['tooling/verification/src/run-formal-abg.ts', 'ORCHESTRATOR'],
  ['tooling/verification/src/run-shared-abg-verification.ts', 'ORCHESTRATOR'],
  ['tooling/verification/src/runtime/formal-preflight.ts', 'RUNTIME_PREFLIGHT'],
  ['tooling/verification/src/runtime/formal-runtime-contract.ts', 'RUNTIME_CONTRACT'],
  ['tooling/verification/src/runtime/formal-runtime-controller.ts', 'RUNTIME_CONTROLLER'],
  ['tooling/verification/src/runtime/formal-teardown.ts', 'RUNTIME_TEARDOWN'],
  ['tooling/verification/src/runtime/formal-terminal-conclusion.ts', 'TERMINAL_CONTRACT'],
  ['tooling/verification/src/runtime/formal-wsl-envelope.ts', 'WSL_ENVELOPE'],
  ['tooling/verification/src/runtime/formal-wsl-host.ts', 'WSL_HOST'],
  ['tooling/verification/src/runtime/podman-machine-inspection.ts', 'PODMAN_MACHINE_INSPECTION'],
  ['tooling/verification/src/runtime/podman-runtime-authority-schema.ts', 'RUNTIME_AUTHORITY_SCHEMA'],
  ['tooling/verification/src/runtime/podman-runtime-authority.ts', 'RUNTIME_AUTHORITY_LOADER'],
  ['tooling/verification/src/runtime/verify-podman-runtime-authority.ts', 'RUNTIME_AUTHORITY_LOADER'],
  ['tooling/verification/src/verification-contract-versions.ts', 'CONTRACT_VERSION'],
  ['tooling/verification/src/verify-phase-01-live.ts', 'PRODUCER'],
] as const satisfies readonly (readonly [string, VerificationSourceFileRole])[];

export const VERIFICATION_SOURCE_FILES: readonly VerificationSourceFileDefinition[] =
  Object.freeze(SOURCE_FILES.map(([path, role]) => Object.freeze({ path, role })));
