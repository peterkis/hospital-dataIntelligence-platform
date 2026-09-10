#!/usr/bin/env bash
set -Eeuo pipefail

export LANG=C.UTF-8
unset XDG_RUNTIME_DIR

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly AUTHORITY_PATH="${SCRIPT_DIR}/runtime-baseline.lock.json"
readonly COMMAND="${1:-}"
shift || true

EVENT_SEQUENCE=0
CURRENT_STAGE="COMMAND_VALIDATION"
CURRENT_ERROR_CODE="PODMAN_RUNTIME_AUTHORITY_INVALID"
EXPECTED_LABELS_JSON='{}'
ACTUAL_LABELS_JSON='null'
CLEANUP_ERROR_CODE=''
PARTIAL_CLEANUP_ARMED=0

if [[ -n "${ABG_RUN_ID:-}" ]]; then
  [[ "${ABG_RUN_ID}" =~ ^[A-Za-z0-9-]+$ ]] || {
    echo 'ERROR_CODE=PODMAN_RUNTIME_IDENTITY_INVALID' >&2
    exit 1
  }
  readonly RUN_SEQUENCE="${ABG_RUN_SEQUENCE:?ABG_RUN_SEQUENCE is required}"
  [[ "${RUN_SEQUENCE}" =~ ^[1-9][0-9]*$ ]] || {
    echo 'ERROR_CODE=PODMAN_RUNTIME_IDENTITY_INVALID' >&2
    exit 1
  }
  readonly SAFE_RUN_ID="$(printf '%s' "${ABG_RUN_ID}" | tr -cd '[:alnum:]' | tr '[:upper:]' '[:lower:]' | cut -c1-12)"
  (( ${#SAFE_RUN_ID} >= 8 )) || {
    echo 'ERROR_CODE=PODMAN_RUNTIME_IDENTITY_INVALID' >&2
    exit 1
  }
  readonly EXPECTED_RUNTIME_NAMESPACE="hdi_phase01_abg_${RUN_SEQUENCE}_${SAFE_RUN_ID}"
  [[ "${ABG_RUNTIME_NAMESPACE:-}" == "${EXPECTED_RUNTIME_NAMESPACE}" ]] || {
    echo 'ERROR_CODE=PODMAN_RUNTIME_IDENTITY_INVALID' >&2
    exit 1
  }
  readonly RUNTIME_NAMESPACE="${EXPECTED_RUNTIME_NAMESPACE}"
  readonly RUNTIME_RUN_ID="${ABG_RUN_ID}"
else
  readonly RUN_SEQUENCE="0"
  readonly RUNTIME_NAMESPACE="${ABG_RUNTIME_NAMESPACE:-hdi_phase01_bootstrap}"
  [[ "${RUNTIME_NAMESPACE}" =~ ^hdi_phase01_[a-z0-9_]+$ ]] || {
    echo 'ERROR_CODE=PODMAN_RUNTIME_IDENTITY_INVALID' >&2
    exit 1
  }
  readonly RUNTIME_RUN_ID="manual-bootstrap"
fi

POSTGRES_CONTAINER="${RUNTIME_NAMESPACE}_postgres"
KEYCLOAK_CONTAINER="${RUNTIME_NAMESPACE}_keycloak"
POSTGRES_VOLUME="${RUNTIME_NAMESPACE}_postgres_data"
KEYCLOAK_VOLUME="${RUNTIME_NAMESPACE}_keycloak_data"

record_event() {
  [[ -n "${ABG_RUNTIME_EVENT_DIR:-}" ]] || return 0
  local stage="$1"
  local status="$2"
  local resource_type="${3:-}"
  local resource_name="${4:-}"
  local resource_id="${5:-}"
  local actual_labels="${6:-null}"
  local restart_policy="${7:-}"
  local error_code="${8:-}"
  local legacy_event="${9:-}"
  local role=''
  local event_name
  local event_path
  local temporary_path

  case "${resource_name}" in
    *postgres*) role='postgresql' ;;
    *keycloak*) role='keycloak' ;;
  esac
  printf -v event_name 'podman-runtime-%06d-%s.json' "${EVENT_SEQUENCE}" "${stage,,}"
  event_name="${event_name//_/-}"
  event_path="${ABG_RUNTIME_EVENT_DIR}/${event_name}"
  temporary_path="${event_path}.tmp.$$"
  mkdir -p -- "${ABG_RUNTIME_EVENT_DIR}"
  jq --null-input \
    --arg schemaVersion 'phase-01.formal-runtime-event.v1' \
    --arg runId "${RUNTIME_RUN_ID}" \
    --arg runSequence "${RUN_SEQUENCE}" \
    --arg runtimeNamespace "${RUNTIME_NAMESPACE}" \
    --arg stage "${stage}" \
    --arg status "${status}" \
    --arg resourceType "${resource_type}" \
    --arg resourceName "${resource_name}" \
    --arg resourceId "${resource_id}" \
    --argjson expectedLabels "${EXPECTED_LABELS_JSON}" \
    --argjson actualLabels "${actual_labels}" \
    --arg restartPolicy "${restart_policy}" \
    --arg errorCode "${error_code}" \
    --arg occurredAt "$(date --utc +'%Y-%m-%dT%H:%M:%SZ')" \
    --arg event "${legacy_event}" \
    --arg role "${role}" \
    '{
      schemaVersion: $schemaVersion,
      runId: $runId,
      runSequence: $runSequence,
      runtimeNamespace: $runtimeNamespace,
      stage: $stage,
      status: $status,
      resourceType: (if $resourceType == "" then null else $resourceType end),
      resourceName: (if $resourceName == "" then null else $resourceName end),
      resourceId: (if $resourceId == "" then null else $resourceId end),
      expectedLabels: $expectedLabels,
      actualLabels: $actualLabels,
      restartPolicy: (if $restartPolicy == "" then null else $restartPolicy end),
      errorCode: (if $errorCode == "" then null else $errorCode end),
      occurredAt: $occurredAt,
      event: (if $event == "" then null else $event end),
      id: (if $resourceId == "" then null else $resourceId end),
      name: (if $resourceName == "" then null else $resourceName end),
      labels: $expectedLabels,
      role: (if $role == "" then null else $role end)
    }' >"${temporary_path}"
  mv -- "${temporary_path}" "${event_path}"
  ((EVENT_SEQUENCE += 1))
}

