#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this helper as root." >&2
  exit 1
fi

if [[ -z "${DOCKER_PROXY_URL:-}" ]]; then
  echo "Set DOCKER_PROXY_URL for the current WSL session." >&2
  exit 1
fi

readonly LOCAL_NO_PROXY="${DOCKER_NO_PROXY:-localhost,127.0.0.1,::1}"

systemctl set-environment \
  "HTTP_PROXY=${DOCKER_PROXY_URL}" \
  "HTTPS_PROXY=${DOCKER_PROXY_URL}" \
  "NO_PROXY=${LOCAL_NO_PROXY}"
systemctl restart docker

docker version --format '{{.Server.Version}}'

