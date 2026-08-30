import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { relative, resolve } from 'node:path';

export interface ShellRuntimeEvent {
  readonly stage: string;
  readonly status: 'PASSED' | 'FAILED';
  readonly errorCode: string | null;
  readonly resourceType: string | null;
  readonly resourceName: string | null;
  readonly restartPolicy: string | null;
}

export interface ShellRunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly operations: readonly string[];
  readonly events: readonly ShellRuntimeEvent[];
  readonly eventEvidence: string;
  readonly containers: readonly string[];
  readonly volumes: readonly string[];
}

export interface ShellHarness {
  readonly root: string;
  runRuntime(
    command: 'up' | 'down',
    options?: Readonly<Record<string, string>>,
  ): Promise<ShellRunResult>;
  runBootstrap(options?: Readonly<Record<string, string>>): Promise<ShellRunResult>;
  dispose(): Promise<void>;
}

const repoRoot = resolve(import.meta.dirname, '../../../..');
const environmentDirectory = resolve(
  repoRoot,
  'phase-plan/environment/anolis-8.9-wsl2',
);

const fakePodman = `#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  local raw="$*"
  local sanitized="\${raw}"
  local variable_name
  local value
  for variable_name in \
    POSTGRES_PASSWORD \
    KC_BOOTSTRAP_ADMIN_PASSWORD \
    HDI_POSTGRES_PASSWORD \
    HDI_KEYCLOAK_ADMIN_PASSWORD \
    HDI_OWNER_PASSWORD \
    HDI_BROWSER_CLIENT_SECRET \
    HDI_SIM_CONSUMER_A_CLIENT_SECRET \
    HDI_SIM_CONSUMER_B_CLIENT_SECRET; do
    value="\${!variable_name:-}"
    if [[ -n "\${value}" ]]; then sanitized="\${sanitized//\${value}/[REDACTED]}"; fi
  done
  if [[ "\${sanitized}" != "\${raw}" ]]; then
    printf 'FAKE_SECRET_ARG_DETECTED\n' >>"\${FAKE_PODMAN_LOG}"
  fi
  printf '%s\n' "\${sanitized}" >>"\${FAKE_PODMAN_LOG}"
}
resource_dir() { printf '%s/%s/%s' "\${FAKE_PODMAN_STATE}" "$1" "$2"; }

labels_from_args() {
  local labels='{}'
  local index
  local pair
  local key
  local value
  for ((index = 0; index < \${#arguments[@]}; index += 1)); do
    if [[ "\${arguments[index]}" == '--label' ]]; then
      ((index += 1))
      pair="\${arguments[index]}"
      key="\${pair%%=*}"
      value="\${pair#*=}"
      labels="$(jq --compact-output --arg key "\${key}" --arg value "\${value}" '. + {($key):$value}' <<<"\${labels}")"
    fi
  done
  printf '%s' "\${labels}"
}

create_resource() {
  local type="$1"
  local name="$2"
  local labels="$3"
  local restart_policy="\${4:-}"
  local directory
  if [[ -n "\${FAKE_EXTRA_LABEL_VALUE:-}" ]]; then
    labels="$(jq --compact-output --arg value "\${FAKE_EXTRA_LABEL_VALUE}" '. + {"sensitive.extra":$value}' <<<"\${labels}")"
  fi
  directory="$(resource_dir "\${type}" "\${name}")"
  mkdir -p -- "\${directory}"
  printf '%s' "\${labels}" >"\${directory}/labels.json"
  printf '%s' "\${restart_policy}" >"\${directory}/restart-policy"
  printf 'fake-%s' "\${name}" >"\${directory}/id"
}

mutate_postgres_ownership() {
  local variant="\${FAKE_OWNERSHIP_VARIANT:-}"
  local directory
  local labels
  [[ -n "\${variant}" ]] || return 0
  directory="$(find "\${FAKE_PODMAN_STATE}/container" -maxdepth 1 -type d -name '*_postgres' -print -quit)"
  [[ -n "\${directory}" ]] || return 0
  labels="$(<"\${directory}/labels.json")"
  case "\${variant}" in
    none) labels='{}' ;;
    four) labels="$(jq 'del(."hdi.managed-by")' <<<"\${labels}")" ;;
    run-id) labels="$(jq '."hdi.run-id" = "different-run"' <<<"\${labels}")" ;;
    run-sequence) labels="$(jq '."hdi.run-sequence" = "999"' <<<"\${labels}")" ;;
    managed-by) labels="$(jq '."hdi.managed-by" = "different-manager"' <<<"\${labels}")" ;;
  esac
  printf '%s' "\${labels}" >"\${directory}/labels.json"
}

arguments=("$@")
log "$*"
kind="\${1:-}"
action="\${2:-}"

case "\${kind}:\${action}" in
  version:*)
    jq --raw-output '.authority.podman.version' "\${FAKE_AUTHORITY}"
    ;;
  info:*)
    jq '{
      host: {
        security: {rootless: .authority.podman.rootless},
        networkBackend: .authority.podman.networkBackend,
        logDriver: .authority.podman.logDriver,
        ociRuntime: {name: .authority.podman.ociRuntime},
        cgroupManager: .authority.podman.cgroupManager,
        eventLogger: .authority.podman.eventsBackend
      },
      store: {
        graphDriverName: .authority.podman.storageDriver,
        graphRoot: .authority.podman.graphRoot,
        runRoot: .authority.podman.runRoot
      }
    }' "\${FAKE_AUTHORITY}"
    ;;
  image:inspect)
    image="\${arguments[\${#arguments[@]} - 1]}"
    jq --null-input --compact-output --arg image "\${image}" '[$image]'
    ;;
  volume:exists|container:exists)
    name="\${arguments[\${#arguments[@]} - 1]}"
    directory="$(resource_dir "\${kind}" "\${name}")"
    if [[ "\${FAKE_EXISTS_ERROR_ALWAYS:-}" == '1' ]]; then exit 125; fi
    if [[ -d "\${directory}" && -n "\${FAKE_EXISTS_ERROR_ON_PRESENT:-}" && "\${name}" == "\${FAKE_EXISTS_ERROR_ON_PRESENT}" ]]; then
      if [[ -z "\${FAKE_EXISTS_ERROR_AFTER_LOG:-}" ]] || grep --quiet --fixed-strings "\${FAKE_EXISTS_ERROR_AFTER_LOG}" "\${FAKE_PODMAN_LOG}"; then
        exit 125
      fi
    fi
    if [[ -d "\${directory}" ]]; then exit 0; fi
    exit 1
    ;;
  volume:create)
    name="\${arguments[\${#arguments[@]} - 1]}"
    labels="$(labels_from_args)"
    create_resource volume "\${name}" "\${labels}"
    if [[ "\${FAKE_FAIL:-}" == 'POSTGRES_VOLUME_CREATE' && "\${name}" == *_postgres_data ]]; then exit 31; fi
    if [[ "\${FAKE_FAIL:-}" == 'KEYCLOAK_VOLUME_CREATE' && "\${name}" == *_keycloak_data ]]; then exit 32; fi
    printf '%s\n' "\${name}"
    ;;
  container:create)
    name=''
    restart_policy=''
    for ((index = 0; index < \${#arguments[@]}; index += 1)); do
      case "\${arguments[index]}" in
        --name) ((index += 1)); name="\${arguments[index]}" ;;
        --restart=*) restart_policy="\${arguments[index]#--restart=}" ;;
      esac
    done
    labels="$(labels_from_args)"
    create_resource container "\${name}" "\${labels}" "\${restart_policy}"
    if [[ "\${FAKE_FAIL:-}" == 'POSTGRES_CONTAINER_CREATE' && "\${name}" == *_postgres ]]; then exit 33; fi
    if [[ "\${FAKE_FAIL:-}" == 'KEYCLOAK_CONTAINER_CREATE' && "\${name}" == *_keycloak ]]; then
      mutate_postgres_ownership
      exit 34
    fi
    cat "$(resource_dir container "\${name}")/id"
    ;;
  container:start)
    name="\${arguments[\${#arguments[@]} - 1]}"
    if [[ "\${FAKE_SIGNAL_STAGE:-}" == 'POSTGRES_CONTAINER_START' && "\${name}" == *_postgres ]]; then
      kill "-\${FAKE_SIGNAL_NAME:-INT}" "\${PPID}"
      /bin/sleep 0.05
    fi
    if [[ "\${FAKE_FAIL:-}" == 'POSTGRES_CONTAINER_START' && "\${name}" == *_postgres ]]; then exit 35; fi
    if [[ "\${FAKE_FAIL:-}" == 'KEYCLOAK_CONTAINER_START' && "\${name}" == *_keycloak ]]; then exit 36; fi
    printf '%s\n' "\${name}"
    ;;
  container:inspect)
    name="\${arguments[\${#arguments[@]} - 1]}"
    directory="$(resource_dir container "\${name}")"
    format="\${arguments[3]:-}"
    if [[ "\${format}" == *RestartPolicy* ]]; then
      if [[ "\${FAKE_FAIL:-}" == 'POSTGRES_RESTART_INSPECT' && "\${name}" == *_postgres ]]; then printf 'always\n'; exit 0; fi
      if [[ "\${FAKE_FAIL:-}" == 'KEYCLOAK_RESTART_INSPECT' && "\${name}" == *_keycloak ]]; then printf 'always\n'; exit 0; fi
      cat "\${directory}/restart-policy"
    else
      cat "\${directory}/labels.json"
    fi
    ;;
  volume:inspect)
    name="\${arguments[\${#arguments[@]} - 1]}"
    cat "$(resource_dir volume "\${name}")/labels.json"
    ;;
  container:rm|volume:rm)
    name="\${arguments[\${#arguments[@]} - 1]}"
    if [[ "\${FAKE_CLEANUP_FAIL:-}" == '1' ]]; then exit 91; fi
    rm -rf -- "$(resource_dir "\${kind}" "\${name}")"
    ;;
  exec:*)
    if [[ "$*" == *pg_isready* && "\${FAKE_FAIL:-}" == 'BOOTSTRAP_POSTGRES_READINESS' ]]; then exit 81; fi
    if [[ "$*" == *psql* && "\${FAKE_FAIL:-}" == 'BOOTSTRAP_SCHEMA' ]]; then exit 82; fi
    ;;
  *)
    printf 'unexpected fake podman invocation: %s\n' "$*" >&2
    exit 97
    ;;
esac
`;