validate_authority() {
  command -v jq >/dev/null 2>&1 || return 1
  [[ -f "${AUTHORITY_PATH}" && ! -L "${AUTHORITY_PATH}" ]] || return 1
  jq --exit-status '
    .schemaVersion == 3 and
    .authorityId == "phase-01.podman-runtime-authority.v1" and
    (.authority | type == "object") and
    (.observations | type == "object") and
    (.rules | type == "array") and
    (.authority.host.timezone | type == "string" and length > 0) and
    (.authority.podman.version | type == "string" and length > 0) and
    (.authority.podman.socketPath | type == "string" and startswith("/") and (contains("://") | not)) and
    (.authority.podman.storageDriver | type == "string" and length > 0) and
    (.authority.podman.graphRoot | type == "string" and startswith("/")) and
    (.authority.podman.runRoot | type == "string" and startswith("/")) and
    (.authority.podman.ociRuntime | type == "string" and length > 0) and
    (.authority.podman.networkBackend | type == "string" and length > 0) and
    (.authority.podman.logDriver | type == "string" and length > 0) and
    (.authority.podman.cgroupManager | type == "string" and length > 0) and
    (.authority.podman.eventsBackend | type == "string" and length > 0) and
    .authority.podman.rootless == false and
    .authority.podman.restartPolicy == "no" and
    .authority.network.managedContainerMode == "host" and
    .authority.network.bridgeNetworkingAllowed == false and
    .authority.network.portPublishingAllowed == false and
    .authority.network.bindAddress == "127.0.0.1" and
    ([.authority.network.ports[]] | all(type == "number" and . >= 1 and . <= 65535)) and
    (([.authority.network.ports[]] | length) == ([.authority.network.ports[]] | unique | length)) and
    (.authority.images.postgresql.runtimeReference | test("^[^[:space:]]+@sha256:[0-9a-f]{64}$")) and
    (.authority.images.keycloak.runtimeReference | test("^[^[:space:]]+@sha256:[0-9a-f]{64}$")) and
    (.authority.labels.static["hdi.repository"] | type == "string" and length > 0) and
    .authority.labels.static["hdi.phase"] == "01" and
    (.authority.labels.static["hdi.managed-by"] | type == "string" and length > 0) and
    (.authority.labels.dynamic == ["hdi.run-id", "hdi.run-sequence"])
  ' "${AUTHORITY_PATH}" >/dev/null
}

