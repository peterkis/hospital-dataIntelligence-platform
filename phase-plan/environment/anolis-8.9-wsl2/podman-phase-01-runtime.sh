#!/usr/bin/env bash
set -Eeuo pipefail

export LANG=C.UTF-8
unset XDG_RUNTIME_DIR

readonly POSTGRES_IMAGE="docker.io/library/postgres@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382"
readonly KEYCLOAK_IMAGE="quay.io/keycloak/keycloak@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13"
readonly COMMAND="${1:-}"
shift || true

if [[ -n "${ABG_RUN_ID:-}" ]]; then
  [[ "${ABG_RUN_ID}" =~ ^[A-Za-z0-9-]+$ ]] || { echo "ABG_RUN_ID is invalid" >&2; exit 1; }
  readonly RUN_SEQUENCE="${ABG_RUN_SEQUENCE:?ABG_RUN_SEQUENCE is required}"
  [[ "${RUN_SEQUENCE}" =~ ^[1-9][0-9]*$ ]] || { echo "ABG_RUN_SEQUENCE is invalid" >&2; exit 1; }
  readonly SAFE_RUN_ID="$(printf '%s' "${ABG_RUN_ID}" | tr -cd '[:alnum:]' | tr '[:upper:]' '[:lower:]' | cut -c1-12)"
  (( ${#SAFE_RUN_ID} >= 8 )) || { echo "ABG_RUN_ID safe short identifier is invalid" >&2; exit 1; }
  readonly EXPECTED_RUNTIME_NAMESPACE="hdi_phase01_abg_${RUN_SEQUENCE}_${SAFE_RUN_ID}"
  if [[ "${ABG_RUNTIME_NAMESPACE:-}" != "${EXPECTED_RUNTIME_NAMESPACE}" ]]; then
    echo "ABG_RUNTIME_NAMESPACE does not match the current run identity" >&2
    exit 1
  fi
  readonly RUNTIME_NAMESPACE="${EXPECTED_RUNTIME_NAMESPACE}"
  readonly RUNTIME_RUN_ID="${ABG_RUN_ID}"
  readonly RUNTIME_MANAGED_BY="formal-abg"
else
  readonly RUN_SEQUENCE="0"
  readonly RUNTIME_NAMESPACE="${ABG_RUNTIME_NAMESPACE:-hdi_phase01_bootstrap}"
  [[ "${RUNTIME_NAMESPACE}" =~ ^hdi_phase01_[a-z0-9_]+$ ]] || {
    echo "ABG_RUNTIME_NAMESPACE is invalid" >&2
    exit 1
  }
  readonly RUNTIME_RUN_ID="manual-bootstrap"
  readonly RUNTIME_MANAGED_BY="phase-01-bootstrap"
fi

readonly POSTGRES_CONTAINER="${RUNTIME_NAMESPACE}_postgres"
readonly KEYCLOAK_CONTAINER="${RUNTIME_NAMESPACE}_keycloak"
readonly POSTGRES_VOLUME="${RUNTIME_NAMESPACE}_postgres_data"
readonly KEYCLOAK_VOLUME="${RUNTIME_NAMESPACE}_keycloak_data"
readonly -a RUNTIME_LABELS=(
  --label "hdi.repository=hospital-data-intelligence-platform"
  --label "hdi.phase=01"
  --label "hdi.run-id=${RUNTIME_RUN_ID}"
  --label "hdi.run-sequence=${RUN_SEQUENCE}"
  --label "hdi.managed-by=${RUNTIME_MANAGED_BY}"
)

require_up_environment() {
  for variable_name in \
    POSTGRES_PASSWORD \
    KC_BOOTSTRAP_ADMIN_USERNAME \
    KC_BOOTSTRAP_ADMIN_PASSWORD \
    HDI_KEYCLOAK_REALM_IMPORT_DIR; do
    if [[ -z "${!variable_name:-}" ]]; then
      echo "Required environment variable is missing: ${variable_name}" >&2
      exit 1
    fi
  done
  [[ -d "${HDI_KEYCLOAK_REALM_IMPORT_DIR}" ]] || {
    echo "HDI_KEYCLOAK_REALM_IMPORT_DIR does not exist" >&2
    exit 1
  }
}

require_podman_baseline() {
  [[ "$(podman version --format '{{.Version}}')" == "4.9.4-rhel" ]]
  [[ "$(podman info --format '{{.Store.GraphDriverName}}')" == "overlay" ]]
  [[ "$(podman info --format '{{.Host.NetworkBackend}}')" == "cni" ]]
  systemctl is-active --quiet podman.socket
  for image in "${POSTGRES_IMAGE}" "${KEYCLOAK_IMAGE}"; do
    podman image inspect "${image}" >/dev/null
  done
}

assert_resource_names_absent() {
  for container_name in "${POSTGRES_CONTAINER}" "${KEYCLOAK_CONTAINER}"; do
    ! podman container exists "${container_name}" || {
      echo "Podman container already exists: ${container_name}" >&2
      exit 1
    }
  done
  for volume_name in "${POSTGRES_VOLUME}" "${KEYCLOAK_VOLUME}"; do
    ! podman volume exists "${volume_name}" || {
      echo "Podman volume already exists: ${volume_name}" >&2
      exit 1
    }
  done
}

assert_owned() {
  local resource_type="$1"
  local resource_name="$2"
  local labels_json
  case "${resource_type}" in
    container) labels_json="$(podman container inspect --format '{{json .Config.Labels}}' "${resource_name}")" ;;
    volume) labels_json="$(podman volume inspect --format '{{json .Labels}}' "${resource_name}")" ;;
    *) echo "Unsupported Podman resource type: ${resource_type}" >&2; exit 1 ;;
  esac
  jq --exit-status \
    --arg repository "hospital-data-intelligence-platform" \
    --arg phase "01" \
    --arg run_id "${RUNTIME_RUN_ID}" \
    --arg run_sequence "${RUN_SEQUENCE}" \
    --arg managed_by "${RUNTIME_MANAGED_BY}" \
    '."hdi.repository" == $repository and ."hdi.phase" == $phase and
     ."hdi.run-id" == $run_id and ."hdi.run-sequence" == $run_sequence and
     ."hdi.managed-by" == $managed_by' <<<"${labels_json}" >/dev/null || {
    echo "Podman resource ownership mismatch: ${resource_type}:${resource_name}" >&2
    exit 1
  }
}