const fakeNode = `#!/usr/bin/env bash
set -Eeuo pipefail
case "\${1:-}" in
  -e)
    printf 'encoded-test-password'
    ;;
  *render-keycloak-realm.ts)
    printf 'node:render\n' >>"\${FAKE_PODMAN_LOG}"
    mkdir -p -- "$(dirname -- "$2")"
    printf '{}\n' >"$2"
    ;;
  *apply-migrations.mjs)
    printf 'node:migration\n' >>"\${FAKE_PODMAN_LOG}"
    if [[ -n "\${FAKE_BOOTSTRAP_SIGNAL:-}" ]]; then
      kill "-\${FAKE_BOOTSTRAP_SIGNAL}" "\${PPID}"
      /bin/sleep 0.05
    fi
    [[ "\${FAKE_FAIL:-}" != 'BOOTSTRAP_MIGRATION' ]] || exit 83
    ;;
  *seed-phase-01.ts)
    printf 'node:seed\n' >>"\${FAKE_PODMAN_LOG}"
    [[ "\${FAKE_FAIL:-}" != 'BOOTSTRAP_SEED' ]] || exit 84
    ;;
  *)
    printf 'unexpected fake node invocation\n' >&2
    exit 98
    ;;
esac
`;

const fakeCurl = `#!/usr/bin/env bash
set -Eeuo pipefail
printf 'curl:health\n' >>"\${FAKE_PODMAN_LOG}"
[[ "\${FAKE_FAIL:-}" != 'BOOTSTRAP_KEYCLOAK_READINESS' ]] || exit 85
printf '{"status":"UP"}\n'
`;