authority_string() {
  jq --exit-status --raw-output "$1 | select(type == \"string\" and length > 0)" "${AUTHORITY_PATH}"
}

load_authority() {
  POSTGRES_IMAGE="$(authority_string '.authority.images.postgresql.runtimeReference')"
  KEYCLOAK_IMAGE="$(authority_string '.authority.images.keycloak.runtimeReference')"
  PODMAN_VERSION="$(authority_string '.authority.podman.version')"
  PODMAN_SOCKET_PATH="$(authority_string '.authority.podman.socketPath')"
  PODMAN_STORAGE_DRIVER="$(authority_string '.authority.podman.storageDriver')"
  PODMAN_GRAPH_ROOT="$(authority_string '.authority.podman.graphRoot')"
  PODMAN_RUN_ROOT="$(authority_string '.authority.podman.runRoot')"
  PODMAN_OCI_RUNTIME="$(authority_string '.authority.podman.ociRuntime')"
  PODMAN_NETWORK_BACKEND="$(authority_string '.authority.podman.networkBackend')"
  PODMAN_LOG_DRIVER="$(authority_string '.authority.podman.logDriver')"
  PODMAN_CGROUP_MANAGER="$(authority_string '.authority.podman.cgroupManager')"
  PODMAN_EVENTS_BACKEND="$(authority_string '.authority.podman.eventsBackend')"
  PODMAN_RESTART_POLICY="$(authority_string '.authority.podman.restartPolicy')"
  MANAGED_CONTAINER_MODE="$(authority_string '.authority.network.managedContainerMode')"
  LOOPBACK_BIND_ADDRESS="$(authority_string '.authority.network.bindAddress')"
  POSTGRES_PORT="$(jq --exit-status --raw-output '.authority.network.ports.postgresRuntime | select(type == "number")' "${AUTHORITY_PATH}")"
  KEYCLOAK_HTTP_PORT="$(jq --exit-status --raw-output '.authority.network.ports.keycloakHttp | select(type == "number")' "${AUTHORITY_PATH}")"
  KEYCLOAK_MANAGEMENT_PORT="$(jq --exit-status --raw-output '.authority.network.ports.keycloakManagement | select(type == "number")' "${AUTHORITY_PATH}")"
  RUNTIME_TIMEZONE="$(authority_string '.authority.host.timezone')"
  LABEL_REPOSITORY="$(authority_string '.authority.labels.static["hdi.repository"]')"
  LABEL_PHASE="$(authority_string '.authority.labels.static["hdi.phase"]')"
  RUNTIME_MANAGED_BY="$(authority_string '.authority.labels.static["hdi.managed-by"]')"
  EXPECTED_LABELS_JSON="$(jq --null-input --compact-output \
    --arg repository "${LABEL_REPOSITORY}" \
    --arg phase "${LABEL_PHASE}" \
    --arg runId "${RUNTIME_RUN_ID}" \
    --arg runSequence "${RUN_SEQUENCE}" \
    --arg managedBy "${RUNTIME_MANAGED_BY}" \
    '{"hdi.repository":$repository,"hdi.phase":$phase,"hdi.run-id":$runId,"hdi.run-sequence":$runSequence,"hdi.managed-by":$managedBy}')"
}

