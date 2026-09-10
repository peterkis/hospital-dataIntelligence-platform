#!/usr/bin/env bash
set -Eeuo pipefail

export LANG=C.UTF-8
unset XDG_RUNTIME_DIR

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly AUTHORITY_PATH="${SCRIPT_DIR}/runtime-baseline.lock.json"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this bootstrap as root." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  dnf install -y jq
fi

jq --exit-status '
  .schemaVersion == 3 and
  .authorityId == "phase-01.podman-runtime-authority.v1" and
  .authority.podman.rootless == false and
  .authority.podman.restartPolicy == "no"
' "${AUTHORITY_PATH}" >/dev/null

authority_string() {
  jq --exit-status --raw-output "$1 | select(type == \"string\" and length > 0)" "${AUTHORITY_PATH}"
}

readonly EXPECTED_OS_ID="$(authority_string '.authority.host.osId')"
readonly EXPECTED_OS_VERSION="$(authority_string '.authority.host.osVersion')"
readonly NODE_VERSION="24.18.0"
readonly NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
readonly NODE_SHA256="55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742"
readonly NODE_INSTALL_DIR="/opt/node-v${NODE_VERSION}-linux-x64"
readonly PODMAN_NEVRA="$(authority_string '.authority.podman.packageNevra')"
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

source /etc/os-release
if [[ "${ID}" != "${EXPECTED_OS_ID}" || "${VERSION_ID}" != "${EXPECTED_OS_VERSION}" ]]; then
  echo "Expected Anolis OS ${EXPECTED_OS_VERSION}; received ${ID} ${VERSION_ID}." >&2
  exit 1
fi

dnf install -y \
  ca-certificates \
  curl \
  dnf-plugins-core \
  git \
  jq \
  tar \
  unzip \
  xz

if command -v docker >/dev/null 2>&1; then
  echo "Docker CLI is present; remove the superseded Docker runtime before bootstrapping Podman." >&2
  exit 1
fi

dnf module enable -y container-tools:an8
dnf install -y "${PODMAN_NEVRA}"
systemctl enable --now podman.socket

if [[ ! -x "${NODE_INSTALL_DIR}/bin/node" ]]; then
  work_dir="$(mktemp -d)"
  trap 'rm -rf -- "${work_dir}"' EXIT
  curl --fail --location --silent --show-error \
    "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}" \
    --output "${work_dir}/${NODE_ARCHIVE}"
  printf '%s  %s\n' "${NODE_SHA256}" "${work_dir}/${NODE_ARCHIVE}" | sha256sum --check --status
  tar --extract --xz --file "${work_dir}/${NODE_ARCHIVE}" --directory /opt
fi

for executable in node corepack; do
  if [[ -e "${NODE_INSTALL_DIR}/bin/${executable}" ]]; then
    ln -sfn "${NODE_INSTALL_DIR}/bin/${executable}" "/usr/local/bin/${executable}"
  fi
done

if [[ ! -x /usr/local/bin/npm ]] || \
   [[ "$(/usr/local/bin/npm --version 2>/dev/null || true)" != "11.9.0" ]]; then
  rm -f /usr/local/bin/npm /usr/local/bin/npx
  /usr/local/bin/node "${NODE_INSTALL_DIR}/lib/node_modules/npm/bin/npm-cli.js" \
    install --global --prefix /usr/local --ignore-scripts npm@11.9.0
fi

node --version
npm --version
git --version
podman version --format '{{.Version}}'
podman info --format '{{.Store.GraphDriverName}}'

[[ "$(node --version)" == "v${NODE_VERSION}" ]]
[[ "$(npm --version)" == "11.9.0" ]]
[[ "$(rpm -q --qf '%{NAME}-%{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}' podman)" == "${PODMAN_NEVRA}" ]]
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
! command -v docker >/dev/null 2>&1
