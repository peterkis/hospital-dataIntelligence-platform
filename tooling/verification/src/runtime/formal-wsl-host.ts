import type { RuntimeCommandRunner } from './formal-runtime-contract.ts';
import { FROZEN_WSL_ENVELOPE } from './formal-wsl-envelope.ts';

export interface WslConfigurationSummary {
  readonly present: boolean;
  readonly processors: string | null;
  readonly memory: string | null;
  readonly swap: string | null;
}

export interface WslHostEvidence {
  readonly runningDistributions: readonly string[];
  readonly configuration: WslConfigurationSummary;
}

export async function inspectWslHost(runner: RuntimeCommandRunner): Promise<WslHostEvidence> {
  const script = [
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
    '$names = @(wsl.exe --list --running --quiet)',
    "$configPath = Join-Path $env:USERPROFILE '.wslconfig'",
    '$values = @{}',
    '$present = Test-Path -LiteralPath $configPath -PathType Leaf',
    "if ($present) { Get-Content -LiteralPath $configPath | ForEach-Object { if ($_ -match '^\\s*(processors|memory|swap)\\s*=\\s*(.*?)\\s*$') { $values[$matches[1].ToLowerInvariant()] = $matches[2] } } }",
    "$result = [ordered]@{ runningDistributions = @($names); configuration = [ordered]@{ present = $present; processors = $values['processors']; memory = $values['memory']; swap = $values['swap'] } }",
    '$result | ConvertTo-Json -Compress -Depth 4',
  ].join('; ');
  const result = await runner.run({
    executable: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', script],
  });
  if (result.exitCode !== 0) throw new Error('WSL_HOST_COMMAND_FAILED');
  const clean = result.stdout.replaceAll('\0', '').trim();
  const value = JSON.parse(clean) as unknown;
  if (!isRecord(value)) throw new Error('WSL_HOST_OUTPUT_INVALID');
  const running = value['runningDistributions'];
  const configuration = value['configuration'];
  if (!Array.isArray(running) || !running.every((item) => typeof item === 'string')) {
    throw new Error('WSL_HOST_RUNNING_SET_INVALID');
  }
  if (!isRecord(configuration) || typeof configuration['present'] !== 'boolean') {
    throw new Error('WSL_HOST_CONFIGURATION_INVALID');
  }
  return {
    runningDistributions: running.map((item) => item.replaceAll('\0', '').trim()).filter(Boolean),
    configuration: {
      present: configuration['present'],
      processors: stringOrNull(configuration['processors']),
      memory: stringOrNull(configuration['memory']),
      swap: stringOrNull(configuration['swap']),
    },
  };
}

export function wslConfigurationMatchesFrozenEnvelope(summary: WslConfigurationSummary): boolean {
  const memory = summary.memory?.replaceAll(/\s/gu, '').toUpperCase() ?? null;
  const swap = summary.swap?.replaceAll(/\s/gu, '').toUpperCase() ?? null;
  return summary.present &&
    summary.processors === String(FROZEN_WSL_ENVELOPE.processorCount) &&
    FROZEN_WSL_ENVELOPE.wslConfigMemoryValues.some((value) => value === memory) &&
    FROZEN_WSL_ENVELOPE.wslConfigSwapValues.some((value) => value === swap);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
