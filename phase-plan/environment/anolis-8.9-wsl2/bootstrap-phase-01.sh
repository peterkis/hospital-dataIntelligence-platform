#!/usr/bin/env bash
set -Eeuo pipefail

export LANG=C.UTF-8
unset XDG_RUNTIME_DIR

readonly EXPECTED_OS_ID="anolis"
readonly EXPECTED_OS_VERSION="8.9"
readonly NODE_VERSION="24.18.0"
readonly NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
readonly NODE_SHA256="55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742"
readonly NODE_INSTALL_DIR="/opt/node-v${NODE_VERSION}-linux-x64"
readonly PODMAN_NEVRA="podman-4:4.9.4-34.0.1.module+an8.10.0+11435+30029c08.x86_64"
readonly PODMAN_VERSION="4.9.4-rhel"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this bootstrap as root." >&2
  exit 1
fi

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
