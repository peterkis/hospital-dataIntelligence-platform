#!/usr/bin/env bash
set -Eeuo pipefail

export LANG=C.UTF-8
unset XDG_RUNTIME_DIR

readonly POSTGRES_IMAGE="docker.io/library/postgres@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382"
readonly KEYCLOAK_IMAGE="quay.io/keycloak/keycloak@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13"
readonly POSTGRES_CONTAINER_NAME="hdi-phase01-pg-verify-$$"
readonly KEYCLOAK_CONTAINER_NAME="hdi-phase01-kc-verify-$$"
readonly POSTGRES_HOST_PORT=55434
readonly KEYCLOAK_HTTP_PORT=18081
readonly KEYCLOAK_MANAGEMENT_PORT=19001
readonly -a VERIFICATION_LABELS=(
  --label "hdi.repository=hospital-data-intelligence-platform"
  --label "hdi.phase=01"
  --label "hdi.run-id=runtime-baseline-verification"
  --label "hdi.run-sequence=0"
  --label "hdi.managed-by=runtime-baseline-verifier"
)

cleanup() {
  for container_name in "${POSTGRES_CONTAINER_NAME}" "${KEYCLOAK_CONTAINER_NAME}"; do
    if podman container exists "${container_name}"; then
      podman container rm --force --volumes "${container_name}" >/dev/null
    fi
  done
}
trap cleanup EXIT

[[ "$(node --version)" == "v24.18.0" ]]
[[ "$(npm --version)" == "11.9.0" ]]
[[ "$(podman version --format '{{.Version}}')" == "4.9.4-rhel" ]]
podman info --format json | jq --exit-status '
  .host.security.rootless == false and
  .host.networkBackend == "cni" and
  .host.logDriver == "k8s-file" and
  .host.ociRuntime.name == "runc" and
  .store.graphDriverName == "overlay" and
  .store.graphRoot == "/var/lib/containers/storage"
' >/dev/null
systemctl is-active --quiet podman.socket
[[ -S /run/podman/podman.sock ]]
! command -v docker >/dev/null 2>&1

podman image inspect "${POSTGRES_IMAGE}" >/dev/null
podman image inspect "${KEYCLOAK_IMAGE}" >/dev/null

podman run --rm --pull=never --network none "${POSTGRES_IMAGE}" postgres --version | grep -F 'PostgreSQL) 18.4'
podman run --rm --pull=never --network none "${KEYCLOAK_IMAGE}" --version | grep -F 'Keycloak 26.7.0'

podman run \
  --detach \
  --pull=never \
  --name "${POSTGRES_CONTAINER_NAME}" \
  "${VERIFICATION_LABELS[@]}" \
  --network host \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  --env TZ=Asia/Shanghai \
  --tmpfs /var/lib/postgresql:rw,noexec,nosuid,size=512m \
  --log-driver=k8s-file \
  --log-opt=max-size=10mb \
  "${POSTGRES_IMAGE}" \
  -c timezone=Asia/Shanghai \
  -c listen_addresses=127.0.0.1 \
  -p "${POSTGRES_HOST_PORT}" >/dev/null

for _ in $(seq 1 60); do
  if podman exec "${POSTGRES_CONTAINER_NAME}" pg_isready --port "${POSTGRES_HOST_PORT}" --username postgres --dbname postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

podman exec "${POSTGRES_CONTAINER_NAME}" pg_isready --port "${POSTGRES_HOST_PORT}" --username postgres --dbname postgres >/dev/null
podman exec "${POSTGRES_CONTAINER_NAME}" psql --port "${POSTGRES_HOST_PORT}" --username postgres --dbname postgres --set ON_ERROR_STOP=1 --command 'CREATE EXTENSION pgcrypto; CREATE EXTENSION btree_gist;'
runtime_check="$(podman exec "${POSTGRES_CONTAINER_NAME}" psql --port "${POSTGRES_HOST_PORT}" --username postgres --dbname postgres --tuples-only --no-align --set ON_ERROR_STOP=1 --command "SELECT current_setting('server_version_num')::integer = 180004 AND current_setting('TimeZone') = 'Asia/Shanghai' AND current_setting('port')::integer = ${POSTGRES_HOST_PORT};")"
extension_check="$(podman exec "${POSTGRES_CONTAINER_NAME}" psql --port "${POSTGRES_HOST_PORT}" --username postgres --dbname postgres --tuples-only --no-align --set ON_ERROR_STOP=1 --command "SELECT string_agg(extname, ',' ORDER BY extname) FROM pg_extension WHERE extname IN ('btree_gist', 'pgcrypto');")"

[[ "${runtime_check}" == "t" ]]
[[ "${extension_check}" == "btree_gist,pgcrypto" ]]

printf 'PostgreSQL runtime=%s extensions=%s\n' "${runtime_check}" "${extension_check}"

podman run \
  --detach \
  --pull=never \
  --name "${KEYCLOAK_CONTAINER_NAME}" \
  "${VERIFICATION_LABELS[@]}" \
  --network host \
  --env KC_BOOTSTRAP_ADMIN_USERNAME=phase01-transient-admin \
  --env KC_BOOTSTRAP_ADMIN_PASSWORD=phase01-transient-not-a-secret \
  --env KC_HEALTH_ENABLED=true \
  --log-driver=k8s-file \
  --log-opt=max-size=10mb \
  "${KEYCLOAK_IMAGE}" \
  start-dev \
  --http-host=127.0.0.1 \
  --http-port="${KEYCLOAK_HTTP_PORT}" \
  --http-management-port="${KEYCLOAK_MANAGEMENT_PORT}" >/dev/null

for _ in $(seq 1 90); do
  if curl --fail --silent "http://127.0.0.1:${KEYCLOAK_MANAGEMENT_PORT}/health/ready" | \
     jq --exit-status '.status == "UP"' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

keycloak_health="$(curl --fail --silent "http://127.0.0.1:${KEYCLOAK_MANAGEMENT_PORT}/health/ready")"
[[ "$(jq --raw-output '.status' <<<"${keycloak_health}")" == "UP" ]]
printf 'Keycloak health=%s\n' "$(jq --compact-output . <<<"${keycloak_health}")"

echo 'Phase 01 Podman runtime baseline verified.'
