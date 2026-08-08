#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
readonly COMPOSE_FILE="${SCRIPT_DIR}/compose.phase-01.yml"
readonly REALM_IMPORT_DIR="${REPO_ROOT}/.runtime/keycloak-import"
readonly REALM_IMPORT="${REALM_IMPORT_DIR}/hdi-phase01-realm.json"
readonly MIGRATION_DIRECTORY="${REPO_ROOT}/db/migrations"

for variable_name in \
  HDI_POSTGRES_PASSWORD \
  HDI_KEYCLOAK_ADMIN_USERNAME \
  HDI_KEYCLOAK_ADMIN_PASSWORD \
  HDI_OWNER_PASSWORD \
  HDI_BROWSER_CLIENT_SECRET \
  HDI_SIM_CONSUMER_A_CLIENT_SECRET \
  HDI_SIM_CONSUMER_B_CLIENT_SECRET; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Required environment variable is missing: ${variable_name}" >&2
    exit 1
  fi
done

export HDI_KEYCLOAK_REALM_IMPORT_DIR="${REALM_IMPORT_DIR}"
encoded_postgres_password="$(node -e "process.stdout.write(encodeURIComponent(process.env.HDI_POSTGRES_PASSWORD))")"
export DATABASE_URL="postgresql://hdi_phase01:${encoded_postgres_password}@127.0.0.1:55432/hdi_phase01"
export KEYCLOAK_ISSUER_URL="http://127.0.0.1:18080/realms/hdi-phase01"

node "${REPO_ROOT}/tooling/runtime/render-keycloak-realm.mjs" "${REALM_IMPORT}"
docker compose --file "${COMPOSE_FILE}" up --detach

for _ in $(seq 1 90); do
  if docker compose --file "${COMPOSE_FILE}" exec --no-TTY postgres \
    pg_isready --username hdi_phase01 --dbname hdi_phase01 >/dev/null 2>&1 && \
    curl --fail --silent http://127.0.0.1:19000/health/ready >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker compose --file "${COMPOSE_FILE}" exec --no-TTY postgres \
  pg_isready --username hdi_phase01 --dbname hdi_phase01 >/dev/null
curl --fail --silent http://127.0.0.1:19000/health/ready >/dev/null

node "${REPO_ROOT}/tooling/runtime/apply-migrations.mjs" "${MIGRATION_DIRECTORY}"

node "${REPO_ROOT}/tooling/runtime/seed-phase-01.mjs"
docker compose --file "${COMPOSE_FILE}" exec --no-TTY postgres \
  psql --username hdi_phase01 --dbname hdi_phase01 --tuples-only --no-align \
  --command "select migration_id from platform.schema_migration order by migration_id;"

echo "Phase 01 PostgreSQL, Keycloak, migration and synthetic identity seed are ready."
