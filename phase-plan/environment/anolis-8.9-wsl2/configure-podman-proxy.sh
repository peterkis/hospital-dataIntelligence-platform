#!/usr/bin/env bash
set -Eeuo pipefail

export LANG=C.UTF-8
unset XDG_RUNTIME_DIR

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this helper as root." >&2
  exit 1
fi

if [[ -z "${PODMAN_PROXY_URL:-}" ]]; then
  echo "Set PODMAN_PROXY_URL for the current WSL session." >&2
  exit 1
fi

readonly LOCAL_NO_PROXY="${PODMAN_NO_PROXY:-localhost,127.0.0.1,::1}"

systemctl set-environment \
  "HTTP_PROXY=${PODMAN_PROXY_URL}" \
  "HTTPS_PROXY=${PODMAN_PROXY_URL}" \
  "NO_PROXY=${LOCAL_NO_PROXY}"
systemctl restart podman.socket
systemctl is-active --quiet podman.socket
[[ -S /run/podman/podman.sock ]]

podman version --format '{{.Version}}'