const fakeSystemctl = `#!/usr/bin/env bash
set -Eeuo pipefail
printf 'systemctl:%s\n' "$*" >>"\${FAKE_PODMAN_LOG}"
exit 0
`;

const fakeSleep = `#!/usr/bin/env bash
exit 0
`;

const fakeSeq = `#!/usr/bin/env bash
printf '1\n'
`;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function listResourceNames(directory: string): Promise<readonly string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function readEvents(directory: string): Promise<readonly ShellRuntimeEvent[]> {
  let names: readonly string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return Promise.all(names.map(async (name) => JSON.parse(
    await readFile(resolve(directory, name), 'utf8'),
  ) as ShellRuntimeEvent));
}

async function readEventEvidence(directory: string): Promise<string> {
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
    return (await Promise.all(names.map((name) => readFile(resolve(directory, name), 'utf8'))))
      .join('\n');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export async function createShellHarness(): Promise<ShellHarness> {
  const root = resolve(
    repoRoot,
    `.runtime/ar11-shell-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const copiedEnvironment = resolve(root, 'phase-plan/environment/anolis-8.9-wsl2');
  const fakeBin = resolve(root, 'fake-bin');
  const state = resolve(root, 'state');
  const events = resolve(root, 'events');
  const realm = resolve(root, 'realm');
  const operationLog = resolve(root, 'operations.log');

  await mkdir(copiedEnvironment, { recursive: true });
  await Promise.all([
    cp(resolve(environmentDirectory, 'podman-phase-01-runtime.sh'), resolve(copiedEnvironment, 'podman-phase-01-runtime.sh')),
    cp(resolve(environmentDirectory, 'bootstrap-phase-01-runtime.sh'), resolve(copiedEnvironment, 'bootstrap-phase-01-runtime.sh')),
    cp(resolve(environmentDirectory, 'runtime-baseline.lock.json'), resolve(copiedEnvironment, 'runtime-baseline.lock.json')),
    mkdir(fakeBin, { recursive: true }),
    mkdir(resolve(state, 'container'), { recursive: true }),
    mkdir(resolve(state, 'volume'), { recursive: true }),
    mkdir(events, { recursive: true }),
    mkdir(realm, { recursive: true }),
    mkdir(resolve(root, 'db/migrations'), { recursive: true }),
  ]);
  await Promise.all([
    mkdir(resolve(state, 'container/unrelated_container'), { recursive: true }),
    mkdir(resolve(state, 'volume/unrelated_volume'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(resolve(fakeBin, 'podman'), fakePodman, 'utf8'),
    writeFile(resolve(fakeBin, 'node'), fakeNode, 'utf8'),
    writeFile(resolve(fakeBin, 'curl'), fakeCurl, 'utf8'),
    writeFile(resolve(fakeBin, 'systemctl'), fakeSystemctl, 'utf8'),
    writeFile(resolve(fakeBin, 'sleep'), fakeSleep, 'utf8'),
    writeFile(resolve(fakeBin, 'seq'), fakeSeq, 'utf8'),
    writeFile(operationLog, '', 'utf8'),
  ]);

  const harnessRelative = relative(repoRoot, root).replaceAll('\\', '/');
  const linuxRoot = `$PWD/${harnessRelative}`;
  const commonEnvironment: Readonly<Record<string, string>> = {
    ABG_RUN_ID: 'ar11test000001',
    ABG_RUN_SEQUENCE: '7',
    ABG_RUNTIME_NAMESPACE: 'hdi_phase01_abg_7_ar11test0000',
    ABG_RUNTIME_EVENT_DIR: `${linuxRoot}/events`,
    FAKE_AUTHORITY: `${linuxRoot}/phase-plan/environment/anolis-8.9-wsl2/runtime-baseline.lock.json`,
    FAKE_PODMAN_LOG: `${linuxRoot}/operations.log`,
    FAKE_PODMAN_STATE: `${linuxRoot}/state`,
    HDI_KEYCLOAK_REALM_IMPORT_DIR: `${linuxRoot}/realm`,
    POSTGRES_PASSWORD: 'postgres-P@ss:/+value',
    KC_BOOTSTRAP_ADMIN_USERNAME: 'admin-user',
    KC_BOOTSTRAP_ADMIN_PASSWORD: 'keycloak-P@ss:/+value',
    HDI_POSTGRES_PASSWORD: 'postgres-P@ss:/+value',
    HDI_KEYCLOAK_ADMIN_USERNAME: 'admin-user',
    HDI_KEYCLOAK_ADMIN_PASSWORD: 'keycloak-P@ss:/+value',
    HDI_OWNER_PASSWORD: 'owner-P@ss:/+value',
    HDI_BROWSER_CLIENT_SECRET: 'browser-P@ss:/+value',
    HDI_SIM_CONSUMER_A_CLIENT_SECRET: 'consumer-a-P@ss:/+value',
    HDI_SIM_CONSUMER_B_CLIENT_SECRET: 'consumer-b-P@ss:/+value',
  };

  async function run(
    scriptName: string,
    argument: string | null,
    options: Readonly<Record<string, string>> = {},
  ): Promise<ShellRunResult> {
    await writeFile(operationLog, '', 'utf8');
    await rm(events, { recursive: true, force: true });
    await mkdir(events, { recursive: true });
    const environment = { ...commonEnvironment, ...options };
    const assignments = Object.entries(environment)
      .map(([key, value]) => `${key}=${shellQuote(value)}`)
      .join(' ');
    const script = `${linuxRoot}/phase-plan/environment/anolis-8.9-wsl2/${scriptName}`;
    const command = [
      `chmod 0700 ${shellQuote(`${linuxRoot}/fake-bin/podman`)} ${shellQuote(`${linuxRoot}/fake-bin/node`)} ${shellQuote(`${linuxRoot}/fake-bin/curl`)} ${shellQuote(`${linuxRoot}/fake-bin/systemctl`)} ${shellQuote(`${linuxRoot}/fake-bin/sleep`)} ${shellQuote(`${linuxRoot}/fake-bin/seq`)}`,
      `env PATH=${shellQuote(`${linuxRoot}/fake-bin:/usr/bin:/bin`)} ${assignments} bash ${shellQuote(script)}${argument === null ? '' : ` ${shellQuote(argument)}`}`,
    ].join(' && ');
    const result = spawnSync('bash', ['-lc', command], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 60_000,
    });
    const operationsText = await readFile(operationLog, 'utf8');
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      operations: operationsText.split(/\r?\n/u).filter(Boolean),
      events: await readEvents(events),
      eventEvidence: await readEventEvidence(events),
      containers: await listResourceNames(resolve(state, 'container')),
      volumes: await listResourceNames(resolve(state, 'volume')),
    };
  }

  return {
    root,
    runRuntime(command, options) {
      return run('podman-phase-01-runtime.sh', command, options);
    },
    runBootstrap(options) {
      return run('bootstrap-phase-01-runtime.sh', null, options);
    },
    dispose() {
      return rm(root, { recursive: true, force: true });
    },
  };
}