require_up_environment() {
  local variable_name
  for variable_name in \
    POSTGRES_PASSWORD \
    KC_BOOTSTRAP_ADMIN_USERNAME \
    KC_BOOTSTRAP_ADMIN_PASSWORD \
    HDI_KEYCLOAK_REALM_IMPORT_DIR; do
    [[ -n "${!variable_name:-}" ]] || return 1
  done
  [[ -d "${HDI_KEYCLOAK_REALM_IMPORT_DIR}" ]]
}

require_podman_baseline() {
  local info_json
  local image
  local repo_digests

  [[ "$(podman version --format '{{.Version}}')" == "${PODMAN_VERSION}" ]]
  info_json="$(podman info --format json)"
  jq --exit-status \
    --arg storageDriver "${PODMAN_STORAGE_DRIVER}" \
    --arg graphRoot "${PODMAN_GRAPH_ROOT}" \
    --arg runRoot "${PODMAN_RUN_ROOT}" \
    --arg ociRuntime "${PODMAN_OCI_RUNTIME}" \
    --arg networkBackend "${PODMAN_NETWORK_BACKEND}" \
    --arg logDriver "${PODMAN_LOG_DRIVER}" \
    --arg cgroupManager "${PODMAN_CGROUP_MANAGER}" \
    --arg eventsBackend "${PODMAN_EVENTS_BACKEND}" '
      .host.security.rootless == false and
      .store.graphDriverName == $storageDriver and
      .store.graphRoot == $graphRoot and
      .store.runRoot == $runRoot and
      .host.ociRuntime.name == $ociRuntime and
      .host.networkBackend == $networkBackend and
      .host.logDriver == $logDriver and
      .host.cgroupManager == $cgroupManager and
      .host.eventLogger == $eventsBackend
    ' <<<"${info_json}" >/dev/null
  systemctl is-active --quiet podman.socket
  for image in "${POSTGRES_IMAGE}" "${KEYCLOAK_IMAGE}"; do
    repo_digests="$(podman image inspect --format '{{json .RepoDigests}}' "${image}")"
    jq --exit-status --arg image "${image}" 'index($image) != null' <<<"${repo_digests}" >/dev/null
  done
}

assert_resource_names_absent() {
  local resource_name
  local exists_status
  for resource_name in "${POSTGRES_CONTAINER}" "${KEYCLOAK_CONTAINER}"; do
    if podman container exists "${resource_name}"; then
      CURRENT_ERROR_CODE='PODMAN_RESOURCE_NAME_ALREADY_EXISTS'
      return 1
    else
      exists_status=$?
      if (( exists_status != 1 )); then
        CURRENT_ERROR_CODE='PODMAN_RESOURCE_EXISTENCE_CHECK_FAILED'
        return "${exists_status}"
      fi
    fi
  done
  for resource_name in "${POSTGRES_VOLUME}" "${KEYCLOAK_VOLUME}"; do
    if podman volume exists "${resource_name}"; then
      CURRENT_ERROR_CODE='PODMAN_RESOURCE_NAME_ALREADY_EXISTS'
      return 1
    else
      exists_status=$?
      if (( exists_status != 1 )); then
        CURRENT_ERROR_CODE='PODMAN_RESOURCE_EXISTENCE_CHECK_FAILED'
        return "${exists_status}"
      fi
    fi
  done
}

read_resource_labels() {
  local resource_type="$1"
  local resource_name="$2"
  case "${resource_type}" in
    container) podman container inspect --format '{{json .Config.Labels}}' "${resource_name}" ;;
    volume) podman volume inspect --format '{{json .Labels}}' "${resource_name}" ;;
    *) return 2 ;;
  esac
}

