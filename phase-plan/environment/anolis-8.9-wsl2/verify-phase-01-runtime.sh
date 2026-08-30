#!/usr/bin/env bash
set -Eeuo pipefail

export LANG=C.UTF-8
unset XDG_RUNTIME_DIR

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly AUTHORITY_PATH="${SCRIPT_DIR}/runtime-baseline.lock.json"

jq --exit-status '
  .schemaVersion == 3 and
  .authorityId == "phase-01.podman-runtime-authority.v1" and
  .authority.podman.rootless == false and
  .authority.podman.restartPolicy == "no" and
  .authority.network.managedContainerMode == "host" and
  .authority.network.bridgeNetworkingAllowed == false and
  .authority.network.portPublishingAllowed == false and
  .authority.network.bindAddress == "127.0.0.1" and
  (.authority.images.postgresql.runtimeReference | test("@sha256:[0-9a-f]{64}$")) and
  (.authority.images.keycloak.runtimeReference | test("@sha256:[0-9a-f]{64}$"))
' "${AUTHORITY_PATH}" >/dev/null

authority_string() {
  jq --exit-status --raw-output "$1 | select(type == \"string\" and length > 0)" "${AUTHORITY_PATH}"
}

readonly POSTGRES_IMAGE="$(authority_string '.authority.images.postgresql.runtimeReference')"
readonly KEYCLOAK_IMAGE="$(authority_string '.authority.images.keycloak.runtimeReference')"
readonly POSTGRES_DECLARED_VERSION="$(authority_string '.authority.images.postgresql.declaredVersion')"
readonly KEYCLOAK_DECLARED_VERSION="$(authority_string '.authority.images.keycloak.declaredVersion')"
readonly PODMAN_VERSION="$(authority_string '.authority.podman.version')"
readonly PODMAN_SOCKET_PATH="$(authority_string '.authority.podman.socketPath')"
readonly PODMAN_STORAGE_DRIVER="$(authority_string '.authority.podman.storageDriver')"
readonly PODMAN_GRAPH_ROOT="$(authority_string '.authority.podman.graphRoot')"
readonly PODMAN_RUN_ROOT="$(authority_string '.authority.podman.runRoot')"
readonly PODMAN_OCI_RUNTIME="$(authority_string '.authority.podman.ociRuntime')"
readonly PODMAN_NETWORK_BACKEND="$(authority_string '.authority.podman.networkBackend')"
readonly PODMAN_LOG_DRIVER="$(authority_string '.authority.podman.logDriver')"
readonly PODMAN_CGROUP_MANAGER="$(authority_string '.authority.podman.cgroupManager')"
readonly PODMAN_EVENTS_BACKEND="$(authority_string '.authority.podman.eventsBackend')"
readonly PODMAN_RESTART_POLICY="$(authority_string '.authority.podman.restartPolicy')"
readonly MANAGED_CONTAINER_MODE="$(authority_string '.authority.network.managedContainerMode')"
readonly LOOPBACK_BIND_ADDRESS="$(authority_string '.authority.network.bindAddress')"
readonly RUNTIME_TIMEZONE="$(authority_string '.authority.host.timezone')"
readonly POSTGRES_HOST_PORT="$(jq --exit-status --raw-output '.authority.network.ports.postgresIntegration' "${AUTHORITY_PATH}")"
readonly KEYCLOAK_HTTP_PORT="$(jq --exit-status --raw-output '.authority.network.ports.keycloakHttp' "${AUTHORITY_PATH}")"
readonly KEYCLOAK_MANAGEMENT_PORT="$(jq --exit-status --raw-output '.authority.network.ports.keycloakManagement' "${AUTHORITY_PATH}")"
readonly LABEL_REPOSITORY="$(authority_string '.authority.labels.static["hdi.repository"]')"
readonly LABEL_PHASE="$(authority_string '.authority.labels.static["hdi.phase"]')"
readonly LABEL_MANAGED_BY="$(authority_string '.authority.labels.static["hdi.managed-by"]')"
readonly POSTGRES_CONTAINER_NAME="hdi_phase01_runtime_verification_$$_postgres"
readonly KEYCLOAK_CONTAINER_NAME="hdi_phase01_runtime_verification_$$_keycloak"
readonly RUN_ID='runtime-baseline-verification'
readonly RUN_SEQUENCE='0'
readonly EXPECTED_LABELS_JSON="$(jq --null-input --compact-output \
  --arg repository "${LABEL_REPOSITORY}" \
  --arg phase "${LABEL_PHASE}" \
  --arg runId "${RUN_ID}" \
  --arg runSequence "${RUN_SEQUENCE}" \
  --arg managedBy "${LABEL_MANAGED_BY}" \
  '{"hdi.repository":$repository,"hdi.phase":$phase,"hdi.run-id":$runId,"hdi.run-sequence":$runSequence,"hdi.managed-by":$managedBy}')"