remove_if_owned() {
  local resource_type="$1"
  local resource_name="$2"
  if podman "${resource_type}" exists "${resource_name}"; then
    assert_owned "${resource_type}" "${resource_name}"
    case "${resource_type}" in
      container) podman container rm --force --volumes "${resource_name}" >/dev/null ;;
      volume) podman volume rm "${resource_name}" >/dev/null ;;
    esac
  fi
}

case "${COMMAND}" in
  up)
    require_up_environment
    require_podman_baseline
    assert_resource_names_absent

    podman volume create "${RUNTIME_LABELS[@]}" "${POSTGRES_VOLUME}" >/dev/null
    podman volume create "${RUNTIME_LABELS[@]}" "${KEYCLOAK_VOLUME}" >/dev/null

    podman run \
      --detach \
      --pull=never \
      --name "${POSTGRES_CONTAINER}" \
      "${RUNTIME_LABELS[@]}" \
      --network host \
      --volume "${POSTGRES_VOLUME}:/var/lib/postgresql" \
      --env POSTGRES_DB=hdi_phase01 \
      --env POSTGRES_USER=hdi_phase01 \
      --env POSTGRES_PASSWORD \
      --env TZ=Asia/Shanghai \
      --log-driver=k8s-file \
      --log-opt=max-size=10mb \
      --restart=unless-stopped \
      "${POSTGRES_IMAGE}" \
      -c timezone=Asia/Shanghai \
      -c listen_addresses=127.0.0.1 \
      -p 55432 >/dev/null

    podman run \
      --detach \
      --pull=never \
      --name "${KEYCLOAK_CONTAINER}" \
      "${RUNTIME_LABELS[@]}" \
      --network host \
      --volume "${HDI_KEYCLOAK_REALM_IMPORT_DIR}:/opt/keycloak/data/import:ro" \
      --volume "${KEYCLOAK_VOLUME}:/opt/keycloak/data" \
      --env KC_BOOTSTRAP_ADMIN_USERNAME \
      --env KC_BOOTSTRAP_ADMIN_PASSWORD \
      --env KC_HEALTH_ENABLED=true \
      --env TZ=Asia/Shanghai \
      --log-driver=k8s-file \
      --log-opt=max-size=10mb \
      --restart=unless-stopped \
      "${KEYCLOAK_IMAGE}" \
      start-dev --import-realm \
      --http-host=127.0.0.1 \
      --http-port=18080 \
      --http-management-port=19000 >/dev/null
    ;;
  postgres-exec)
    assert_owned container "${POSTGRES_CONTAINER}"
    podman exec "${POSTGRES_CONTAINER}" "$@"
    ;;
  down)
    remove_if_owned container "${KEYCLOAK_CONTAINER}"
    remove_if_owned container "${POSTGRES_CONTAINER}"
    remove_if_owned volume "${KEYCLOAK_VOLUME}"
    remove_if_owned volume "${POSTGRES_VOLUME}"
    ;;
  *)
    echo "Usage: podman-phase-01-runtime.sh {up|postgres-exec|down}" >&2
    exit 2
    ;;
esac