labels_match_current_run() {
  local labels_json="$1"
  jq --exit-status --null-input --argjson expected "${EXPECTED_LABELS_JSON}" --argjson labels "${labels_json}" '
    $expected | to_entries | all(. as $entry | $labels[$entry.key] == $entry.value)
  ' >/dev/null
}

project_governed_labels() {
  local labels_json="$1"
  jq --compact-output '
    {
      "hdi.repository": .["hdi.repository"],
      "hdi.phase": .["hdi.phase"],
      "hdi.run-id": .["hdi.run-id"],
      "hdi.run-sequence": .["hdi.run-sequence"],
      "hdi.managed-by": .["hdi.managed-by"]
    } | with_entries(select(.value != null))
  ' <<<"${labels_json}"
}

remove_owned_resource() {
  local resource_type="$1"
  local resource_name="$2"
  local labels_json
  local safe_labels_json
  local exists_status

  CLEANUP_ERROR_CODE=''
  if podman "${resource_type}" exists "${resource_name}"; then
    :
  else
    exists_status=$?
    if (( exists_status == 1 )); then return 0; fi
    CLEANUP_ERROR_CODE='PODMAN_PARTIAL_CLEANUP_EXISTENCE_CHECK_FAILED'
    record_event 'PARTIAL_CLEANUP_EXISTENCE_CHECK' 'FAILED' "${resource_type}" "${resource_name}" '' 'null' '' "${CLEANUP_ERROR_CODE}" '' || true
    return 1
  fi
  if ! labels_json="$(read_resource_labels "${resource_type}" "${resource_name}")"; then
    CLEANUP_ERROR_CODE='PODMAN_PARTIAL_CLEANUP_FAILED'
    record_event 'PARTIAL_CLEANUP_INSPECT' 'FAILED' "${resource_type}" "${resource_name}" '' 'null' '' "${CLEANUP_ERROR_CODE}" '' || true
    return 1
  fi
  if ! safe_labels_json="$(project_governed_labels "${labels_json}")"; then
    CLEANUP_ERROR_CODE='PODMAN_PARTIAL_CLEANUP_FAILED'
    record_event 'PARTIAL_CLEANUP_LABEL_PROJECTION' 'FAILED' "${resource_type}" "${resource_name}" '' 'null' '' "${CLEANUP_ERROR_CODE}" '' || true
    return 1
  fi
  ACTUAL_LABELS_JSON="${safe_labels_json}"
  if ! labels_match_current_run "${labels_json}"; then
    CLEANUP_ERROR_CODE='PODMAN_PARTIAL_CLEANUP_OWNERSHIP_MISMATCH'
    record_event 'PARTIAL_CLEANUP_OWNERSHIP' 'FAILED' "${resource_type}" "${resource_name}" '' "${safe_labels_json}" '' "${CLEANUP_ERROR_CODE}" '' || true
    return 1
  fi
  case "${resource_type}" in
    container)
      if ! podman container rm --force "${resource_name}" >/dev/null; then
        CLEANUP_ERROR_CODE='PODMAN_PARTIAL_CLEANUP_FAILED'
        record_event 'PARTIAL_CLEANUP_REMOVE' 'FAILED' "${resource_type}" "${resource_name}" '' "${safe_labels_json}" '' "${CLEANUP_ERROR_CODE}" '' || true
        return 1
      fi
      ;;
    volume)
      if ! podman volume rm "${resource_name}" >/dev/null; then
        CLEANUP_ERROR_CODE='PODMAN_PARTIAL_CLEANUP_FAILED'
        record_event 'PARTIAL_CLEANUP_REMOVE' 'FAILED' "${resource_type}" "${resource_name}" '' "${safe_labels_json}" '' "${CLEANUP_ERROR_CODE}" '' || true
        return 1
      fi
      ;;
  esac
  record_event 'PARTIAL_CLEANUP_REMOVE' 'PASSED' "${resource_type}" "${resource_name}" '' "${safe_labels_json}" '' '' 'STOPPED' || true
}

