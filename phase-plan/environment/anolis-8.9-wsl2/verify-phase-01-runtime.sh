#!/usr/bin/env bash
set -Eeuo pipefail

readonly POSTGRES_IMAGE="postgres@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382"
readonly KEYCLOAK_IMAGE="quay.io/keycloak/keycloak@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13"
readonly POSTGRES_CONTAINER_NAME="hdi-phase01-pg-verify-$$"
readonly KEYCLOAK_CONTAINER_NAME="hdi-phase01-kc-verify-$$"

cleanup() {
  for container_name in "${POSTGRES_CONTAINER_NAME}" "${KEYCLOAK_CONTAINER_NAME}"; do
    if docker container inspect "${container_name}" >/dev/null 2>&1; then
      docker container rm --force "${container_name}" >/dev/null
    fi
  done
}
trap cleanup EXIT

[[ "$(node --version)" == "v24.18.0" ]]
[[ "$(npm --version)" == "11.9.0" ]]
[[ "$(docker version --format '{{.Server.Version}}')" == "29.7.2" ]]
[[ "$(docker info --format '{{.Driver}}')" == "overlay2" ]]

docker image inspect "${POSTGRES_IMAGE}" >/dev/null
docker image inspect "${KEYCLOAK_IMAGE}" >/dev/null

docker run --rm --pull=never "${POSTGRES_IMAGE}" postgres --version | grep -F 'PostgreSQL) 18.4'
docker run --rm --pull=never "${KEYCLOAK_IMAGE}" --version | grep -F 'Keycloak 26.7.0'

docker run \
  --detach \
  --pull=never \
  --name "${POSTGRES_CONTAINER_NAME}" \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  --env TZ=Asia/Shanghai \
  --tmpfs /var/lib/postgresql:rw,noexec,nosuid,size=512m \
  "${POSTGRES_IMAGE}" \
  -c timezone=Asia/Shanghai >/dev/null

for _ in $(seq 1 60); do
  if docker exec "${POSTGRES_CONTAINER_NAME}" pg_isready --username postgres --dbname postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec "${POSTGRES_CONTAINER_NAME}" pg_isready --username postgres --dbname postgres >/dev/null
docker exec "${POSTGRES_CONTAINER_NAME}" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 --command 'CREATE EXTENSION pgcrypto; CREATE EXTENSION btree_gist;'
runtime_check="$(docker exec "${POSTGRES_CONTAINER_NAME}" psql --username postgres --dbname postgres --tuples-only --no-align --set ON_ERROR_STOP=1 --command "SELECT current_setting('server_version_num')::integer = 180004 AND current_setting('TimeZone') = 'Asia/Shanghai';")"
extension_check="$(docker exec "${POSTGRES_CONTAINER_NAME}" psql --username postgres --dbname postgres --tuples-only --no-align --set ON_ERROR_STOP=1 --command "SELECT string_agg(extname, ',' ORDER BY extname) FROM pg_extension WHERE extname IN ('btree_gist', 'pgcrypto');")"

[[ "${runtime_check}" == "t" ]]
[[ "${extension_check}" == "btree_gist,pgcrypto" ]]

printf 'PostgreSQL runtime=%s extensions=%s\n' "${runtime_check}" "${extension_check}"

docker run \
  --detach \
  --pull=never \
  --name "${KEYCLOAK_CONTAINER_NAME}" \
  --env KC_BOOTSTRAP_ADMIN_USERNAME=phase01-transient-admin \
  --env KC_BOOTSTRAP_ADMIN_PASSWORD=phase01-transient-not-a-secret \
  --env KC_HEALTH_ENABLED=true \
  --publish 127.0.0.1::9000 \
  "${KEYCLOAK_IMAGE}" \
  start-dev >/dev/null

keycloak_management_address=""
for _ in $(seq 1 90); do
  keycloak_management_address="$(docker port "${KEYCLOAK_CONTAINER_NAME}" 9000/tcp 2>/dev/null || true)"
  if [[ -n "${keycloak_management_address}" ]] && \
     curl --fail --silent "http://${keycloak_management_address}/health/ready" | jq --exit-status '.status == "UP"' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

keycloak_health="$(curl --fail --silent "http://${keycloak_management_address}/health/ready")"
[[ "$(jq --raw-output '.status' <<<"${keycloak_health}")" == "UP" ]]
printf 'Keycloak health=%s\n' "$(jq --compact-output . <<<"${keycloak_health}")"

echo 'Phase 01 runtime baseline verified.'