readonly -a VERIFICATION_LABELS=(
  --label "hdi.repository=${LABEL_REPOSITORY}"
  --label "hdi.phase=${LABEL_PHASE}"
  --label "hdi.run-id=${RUN_ID}"
  --label "hdi.run-sequence=${RUN_SEQUENCE}"
  --label "hdi.managed-by=${LABEL_MANAGED_BY}"
)

assert_container_owned() {
  local container_name="$1"
  local labels_json
  labels_json="$(podman container inspect --format '{{json .Config.Labels}}' "${container_name}")"
  jq --exit-status --null-input --argjson expected "${EXPECTED_LABELS_JSON}" --argjson labels "${labels_json}" '
    $expected | to_entries | all(. as $entry | $labels[$entry.key] == $entry.value)
  ' >/dev/null
}

cleanup() {
  local original_status="$?"
  local container_name
  local cleanup_failed=0
  local cleanup_error_code='PODMAN_RUNTIME_VERIFICATION_CLEANUP_FAILED'
  local exists_status
  trap - EXIT
  set +e
  for container_name in "${KEYCLOAK_CONTAINER_NAME}" "${POSTGRES_CONTAINER_NAME}"; do
    if podman container exists "${container_name}"; then
      if assert_container_owned "${container_name}"; then
        podman container rm --force "${container_name}" >/dev/null || cleanup_failed=1
      else
        cleanup_failed=1
      fi
    else
      exists_status=$?
      if (( exists_status != 1 )); then
        cleanup_failed=1
        cleanup_error_code='PODMAN_RUNTIME_VERIFICATION_EXISTENCE_CHECK_FAILED'
      fi
    fi
  done
  if (( cleanup_failed != 0 )); then
    echo "ERROR_CODE=${cleanup_error_code}" >&2
    if (( original_status != 0 )); then exit "${original_status}"; fi
    exit 1
  fi
  exit "${original_status}"
}

assert_verification_names_absent() {
  local container_name
  local exists_status
  for container_name in "${KEYCLOAK_CONTAINER_NAME}" "${POSTGRES_CONTAINER_NAME}"; do
    if podman container exists "${container_name}"; then
      echo 'ERROR_CODE=PODMAN_RUNTIME_VERIFICATION_RESOURCE_NAME_ALREADY_EXISTS' >&2
      return 1
    else
      exists_status=$?
      if (( exists_status != 1 )); then
        echo 'ERROR_CODE=PODMAN_RUNTIME_VERIFICATION_EXISTENCE_CHECK_FAILED' >&2
        return "${exists_status}"
      fi
    fi
  done
}

[[ "$(podman version --format '{{.Version}}')" == "${PODMAN_VERSION}" ]]
podman info --format json | jq --exit-status \
  --arg storageDriver "${PODMAN_STORAGE_DRIVER}" \
  --arg graphRoot "${PODMAN_GRAPH_ROOT}" \
  --arg runRoot "${PODMAN_RUN_ROOT}" \
  --arg ociRuntime "${PODMAN_OCI_RUNTIME}" \
  --arg networkBackend "${PODMAN_NETWORK_BACKEND}" \
  --arg logDriver "${PODMAN_LOG_DRIVER}" \
  --arg cgroupManager "${PODMAN_CGROUP_MANAGER}" \
  --arg eventsBackend "${PODMAN_EVENTS_BACKEND}" '
    .host.security.rootless == false and
    .host.networkBackend == $networkBackend and
    .host.logDriver == $logDriver and
    .host.ociRuntime.name == $ociRuntime and
    .host.cgroupManager == $cgroupManager and
    .host.eventLogger == $eventsBackend and
    .store.graphDriverName == $storageDriver and
    .store.graphRoot == $graphRoot and
    .store.runRoot == $runRoot
  ' >/dev/null
systemctl is-active --quiet podman.socket
[[ -S "${PODMAN_SOCKET_PATH}" && ! -L "${PODMAN_SOCKET_PATH}" ]]

mapfile -t forbidden_executables < <(jq --raw-output '.authority.dockerExclusion.forbiddenExecutableNames[]' "${AUTHORITY_PATH}")
for executable_name in "${forbidden_executables[@]}"; do
  ! command -v "${executable_name}" >/dev/null 2>&1
done

for image in "${POSTGRES_IMAGE}" "${KEYCLOAK_IMAGE}"; do
  repo_digests="$(podman image inspect --format '{{json .RepoDigests}}' "${image}")"
  jq --exit-status --arg image "${image}" 'index($image) != null' <<<"${repo_digests}" >/dev/null
done

podman run --rm --pull=never --network none --restart="${PODMAN_RESTART_POLICY}" "${POSTGRES_IMAGE}" postgres --version | grep -F "PostgreSQL) ${POSTGRES_DECLARED_VERSION}"
podman run --rm --pull=never --network none --restart="${PODMAN_RESTART_POLICY}" "${KEYCLOAK_IMAGE}" --version | grep -F "Keycloak ${KEYCLOAK_DECLARED_VERSION}"

assert_verification_names_absent
trap cleanup EXIT