partial_cleanup() {
  local cleanup_failed=0
  local cleanup_code=''
  local resource
  for resource in \
    "container:${KEYCLOAK_CONTAINER}" \
    "container:${POSTGRES_CONTAINER}" \
    "volume:${KEYCLOAK_VOLUME}" \
    "volume:${POSTGRES_VOLUME}"; do
    if ! remove_owned_resource "${resource%%:*}" "${resource#*:}"; then
      cleanup_failed=1
      cleanup_code="${CLEANUP_ERROR_CODE:-PODMAN_PARTIAL_CLEANUP_FAILED}"
      echo "ERROR_CODE=${cleanup_code}" >&2
    fi
  done
  return "${cleanup_failed}"
}

handle_runtime_failure() {
  local original_status="${1:-1}"
  trap - ERR INT TERM
  set +e
  (( original_status != 0 )) || original_status=1
  echo "ERROR_CODE=${CURRENT_ERROR_CODE}" >&2
  record_event "${CURRENT_STAGE}" 'FAILED' '' '' '' 'null' '' "${CURRENT_ERROR_CODE}" ''
  if (( PARTIAL_CLEANUP_ARMED == 1 )); then partial_cleanup; fi
  exit "${original_status}"
}

handle_runtime_signal() {
  local signal_name="$1"
  local signal_status="$2"
  CURRENT_ERROR_CODE="PODMAN_RUNTIME_SIGNAL_${signal_name}"
  handle_runtime_failure "${signal_status}"
}

begin_stage() {
  CURRENT_STAGE="$1"
  CURRENT_ERROR_CODE="$2"
}

