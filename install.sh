#!/usr/bin/env bash
set -euo pipefail

# Installer for the gdrive single binary (decision 0003)
# Usage: curl -fsSL https://raw.githubusercontent.com/ncukondo/gdrive-cli/main/install.sh | bash
#
# Environment:
#   GDRIVE_CLI_VERSION      pin a release tag (e.g. v0.2.0); default: latest
#   GDRIVE_CLI_INSTALL_DIR  install location; default: ~/.local/bin

REPO="ncukondo/gdrive-cli"
INSTALL_DIR="${GDRIVE_CLI_INSTALL_DIR:-$HOME/.local/bin}"
BINARY_NAME="gdrive"

if [[ -t 1 ]]; then
  BOLD="\033[1m"
  GREEN="\033[32m"
  RED="\033[31m"
  RESET="\033[0m"
else
  BOLD="" GREEN="" RED="" RESET=""
fi

info() { echo -e "${BOLD}$*${RESET}"; }
success() { echo -e "${GREEN}$*${RESET}"; }
error() { echo -e "${RED}error: $*${RESET}" >&2; exit 1; }

detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Linux)  os="linux" ;;
    Darwin) os="darwin" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *) error "Unsupported OS: $os" ;;
  esac
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) error "Unsupported architecture: $arch" ;;
  esac
  echo "${os}-${arch}"
}

fetch() {
  local url="$1"
  if command -v curl &>/dev/null; then
    curl -fsSL "$url"
  elif command -v wget &>/dev/null; then
    wget -qO- "$url"
  else
    error "curl or wget is required"
  fi
}

get_latest_version() {
  fetch "https://api.github.com/repos/${REPO}/releases/latest" |
    grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"//;s/".*//'
}

verify_checksum() {
  local version="$1" filename="$2" dest="$3"
  local sha_cmd
  if command -v sha256sum &>/dev/null; then
    sha_cmd="sha256sum"
  elif command -v shasum &>/dev/null; then
    sha_cmd="shasum -a 256"
  else
    info "Skipping checksum verification (sha256sum/shasum not found)."
    return
  fi
  local sums expected actual
  sums="$(fetch "https://github.com/${REPO}/releases/download/${version}/SHA256SUMS")" ||
    { info "Skipping checksum verification (SHA256SUMS not found in release)."; return; }
  expected="$(echo "$sums" | grep -E "[[:space:]]\*?${filename}\$" | awk '{print $1}')"
  [[ -z "$expected" ]] && { info "Skipping checksum verification (no entry for ${filename})."; return; }
  actual="$($sha_cmd "$dest" | awk '{print $1}')"
  if [[ "$expected" != "$actual" ]]; then
    rm -f "$dest"
    error "Checksum mismatch for ${filename} (expected ${expected}, got ${actual})."
  fi
  info "Checksum verified."
}

download_binary() {
  local version="$1" platform="$2" dest="$3"
  local filename="gdrive-${platform}"
  [[ "$platform" == windows-* ]] && filename="${filename}.exe"
  local url="https://github.com/${REPO}/releases/download/${version}/${filename}"
  info "Downloading ${filename} (${version})..."
  if command -v curl &>/dev/null; then
    curl -fL --progress-bar -o "$dest" "$url" || error "Download failed. Check that release ${version} exists with binary ${filename}."
  elif command -v wget &>/dev/null; then
    wget --show-progress -qO "$dest" "$url" || error "Download failed. Check that release ${version} exists with binary ${filename}."
  else
    error "curl or wget is required for downloading."
  fi
  verify_checksum "$version" "$filename" "$dest"
  chmod +x "$dest"
}

configure_path() {
  local install_dir="$1"
  local path_line="export PATH=\"${install_dir}:\$PATH\""
  if echo "$PATH" | tr ':' '\n' | grep -qxF "$install_dir"; then
    return
  fi
  info "Adding ${install_dir} to PATH..."
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [[ -f "$rc" ]] && ! grep -qF "$install_dir" "$rc"; then
      echo "" >> "$rc"
      echo "# gdrive-cli" >> "$rc"
      echo "$path_line" >> "$rc"
      info "  Updated $(basename "$rc")"
    fi
  done
  local fish_config="$HOME/.config/fish/config.fish"
  if [[ -f "$fish_config" ]] && ! grep -qF "$install_dir" "$fish_config"; then
    echo "" >> "$fish_config"
    echo "# gdrive-cli" >> "$fish_config"
    echo "fish_add_path ${install_dir}" >> "$fish_config"
    info "  Updated config.fish"
  fi
}

main() {
  local platform version
  platform="$(detect_platform)"
  info "Detected platform: ${platform}"
  version="${GDRIVE_CLI_VERSION:-$(get_latest_version)}"
  [[ -z "$version" ]] && error "Could not determine latest version. Set GDRIVE_CLI_VERSION=v0.x.x to install a specific version."
  mkdir -p "$INSTALL_DIR"
  download_binary "$version" "$platform" "${INSTALL_DIR}/${BINARY_NAME}"
  configure_path "$INSTALL_DIR"
  if "${INSTALL_DIR}/${BINARY_NAME}" --version &>/dev/null; then
    success "Installed gdrive $(${INSTALL_DIR}/${BINARY_NAME} --version) to ${INSTALL_DIR}/${BINARY_NAME}"
  else
    error "Installation completed but binary verification failed"
  fi
  if ! command -v gdrive &>/dev/null; then
    echo ""
    info "Restart your shell or run:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
  fi
}

main