postgres_container_id="$(podman container create \
  --pull=never \
  --name "${POSTGRES_CONTAINER_NAME}" \
  "${VERIFICATION_LABELS[@]}" \
  --network "${MANAGED_CONTAINER_MODE}" \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  --env "TZ=${RUNTIME_TIMEZONE}" \
  --tmpfs /var/lib/postgresql:rw,noexec,nosuid,size=512m \
  --log-driver="${PODMAN_LOG_DRIVER}" \
  --log-opt=max-size=10mb \
  --restart="${PODMAN_RESTART_POLICY}" \
  "${POSTGRES_IMAGE}" \
  -c "timezone=${RUNTIME_TIMEZONE}" \
  -c "listen_addresses=${LOOPBACK_BIND_ADDRESS}" \
  -p "${POSTGRES_HOST_PORT}")"
podman container start "${postgres_container_id}" >/dev/null
[[ "$(podman container inspect --format '{{.HostConfig.RestartPolicy.Name}}' "${POSTGRES_CONTAINER_NAME}")" == "${PODMAN_RESTART_POLICY}" ]]

for _ in $(seq 1 60); do
  if podman exec "${POSTGRES_CONTAINER_NAME}" pg_isready --port "${POSTGRES_HOST_PORT}" --username postgres --dbname postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

podman exec "${POSTGRES_CONTAINER_NAME}" pg_isready --port "${POSTGRES_HOST_PORT}" --username postgres --dbname postgres >/dev/null
podman exec "${POSTGRES_CONTAINER_NAME}" psql --port "${POSTGRES_HOST_PORT}" --username postgres --dbname postgres --set ON_ERROR_STOP=1 --command 'CREATE EXTENSION pgcrypto; CREATE EXTENSION btree_gist;'
postgres_major="${POSTGRES_DECLARED_VERSION%%.*}"
postgres_minor="${POSTGRES_DECLARED_VERSION#*.}"
printf -v postgres_version_number '%d%04d' "${postgres_major}" "${postgres_minor}"
runtime_check="$(podman exec "${POSTGRES_CONTAINER_NAME}" psql --port "${POSTGRES_HOST_PORT}" --username postgres --dbname postgres --tuples-only --no-align --set ON_ERROR_STOP=1 --command "SELECT current_setting('server_version_num')::integer = ${postgres_version_number} AND current_setting('TimeZone') = '${RUNTIME_TIMEZONE}' AND current_setting('port')::integer = ${POSTGRES_HOST_PORT};")"
extension_check="$(podman exec "${POSTGRES_CONTAINER_NAME}" psql --port "${POSTGRES_HOST_PORT}" --username postgres --dbname postgres --tuples-only --no-align --set ON_ERROR_STOP=1 --command "SELECT string_agg(extname, ',' ORDER BY extname) FROM pg_extension WHERE extname IN ('btree_gist', 'pgcrypto');")"

[[ "${runtime_check}" == 't' ]]
[[ "${extension_check}" == 'btree_gist,pgcrypto' ]]
printf 'PostgreSQL runtime=%s extensions=%s\n' "${runtime_check}" "${extension_check}"

export KC_BOOTSTRAP_ADMIN_USERNAME='phase01-transient-admin'
export KC_BOOTSTRAP_ADMIN_PASSWORD="phase01-transient-$RANDOM-$RANDOM"
keycloak_container_id="$(podman container create \
  --pull=never \
  --name "${KEYCLOAK_CONTAINER_NAME}" \
  "${VERIFICATION_LABELS[@]}" \
  --network "${MANAGED_CONTAINER_MODE}" \
  --env KC_BOOTSTRAP_ADMIN_USERNAME \
  --env KC_BOOTSTRAP_ADMIN_PASSWORD \
  --env KC_HEALTH_ENABLED=true \
  --log-driver="${PODMAN_LOG_DRIVER}" \
  --log-opt=max-size=10mb \
  --restart="${PODMAN_RESTART_POLICY}" \
  "${KEYCLOAK_IMAGE}" \
  start-dev \
  --http-host="${LOOPBACK_BIND_ADDRESS}" \
  --http-port="${KEYCLOAK_HTTP_PORT}" \
  --http-management-port="${KEYCLOAK_MANAGEMENT_PORT}")"
podman container start "${keycloak_container_id}" >/dev/null
[[ "$(podman container inspect --format '{{.HostConfig.RestartPolicy.Name}}' "${KEYCLOAK_CONTAINER_NAME}")" == "${PODMAN_RESTART_POLICY}" ]]

for _ in $(seq 1 90); do
  if curl --fail --silent "http://${LOOPBACK_BIND_ADDRESS}:${KEYCLOAK_MANAGEMENT_PORT}/health/ready" | \
    jq --exit-status '.status == "UP"' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

keycloak_health="$(curl --fail --silent "http://${LOOPBACK_BIND_ADDRESS}:${KEYCLOAK_MANAGEMENT_PORT}/health/ready")"
[[ "$(jq --raw-output '.status' <<<"${keycloak_health}")" == 'UP' ]]
printf 'Keycloak health=%s\n' "$(jq --compact-output . <<<"${keycloak_health}")"

echo 'Phase 01 Podman runtime baseline verified.'