case "${COMMAND}" in
  up)
    trap 'handle_runtime_failure $?' ERR
    trap 'handle_runtime_signal SIGINT 130' INT
    trap 'handle_runtime_signal SIGTERM 143' TERM

    begin_stage 'AUTHORITY_VALIDATED' 'PODMAN_RUNTIME_AUTHORITY_INVALID'
    validate_authority
    load_authority
    readonly POSTGRES_IMAGE KEYCLOAK_IMAGE PODMAN_VERSION PODMAN_SOCKET_PATH
    readonly PODMAN_STORAGE_DRIVER PODMAN_GRAPH_ROOT PODMAN_RUN_ROOT PODMAN_OCI_RUNTIME
    readonly PODMAN_NETWORK_BACKEND PODMAN_LOG_DRIVER PODMAN_CGROUP_MANAGER PODMAN_EVENTS_BACKEND
    readonly PODMAN_RESTART_POLICY MANAGED_CONTAINER_MODE LOOPBACK_BIND_ADDRESS
    readonly POSTGRES_PORT KEYCLOAK_HTTP_PORT KEYCLOAK_MANAGEMENT_PORT RUNTIME_TIMEZONE
    readonly LABEL_REPOSITORY LABEL_PHASE RUNTIME_MANAGED_BY EXPECTED_LABELS_JSON
    readonly POSTGRES_CONTAINER KEYCLOAK_CONTAINER POSTGRES_VOLUME KEYCLOAK_VOLUME
    readonly -a RUNTIME_LABELS=(
      --label "hdi.repository=${LABEL_REPOSITORY}"
      --label "hdi.phase=${LABEL_PHASE}"
      --label "hdi.run-id=${RUNTIME_RUN_ID}"
      --label "hdi.run-sequence=${RUN_SEQUENCE}"
      --label "hdi.managed-by=${RUNTIME_MANAGED_BY}"
    )
    record_event "${CURRENT_STAGE}" 'PASSED'

    begin_stage 'BASELINE_VALIDATED' 'PODMAN_RUNTIME_BASELINE_MISMATCH'
    require_up_environment
    require_podman_baseline
    record_event "${CURRENT_STAGE}" 'PASSED'

    begin_stage 'RESOURCE_NAMES_CONFIRMED_ABSENT' 'PODMAN_RESOURCE_NAME_ALREADY_EXISTS'
    assert_resource_names_absent
    record_event "${CURRENT_STAGE}" 'PASSED'
    PARTIAL_CLEANUP_ARMED=1

    begin_stage 'POSTGRES_VOLUME_CREATED' 'PODMAN_POSTGRES_VOLUME_CREATE_FAILED'
    postgres_volume_id="$(podman volume create "${RUNTIME_LABELS[@]}" "${POSTGRES_VOLUME}")"
    record_event "${CURRENT_STAGE}" 'PASSED' 'volume' "${POSTGRES_VOLUME}" "${postgres_volume_id}"

    begin_stage 'KEYCLOAK_VOLUME_CREATED' 'PODMAN_KEYCLOAK_VOLUME_CREATE_FAILED'
    keycloak_volume_id="$(podman volume create "${RUNTIME_LABELS[@]}" "${KEYCLOAK_VOLUME}")"
    record_event "${CURRENT_STAGE}" 'PASSED' 'volume' "${KEYCLOAK_VOLUME}" "${keycloak_volume_id}"

    begin_stage 'POSTGRES_CONTAINER_CREATED' 'PODMAN_POSTGRES_CONTAINER_CREATE_FAILED'
    postgres_container_id="$(podman container create \
      --pull=never \
      --name "${POSTGRES_CONTAINER}" \
      "${RUNTIME_LABELS[@]}" \
      --network "${MANAGED_CONTAINER_MODE}" \
      --volume "${POSTGRES_VOLUME}:/var/lib/postgresql" \
      --env POSTGRES_DB=hdi_phase01 \
      --env POSTGRES_USER=hdi_phase01 \
      --env POSTGRES_PASSWORD \
      --env "TZ=${RUNTIME_TIMEZONE}" \
      --log-driver="${PODMAN_LOG_DRIVER}" \
      --log-opt=max-size=10mb \
      --restart="${PODMAN_RESTART_POLICY}" \
      "${POSTGRES_IMAGE}" \
      -c "timezone=${RUNTIME_TIMEZONE}" \
      -c "listen_addresses=${LOOPBACK_BIND_ADDRESS}" \
      -p "${POSTGRES_PORT}")"
    record_event "${CURRENT_STAGE}" 'PASSED' 'container' "${POSTGRES_CONTAINER}" "${postgres_container_id}"

    begin_stage 'POSTGRES_CONTAINER_STARTED' 'PODMAN_POSTGRES_CONTAINER_START_FAILED'
    podman container start "${POSTGRES_CONTAINER}" >/dev/null
    record_event "${CURRENT_STAGE}" 'PASSED' 'container' "${POSTGRES_CONTAINER}" "${postgres_container_id}" 'null' "${PODMAN_RESTART_POLICY}" '' 'STARTED'

    begin_stage 'POSTGRES_RESTART_POLICY_VERIFIED' 'PODMAN_POSTGRES_RESTART_POLICY_INVALID'
    postgres_restart_policy="$(podman container inspect --format '{{.HostConfig.RestartPolicy.Name}}' "${POSTGRES_CONTAINER}")"
    [[ "${postgres_restart_policy}" == "${PODMAN_RESTART_POLICY}" ]]
    record_event "${CURRENT_STAGE}" 'PASSED' 'container' "${POSTGRES_CONTAINER}" "${postgres_container_id}" 'null' "${postgres_restart_policy}"

    begin_stage 'KEYCLOAK_CONTAINER_CREATED' 'PODMAN_KEYCLOAK_CONTAINER_CREATE_FAILED'
    keycloak_container_id="$(podman container create \
      --pull=never \
      --name "${KEYCLOAK_CONTAINER}" \
      "${RUNTIME_LABELS[@]}" \
      --network "${MANAGED_CONTAINER_MODE}" \
      --volume "${HDI_KEYCLOAK_REALM_IMPORT_DIR}:/opt/keycloak/data/import:ro" \
      --volume "${KEYCLOAK_VOLUME}:/opt/keycloak/data" \
      --env KC_BOOTSTRAP_ADMIN_USERNAME \
      --env KC_BOOTSTRAP_ADMIN_PASSWORD \
      --env KC_HEALTH_ENABLED=true \
      --env "TZ=${RUNTIME_TIMEZONE}" \
      --log-driver="${PODMAN_LOG_DRIVER}" \
      --log-opt=max-size=10mb \
      --restart="${PODMAN_RESTART_POLICY}" \
      "${KEYCLOAK_IMAGE}" \
      start-dev --import-realm \
      --http-host="${LOOPBACK_BIND_ADDRESS}" \
      --http-port="${KEYCLOAK_HTTP_PORT}" \
      --http-management-port="${KEYCLOAK_MANAGEMENT_PORT}")"
    record_event "${CURRENT_STAGE}" 'PASSED' 'container' "${KEYCLOAK_CONTAINER}" "${keycloak_container_id}"

    begin_stage 'KEYCLOAK_CONTAINER_STARTED' 'PODMAN_KEYCLOAK_CONTAINER_START_FAILED'
    podman container start "${KEYCLOAK_CONTAINER}" >/dev/null
    record_event "${CURRENT_STAGE}" 'PASSED' 'container' "${KEYCLOAK_CONTAINER}" "${keycloak_container_id}" 'null' "${PODMAN_RESTART_POLICY}" '' 'STARTED'

    begin_stage 'KEYCLOAK_RESTART_POLICY_VERIFIED' 'PODMAN_KEYCLOAK_RESTART_POLICY_INVALID'
    keycloak_restart_policy="$(podman container inspect --format '{{.HostConfig.RestartPolicy.Name}}' "${KEYCLOAK_CONTAINER}")"
    [[ "${keycloak_restart_policy}" == "${PODMAN_RESTART_POLICY}" ]]
    record_event "${CURRENT_STAGE}" 'PASSED' 'container' "${KEYCLOAK_CONTAINER}" "${keycloak_container_id}" 'null' "${keycloak_restart_policy}"

    begin_stage 'UP_COMPLETE' 'PODMAN_UP_COMPLETION_FAILED'
    record_event "${CURRENT_STAGE}" 'PASSED'
    trap - ERR INT TERM
    ;;
  postgres-exec|down)
    validate_authority || {
      echo 'ERROR_CODE=PODMAN_RUNTIME_AUTHORITY_INVALID' >&2
      exit 1
    }
    load_authority
    readonly POSTGRES_CONTAINER KEYCLOAK_CONTAINER POSTGRES_VOLUME KEYCLOAK_VOLUME
    if [[ "${COMMAND}" == 'postgres-exec' ]]; then
      if podman container exists "${POSTGRES_CONTAINER}"; then
        :
      else
        exists_status=$?
        if (( exists_status == 1 )); then
          echo 'ERROR_CODE=PODMAN_POSTGRES_CONTAINER_MISSING' >&2
          exit 1
        fi
        echo 'ERROR_CODE=PODMAN_RESOURCE_EXISTENCE_CHECK_FAILED' >&2
        exit "${exists_status}"
      fi
      ACTUAL_LABELS_JSON="$(read_resource_labels container "${POSTGRES_CONTAINER}")"
      if ! labels_match_current_run "${ACTUAL_LABELS_JSON}"; then
        echo 'ERROR_CODE=PODMAN_PARTIAL_CLEANUP_OWNERSHIP_MISMATCH' >&2
        exit 1
      fi
      podman exec "${POSTGRES_CONTAINER}" "$@"
    else
      if ! partial_cleanup; then exit 1; fi
    fi
    ;;
  *)
    echo 'Usage: podman-phase-01-runtime.sh {up|postgres-exec|down}' >&2
    exit 2
    ;;
esac
