#!/usr/bin/env bash
set -Eeuo pipefail

export LANG=C.UTF-8
unset XDG_RUNTIME_DIR

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly AUTHORITY_PATH="${SCRIPT_DIR}/runtime-baseline.lock.json"
jq --exit-status '
  .schemaVersion == 3 and
  .authorityId == "phase-01.podman-runtime-authority.v1" and
  .authority.podman.rootless == false
' "${AUTHORITY_PATH}" >/dev/null
readonly PODMAN_SOCKET_PATH="$(jq --exit-status --raw-output \
  '.authority.podman.socketPath | select(type == "string" and startswith("/"))' \
  "${AUTHORITY_PATH}")"
readonly PODMAN_VERSION="$(jq --exit-status --raw-output \
  '.authority.podman.version | select(type == "string" and length > 0)' \
  "${AUTHORITY_PATH}")"
readonly LOOPBACK_BIND_ADDRESS="$(jq --exit-status --raw-output \
  '.authority.network.bindAddress | select(type == "string" and length > 0)' \
  "${AUTHORITY_PATH}")"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this helper as root." >&2
  exit 1
fi

if [[ -z "${PODMAN_PROXY_URL:-}" ]]; then
  echo "Set PODMAN_PROXY_URL for the current WSL session." >&2
  exit 1
fi

readonly LOCAL_NO_PROXY="${PODMAN_NO_PROXY:-localhost,${LOOPBACK_BIND_ADDRESS},::1}"

systemctl set-environment \
  "HTTP_PROXY=${PODMAN_PROXY_URL}" \
  "HTTPS_PROXY=${PODMAN_PROXY_URL}" \
  "NO_PROXY=${LOCAL_NO_PROXY}"
systemctl restart podman.socket
systemctl is-active --quiet podman.socket
[[ -S "${PODMAN_SOCKET_PATH}" && ! -L "${PODMAN_SOCKET_PATH}" ]]

[[ "$(podman version --format '{{.Version}}')" == "${PODMAN_VERSION}" ]]
