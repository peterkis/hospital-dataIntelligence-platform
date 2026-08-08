#!/usr/bin/env bash
set -Eeuo pipefail

export LANG=C.UTF-8

readonly EXPECTED_OS_ID="anolis"
readonly EXPECTED_OS_VERSION="8.9"
readonly NODE_VERSION="24.18.0"
readonly NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
readonly NODE_SHA256="55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742"
readonly NODE_INSTALL_DIR="/opt/node-v${NODE_VERSION}-linux-x64"
readonly DOCKER_CE_VERSION="29.7.2-1.el8"
readonly DOCKER_CLI_VERSION="29.7.2-1.el8"
readonly CONTAINERD_VERSION="2.3.3-1.el8"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

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

if [[ ! -f /etc/yum.repos.d/docker-ce.repo ]]; then
  dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
fi

dnf install -y \
  "docker-ce-${DOCKER_CE_VERSION}" \
  "docker-ce-cli-${DOCKER_CLI_VERSION}" \
  "containerd.io-${CONTAINERD_VERSION}"

install -d -m 0755 /etc/docker
install -m 0644 "${SCRIPT_DIR}/docker-daemon.json" /etc/docker/daemon.json
systemctl enable --now docker

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
docker version --format '{{.Server.Version}}'
docker info --format '{{.Driver}}'

[[ "$(node --version)" == "v${NODE_VERSION}" ]]
[[ "$(npm --version)" == "11.9.0" ]]
[[ "$(docker version --format '{{.Server.Version}}')" == "29.7.2" ]]
[[ "$(docker info --format '{{.Driver}}')" == "overlay2" ]]
