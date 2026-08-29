#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
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
  export ABG_RUNTIME_NAMESPACE="${EXPECTED_RUNTIME_NAMESPACE}"
  export ABG_MANAGED_BY="formal-abg"
  readonly RUNTIME_ROOT="${REPO_ROOT}/.runtime/abg-runtime/${ABG_RUN_ID}"
else
  export ABG_MANAGED_BY="${ABG_MANAGED_BY:-phase-01-bootstrap}"
  export ABG_RUNTIME_NAMESPACE="${ABG_RUNTIME_NAMESPACE:-hdi_phase01_bootstrap}"
  readonly RUNTIME_ROOT="${REPO_ROOT}/.runtime"
fi
readonly REALM_IMPORT_DIR="${RUNTIME_ROOT}/keycloak-import"
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
export POSTGRES_PASSWORD="${HDI_POSTGRES_PASSWORD}"
export KC_BOOTSTRAP_ADMIN_USERNAME="${HDI_KEYCLOAK_ADMIN_USERNAME}"
export KC_BOOTSTRAP_ADMIN_PASSWORD="${HDI_KEYCLOAK_ADMIN_PASSWORD}"
encoded_postgres_password="$(node -e "process.stdout.write(encodeURIComponent(process.env.HDI_POSTGRES_PASSWORD))")"
export DATABASE_URL="postgresql://hdi_phase01:${encoded_postgres_password}@127.0.0.1:55432/hdi_phase01"
export KEYCLOAK_ISSUER_URL="http://127.0.0.1:18080/realms/hdi-phase01"

node "${REPO_ROOT}/tooling/runtime/render-keycloak-realm.ts" "${REALM_IMPORT}"
chmod 0750 "${REALM_IMPORT_DIR}"
chmod 0640 "${REALM_IMPORT}"
bash "${SCRIPT_DIR}/podman-phase-01-runtime.sh" up

for _ in $(seq 1 90); do
  if bash "${SCRIPT_DIR}/podman-phase-01-runtime.sh" postgres-exec \
    pg_isready --port 55432 --username hdi_phase01 --dbname hdi_phase01 >/dev/null 2>&1 && \
    curl --fail --silent http://127.0.0.1:19000/health/ready >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

bash "${SCRIPT_DIR}/podman-phase-01-runtime.sh" postgres-exec \
  pg_isready --port 55432 --username hdi_phase01 --dbname hdi_phase01 >/dev/null
curl --fail --silent http://127.0.0.1:19000/health/ready >/dev/null

node "${REPO_ROOT}/tooling/runtime/apply-migrations.mjs" "${MIGRATION_DIRECTORY}"

node "${REPO_ROOT}/tooling/runtime/seed-phase-01.ts"
bash "${SCRIPT_DIR}/podman-phase-01-runtime.sh" postgres-exec \
  psql --port 55432 --username hdi_phase01 --dbname hdi_phase01 --tuples-only --no-align \
  --command "select migration_id from platform.schema_migration order by migration_id;"

echo "Phase 01 PostgreSQL, Keycloak, migration and synthetic identity seed are ready."
