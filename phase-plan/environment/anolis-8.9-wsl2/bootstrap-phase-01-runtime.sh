#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
readonly AUTHORITY_PATH="${SCRIPT_DIR}/runtime-baseline.lock.json"

BOOTSTRAP_EVENT_SEQUENCE=0
BOOTSTRAP_STAGE='BOOTSTRAP_AUTHORITY_VALIDATION'
BOOTSTRAP_ERROR_CODE='PODMAN_RUNTIME_AUTHORITY_INVALID'
RUNTIME_UP=0

if [[ -n "${ABG_RUN_ID:-}" ]]; then
  [[ "${ABG_RUN_ID}" =~ ^[A-Za-z0-9-]+$ ]] || {
    echo 'ERROR_CODE=BOOTSTRAP_RUNTIME_IDENTITY_INVALID' >&2
    exit 1
  }
  readonly RUN_SEQUENCE="${ABG_RUN_SEQUENCE:?ABG_RUN_SEQUENCE is required}"
  [[ "${RUN_SEQUENCE}" =~ ^[1-9][0-9]*$ ]] || {
    echo 'ERROR_CODE=BOOTSTRAP_RUNTIME_IDENTITY_INVALID' >&2
    exit 1
  }
  readonly SAFE_RUN_ID="$(printf '%s' "${ABG_RUN_ID}" | tr -cd '[:alnum:]' | tr '[:upper:]' '[:lower:]' | cut -c1-12)"
  (( ${#SAFE_RUN_ID} >= 8 )) || {
    echo 'ERROR_CODE=BOOTSTRAP_RUNTIME_IDENTITY_INVALID' >&2
    exit 1
  }
  readonly EXPECTED_RUNTIME_NAMESPACE="hdi_phase01_abg_${RUN_SEQUENCE}_${SAFE_RUN_ID}"
  [[ "${ABG_RUNTIME_NAMESPACE:-}" == "${EXPECTED_RUNTIME_NAMESPACE}" ]] || {
    echo 'ERROR_CODE=BOOTSTRAP_RUNTIME_IDENTITY_INVALID' >&2
    exit 1
  }
  export ABG_RUNTIME_NAMESPACE="${EXPECTED_RUNTIME_NAMESPACE}"
  readonly RUNTIME_ROOT="${REPO_ROOT}/.runtime/abg-runtime/${ABG_RUN_ID}"
  readonly BOOTSTRAP_RUN_ID="${ABG_RUN_ID}"
else
  readonly RUN_SEQUENCE='0'
  export ABG_RUNTIME_NAMESPACE="${ABG_RUNTIME_NAMESPACE:-hdi_phase01_bootstrap}"
  [[ "${ABG_RUNTIME_NAMESPACE}" =~ ^hdi_phase01_[a-z0-9_]+$ ]] || {
    echo 'ERROR_CODE=BOOTSTRAP_RUNTIME_IDENTITY_INVALID' >&2
    exit 1
  }
  readonly RUNTIME_ROOT="${REPO_ROOT}/.runtime"
  readonly BOOTSTRAP_RUN_ID='manual-bootstrap'
fi

record_bootstrap_event() {
  [[ -n "${ABG_RUNTIME_EVENT_DIR:-}" ]] || return 0
  local stage="$1"
  local status="$2"
  local error_code="${3:-}"
  local event_name
  local event_path
  local temporary_path

  printf -v event_name 'bootstrap-%06d-%s.json' "${BOOTSTRAP_EVENT_SEQUENCE}" "${stage,,}"
  event_name="${event_name//_/-}"
  event_path="${ABG_RUNTIME_EVENT_DIR}/${event_name}"
  temporary_path="${event_path}.tmp.$$"
  mkdir -p -- "${ABG_RUNTIME_EVENT_DIR}"
  jq --null-input \
    --arg schemaVersion 'phase-01.bootstrap-runtime-event.v1' \
    --arg runId "${BOOTSTRAP_RUN_ID}" \
    --arg runSequence "${RUN_SEQUENCE}" \
    --arg runtimeNamespace "${ABG_RUNTIME_NAMESPACE}" \
    --arg stage "${stage}" \
    --arg status "${status}" \
    --arg errorCode "${error_code}" \
    --arg occurredAt "$(date --utc +'%Y-%m-%dT%H:%M:%SZ')" \
    '{
      schemaVersion: $schemaVersion,
      runId: $runId,
      runSequence: $runSequence,
      runtimeNamespace: $runtimeNamespace,
      stage: $stage,
      status: $status,
      resourceType: null,
      resourceName: null,
      resourceId: null,
      expectedLabels: null,
      actualLabels: null,
      restartPolicy: null,
      errorCode: (if $errorCode == "" then null else $errorCode end),
      occurredAt: $occurredAt
    }' >"${temporary_path}"
  mv -- "${temporary_path}" "${event_path}"
  ((BOOTSTRAP_EVENT_SEQUENCE += 1))
}

validate_and_load_authority() {
  command -v jq >/dev/null 2>&1 || return 1
  [[ -f "${AUTHORITY_PATH}" && ! -L "${AUTHORITY_PATH}" ]] || return 1
  jq --exit-status '
    .schemaVersion == 3 and
    .authorityId == "phase-01.podman-runtime-authority.v1" and
    .authority.podman.rootless == false and
    .authority.podman.restartPolicy == "no" and
    .authority.network.managedContainerMode == "host" and
    .authority.network.bridgeNetworkingAllowed == false and
    .authority.network.portPublishingAllowed == false and
    .authority.network.bindAddress == "127.0.0.1" and
    (.authority.network.ports.postgresRuntime | type == "number") and
    (.authority.network.ports.keycloakHttp | type == "number") and
    (.authority.network.ports.keycloakManagement | type == "number")
  ' "${AUTHORITY_PATH}" >/dev/null
  POSTGRES_PORT="$(jq --exit-status --raw-output '.authority.network.ports.postgresRuntime | select(type == "number")' "${AUTHORITY_PATH}")"
  KEYCLOAK_HTTP_PORT="$(jq --exit-status --raw-output '.authority.network.ports.keycloakHttp | select(type == "number")' "${AUTHORITY_PATH}")"
  KEYCLOAK_MANAGEMENT_PORT="$(jq --exit-status --raw-output '.authority.network.ports.keycloakManagement | select(type == "number")' "${AUTHORITY_PATH}")"
  LOOPBACK_BIND_ADDRESS="$(jq --exit-status --raw-output '.authority.network.bindAddress | select(type == "string" and length > 0)' "${AUTHORITY_PATH}")"
}

handle_bootstrap_failure() {
  local original_status="${1:-1}"
  trap - ERR INT TERM
  set +e
  (( original_status != 0 )) || original_status=1
  echo "ERROR_CODE=${BOOTSTRAP_ERROR_CODE}" >&2
  record_bootstrap_event "${BOOTSTRAP_STAGE}" 'FAILED' "${BOOTSTRAP_ERROR_CODE}"
  if (( RUNTIME_UP == 1 )); then
    if ! bash "${SCRIPT_DIR}/podman-phase-01-runtime.sh" down; then
      echo 'ERROR_CODE=BOOTSTRAP_FAILURE_CLEANUP_FAILED' >&2
      record_bootstrap_event 'BOOTSTRAP_FAILURE_CLEANUP' 'FAILED' 'BOOTSTRAP_FAILURE_CLEANUP_FAILED'
    else
      record_bootstrap_event 'BOOTSTRAP_FAILURE_CLEANUP' 'PASSED'
    fi
  fi
  exit "${original_status}"
}

handle_bootstrap_signal() {
  local signal_name="$1"
  local signal_status="$2"
  BOOTSTRAP_ERROR_CODE="BOOTSTRAP_SIGNAL_${signal_name}"
  handle_bootstrap_failure "${signal_status}"
}

begin_bootstrap_stage() {
  BOOTSTRAP_STAGE="$1"
  BOOTSTRAP_ERROR_CODE="$2"
}

trap 'handle_bootstrap_failure $?' ERR
trap 'handle_bootstrap_signal SIGINT 130' INT
trap 'handle_bootstrap_signal SIGTERM 143' TERM

begin_bootstrap_stage 'BOOTSTRAP_AUTHORITY_VALIDATION' 'PODMAN_RUNTIME_AUTHORITY_INVALID'
validate_and_load_authority
readonly POSTGRES_PORT KEYCLOAK_HTTP_PORT KEYCLOAK_MANAGEMENT_PORT LOOPBACK_BIND_ADDRESS
record_bootstrap_event "${BOOTSTRAP_STAGE}" 'PASSED'

for variable_name in \
  HDI_POSTGRES_PASSWORD \
  HDI_KEYCLOAK_ADMIN_USERNAME \
  HDI_KEYCLOAK_ADMIN_PASSWORD \
  HDI_OWNER_PASSWORD \
  HDI_BROWSER_CLIENT_SECRET \
  HDI_SIM_CONSUMER_A_CLIENT_SECRET \
  HDI_SIM_CONSUMER_B_CLIENT_SECRET; do
  [[ -n "${!variable_name:-}" ]] || {
    BOOTSTRAP_STAGE='BOOTSTRAP_ENVIRONMENT_VALIDATION'
    BOOTSTRAP_ERROR_CODE='BOOTSTRAP_REQUIRED_ENVIRONMENT_MISSING'
    false
  }
done

readonly REALM_IMPORT_DIR="${RUNTIME_ROOT}/keycloak-import"
readonly REALM_IMPORT="${REALM_IMPORT_DIR}/hdi-phase01-realm.json"
readonly MIGRATION_DIRECTORY="${REPO_ROOT}/db/migrations"

export HDI_KEYCLOAK_REALM_IMPORT_DIR="${REALM_IMPORT_DIR}"
export POSTGRES_PASSWORD="${HDI_POSTGRES_PASSWORD}"
export KC_BOOTSTRAP_ADMIN_USERNAME="${HDI_KEYCLOAK_ADMIN_USERNAME}"
export KC_BOOTSTRAP_ADMIN_PASSWORD="${HDI_KEYCLOAK_ADMIN_PASSWORD}"
encoded_postgres_password="$(node -e "process.stdout.write(encodeURIComponent(process.env.HDI_POSTGRES_PASSWORD))")"
export DATABASE_URL="postgresql://hdi_phase01:${encoded_postgres_password}@${LOOPBACK_BIND_ADDRESS}:${POSTGRES_PORT}/hdi_phase01"
export KEYCLOAK_ISSUER_URL="http://${LOOPBACK_BIND_ADDRESS}:${KEYCLOAK_HTTP_PORT}/realms/hdi-phase01"

begin_bootstrap_stage 'BOOTSTRAP_REALM_RENDER' 'BOOTSTRAP_REALM_RENDER_FAILED'
node "${REPO_ROOT}/tooling/runtime/render-keycloak-realm.ts" "${REALM_IMPORT}"
chmod 0750 "${REALM_IMPORT_DIR}"
chmod 0640 "${REALM_IMPORT}"
record_bootstrap_event "${BOOTSTRAP_STAGE}" 'PASSED'

begin_bootstrap_stage 'BOOTSTRAP_RUNTIME_UP' 'BOOTSTRAP_RUNTIME_UP_FAILED'
bash "${SCRIPT_DIR}/podman-phase-01-runtime.sh" up
RUNTIME_UP=1
record_bootstrap_event "${BOOTSTRAP_STAGE}" 'PASSED'

begin_bootstrap_stage 'BOOTSTRAP_POSTGRES_READINESS' 'BOOTSTRAP_POSTGRES_READINESS_FAILED'
postgres_ready=0
for _ in $(seq 1 90); do
  if bash "${SCRIPT_DIR}/podman-phase-01-runtime.sh" postgres-exec \
    pg_isready --port "${POSTGRES_PORT}" --username hdi_phase01 --dbname hdi_phase01 >/dev/null 2>&1; then
    postgres_ready=1
    break
  fi
  sleep 1
done
(( postgres_ready == 1 ))
record_bootstrap_event "${BOOTSTRAP_STAGE}" 'PASSED'

begin_bootstrap_stage 'BOOTSTRAP_KEYCLOAK_READINESS' 'BOOTSTRAP_KEYCLOAK_READINESS_FAILED'
keycloak_ready=0
for _ in $(seq 1 90); do
  if curl --fail --silent "http://${LOOPBACK_BIND_ADDRESS}:${KEYCLOAK_MANAGEMENT_PORT}/health/ready" | \
    jq --exit-status '.status == "UP"' >/dev/null 2>&1; then
    keycloak_ready=1
    break
  fi
  sleep 1
done
(( keycloak_ready == 1 ))
record_bootstrap_event "${BOOTSTRAP_STAGE}" 'PASSED'

begin_bootstrap_stage 'BOOTSTRAP_MIGRATION' 'BOOTSTRAP_MIGRATION_FAILED'
node "${REPO_ROOT}/tooling/runtime/apply-migrations.mjs" "${MIGRATION_DIRECTORY}"
record_bootstrap_event "${BOOTSTRAP_STAGE}" 'PASSED'

begin_bootstrap_stage 'BOOTSTRAP_SEED' 'BOOTSTRAP_SEED_FAILED'
node "${REPO_ROOT}/tooling/runtime/seed-phase-01.ts"
record_bootstrap_event "${BOOTSTRAP_STAGE}" 'PASSED'

begin_bootstrap_stage 'BOOTSTRAP_SCHEMA_VERIFICATION' 'BOOTSTRAP_SCHEMA_VERIFICATION_FAILED'
bash "${SCRIPT_DIR}/podman-phase-01-runtime.sh" postgres-exec \
  psql --port "${POSTGRES_PORT}" --username hdi_phase01 --dbname hdi_phase01 --tuples-only --no-align \
  --command 'select migration_id from platform.schema_migration order by migration_id;'
record_bootstrap_event "${BOOTSTRAP_STAGE}" 'PASSED'

begin_bootstrap_stage 'BOOTSTRAP_COMPLETE' 'BOOTSTRAP_COMPLETE_FAILED'
record_bootstrap_event "${BOOTSTRAP_STAGE}" 'PASSED'
trap - ERR INT TERM
echo 'Phase 01 PostgreSQL, Keycloak, migration and synthetic identity seed are ready.'
