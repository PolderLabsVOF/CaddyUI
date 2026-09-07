#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_NAME="CaddyUI"
SCRIPT_CHANNEL="dev"
INSTALLER_VERSION="2026.05.11-3"
REPO_URL="https://github.com/PolderLabsVOF/CaddyUI.git"
BRANCH="${CADDYUI_BRANCH:-$SCRIPT_CHANNEL}"
DEV_NIGHTLY_URL="${CADDYUI_DEV_NIGHTLY_URL:-}"
DEV_NIGHTLY_COMMIT="${CADDYUI_DEV_NIGHTLY_COMMIT:-}"
DEV_NIGHTLY_SHA256="${CADDYUI_DEV_NIGHTLY_SHA256:-}"
DEV_NIGHTLY_ASSET_PREFIX="caddyui-nightly-"
CONFIG_MODE="${CADDYUI_CONFIG_MODE:-}"
CADDY_API_URL="${CADDYUI_CADDY_API_URL:-http://127.0.0.1:2019}"
START_PORT="${CADDYUI_PORT:-8787}"
PORT_SCAN_LIMIT="${CADDYUI_PORT_SCAN_LIMIT:-100}"
RUN_USER="${SUDO_USER:-${USER:-caddyui}}"
IS_ROOT=0
[[ "${EUID:-$(id -u)}" -eq 0 ]] && IS_ROOT=1

if [[ "$IS_ROOT" -eq 1 ]]; then
  INSTALL_DIR="${CADDYUI_INSTALL_DIR:-/opt/caddyui}"
  DATA_DIR="${CADDY_UI_DATA_DIR:-/var/lib/caddyui}"
  LOG_DIR="${CADDYUI_LOG_DIR:-/var/log/caddyui}"
else
  INSTALL_DIR="${CADDYUI_INSTALL_DIR:-$HOME/.local/share/caddyui/app}"
  DATA_DIR="${CADDY_UI_DATA_DIR:-$HOME/.local/share/caddyui/data}"
  LOG_DIR="${CADDYUI_LOG_DIR:-$HOME/.local/share/caddyui/logs}"
fi

INSTALL_LOG="$LOG_DIR/install.log"
APP_LOG="$LOG_DIR/caddyui.log"
SERVICE_NAME="caddyui"
DRY_RUN="${CADDYUI_DRY_RUN:-0}"
PENDING_CADDY_RELOAD=0
PENDING_PROXY_HOST=""
PENDING_CADDYFILE=""

BLUE='\033[0;34m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

logo() {
  printf "%b\n" "${CYAN}"
  cat <<'ART'
   ______          __    __      __  ______
  / ____/___ _____/ /___/ /_  __/ / / /  _/
 / /   / __ `/ __  / __  / / / / / / // /  
/ /___/ /_/ / /_/ / /_/ / /_/ / /_/ // /   
\____/\__,_/\__,_/\__,_/\__, /\____/___/   
                        /____/             
ART
  printf "%b\n" "${NC}${BOLD}Automated installer${NC}"
  printf "%b\n" "installer ${INSTALLER_VERSION}\n"
}

step() { printf "%b\n" "${BLUE}▶${NC} ${BOLD}$*${NC}"; }
ok() { printf "%b\n" "${GREEN}✓${NC} $*"; }
warn() { printf "%b\n" "${YELLOW}!${NC} $*"; }
fail() { printf "%b\n" "${RED}✗${NC} $*" >&2; exit 1; }
app_version_from_dir() {
  local dir="$1"
  local package_json="$dir/package.json"
  [[ -f "$package_json" ]] || { printf 'unknown'; return 0; }
  node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(p.version||"unknown"));' "$package_json" 2>/dev/null || printf 'unknown'
}
run_quiet() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] %s\n' "$*" >> "$INSTALL_LOG"
    return 0
  fi
  printf '\n$ %s\n' "$*" >> "$INSTALL_LOG"
  "$@" >> "$INSTALL_LOG" 2>&1
}
need_cmd() { command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"; }
has_cmd() { command -v "$1" >/dev/null 2>&1; }
confirm() {
  local prompt="$1"
  local default="${2:-no}"
  local answer=""
  local suffix="[y/N]"
  [[ "$default" == "yes" ]] && suffix="[Y/n]"
  if [[ "${CADDYUI_ASSUME_YES:-0}" == "1" ]]; then return 0; fi
  if [[ -r /dev/tty ]]; then
    read -r -p "$prompt $suffix " answer < /dev/tty
  elif [[ -t 0 ]]; then
    read -r -p "$prompt $suffix " answer
  else
    fail "Missing interactive terminal. Re-run with CADDYUI_ASSUME_YES=1 to accept prompts automatically."
  fi
  if [[ -z "$answer" ]]; then [[ "$default" == "yes" ]]; return; fi
  [[ "$answer" =~ ^[Yy]$|^[Yy][Ee][Ss]$ ]]
}
sudo_cmd() {
  if [[ "$IS_ROOT" -eq 1 ]]; then "$@"; else sudo "$@"; fi
}
detect_package_manager() {
  if has_cmd apt-get; then echo apt; return; fi
  if has_cmd dnf; then echo dnf; return; fi
  if has_cmd yum; then echo yum; return; fi
  if has_cmd pacman; then echo pacman; return; fi
  if has_cmd zypper; then echo zypper; return; fi
  if has_cmd apk; then echo apk; return; fi
  if has_cmd brew; then echo brew; return; fi
  echo none
}
install_system_packages() {
  local pm="$1"; shift
  local packages=("$@")
  case "$pm" in
    apt)
      run_quiet sudo_cmd apt-get update -y
      run_quiet sudo_cmd apt-get install -y "${packages[@]}"
      ;;
    dnf) run_quiet sudo_cmd dnf install -y "${packages[@]}" ;;
    yum) run_quiet sudo_cmd yum install -y "${packages[@]}" ;;
    pacman) run_quiet sudo_cmd pacman -Sy --noconfirm "${packages[@]}" ;;
    zypper) run_quiet sudo_cmd zypper --non-interactive install "${packages[@]}" ;;
    apk) run_quiet sudo_cmd apk add --no-cache "${packages[@]}" ;;
    brew) run_quiet brew install "${packages[@]}" ;;
    *) fail "No supported package manager found. Install missing dependencies manually." ;;
  esac
}
check_and_install_prerequisites() {
  local missing=()
  local pm packages=()
  has_cmd git || missing+=(git)
  has_cmd curl || missing+=(curl)
  has_cmd node || missing+=(node)
  has_cmd npm || missing+=(npm)

  if [[ "${#missing[@]}" -gt 0 ]]; then
    warn "Missing dependencies: ${missing[*]}"
    confirm "Install missing dependencies now?" || fail "Install cancelled. Missing: ${missing[*]}"
    pm="$(detect_package_manager)"
    if [[ "$IS_ROOT" -ne 1 && "$pm" != "brew" ]] && ! has_cmd sudo; then
      fail "sudo is required to install system dependencies. Install sudo or run this installer as root."
    fi
    case "$pm" in
      apt|dnf|yum|zypper) for dep in "${missing[@]}"; do [[ "$dep" == node ]] && packages+=(nodejs) || packages+=("$dep"); done ;;
      pacman|apk|brew) for dep in "${missing[@]}"; do [[ "$dep" == node || "$dep" == npm ]] && packages+=(nodejs npm) || packages+=("$dep"); done ;;
      *) fail "No supported package manager found. Install missing dependencies manually: ${missing[*]}" ;;
    esac
    mapfile -t packages < <(printf '%s\n' "${packages[@]}" | awk 'NF && !seen[$0]++')
    install_system_packages "$pm" "${packages[@]}"
  fi

  need_cmd git
  need_cmd curl
  need_cmd node
  need_cmd npm
  NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [[ "$NODE_MAJOR" -lt 20 ]]; then
    warn "Node.js 20+ is required. Found $(node -v)."
    confirm "Try to upgrade/install Node.js with the system package manager?" || fail "Node.js 20+ is required."
    pm="$(detect_package_manager)"
    case "$pm" in
      apt)
        run_quiet sudo_cmd apt-get update -y
        run_quiet sudo_cmd apt-get install -y ca-certificates curl gnupg
        if [[ "$DRY_RUN" != "1" ]]; then
          curl -fsSL https://deb.nodesource.com/setup_22.x | sudo_cmd bash - >> "$INSTALL_LOG" 2>&1
        else
          printf '[dry-run] curl -fsSL https://deb.nodesource.com/setup_22.x | bash\n' >> "$INSTALL_LOG"
        fi
        run_quiet sudo_cmd apt-get install -y nodejs
        ;;
      dnf|yum) install_system_packages "$pm" nodejs npm ;;
      pacman|apk|zypper|brew) install_system_packages "$pm" nodejs npm ;;
      *) fail "No supported package manager found for Node.js upgrade." ;;
    esac
    NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
    [[ "$NODE_MAJOR" -ge 20 ]] || fail "Node.js 20+ is still not available after install attempt. Found $(node -v)."
  fi
}

sqlite_runtime_ok() {
  if [[ "$DRY_RUN" == "1" ]]; then return 0; fi
  if [[ ! -d "$INSTALL_DIR/node_modules/sqlite3" ]]; then return 1; fi
  (
    cd "$INSTALL_DIR"
    node -e "require('sqlite3'); process.stdout.write('ok')"
  ) >> "$INSTALL_LOG" 2>&1
}

ensure_native_build_prereqs() {
  local pm
  pm="$(detect_package_manager)"
  if [[ "$IS_ROOT" -ne 1 && "$pm" != "brew" ]] && ! has_cmd sudo; then
    fail "sudo is required to install sqlite build dependencies. Install sudo or run this installer as root."
  fi
  case "$pm" in
    apt) install_system_packages "$pm" build-essential python3 make g++ pkg-config libsqlite3-dev ;;
    dnf|yum) install_system_packages "$pm" gcc-c++ make python3 pkgconf-pkg-config sqlite-devel ;;
    pacman) install_system_packages "$pm" base-devel python sqlite ;;
    zypper) install_system_packages "$pm" gcc-c++ make python3 pkg-config sqlite3-devel ;;
    apk) install_system_packages "$pm" build-base python3 pkgconf sqlite-dev ;;
    brew) install_system_packages "$pm" python sqlite ;;
    *) fail "No supported package manager found. Install build tools and sqlite dev package manually." ;;
  esac
}

app_uses_sqlite3() {
  if [[ "$DRY_RUN" == "1" ]]; then return 1; fi
  node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const deps = Object.assign({}, p.dependencies || {}, p.optionalDependencies || {});
process.exit(deps.sqlite3 ? 0 : 1);
' "$INSTALL_DIR/package.json" >> "$INSTALL_LOG" 2>&1
}

ensure_sqlite_compat() {
  if ! app_uses_sqlite3; then
    return 0
  fi
  if sqlite_runtime_ok; then
    return 0
  fi
  warn "sqlite3 binary is not compatible with this system."
  confirm "Install build dependencies and rebuild sqlite3 now?" yes || fail "Install cancelled. CaddyUI cannot run without sqlite3 compatibility."
  step "Installing native build dependencies"
  ensure_native_build_prereqs
  ok "Build dependencies installed"
  step "Rebuilding sqlite3 for this host"
  run_quiet npm --prefix "$INSTALL_DIR" rebuild sqlite3 --build-from-source
  if ! sqlite_runtime_ok; then
    fail "sqlite3 rebuild failed. Check $INSTALL_LOG"
  fi
  ok "sqlite3 rebuilt for local system"
}

listen_check() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${port}$"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  else
    (echo > "/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1
  fi
}
find_free_port() {
  local port="$START_PORT"
  local max=$((START_PORT + PORT_SCAN_LIMIT))
  while [[ "$port" -le "$max" ]]; do
    if ! listen_check "$port"; then echo "$port"; return 0; fi
    port=$((port + 1))
  done
  fail "No free TCP port found from $START_PORT to $max"
}
existing_configured_port() {
  [[ -f "$INSTALL_DIR/.env" ]] || return 0
  awk -F= '$1=="CADDY_UI_PORT" {print $2}' "$INSTALL_DIR/.env" 2>/dev/null | tail -1
}
select_runtime_port() {
  local existing_port=""
  if [[ -n "${CADDYUI_PORT:-}" ]]; then
    START_PORT="$CADDYUI_PORT"
    PORT="$(find_free_port)"
    return 0
  fi
  existing_port="$(existing_configured_port || true)"
  if [[ -n "$existing_port" ]]; then
    PORT="$existing_port"
    return 0
  fi
  PORT="$(find_free_port)"
}
primary_ip() {
  local ip=""
  ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  if [[ -z "$ip" ]] && command -v ip >/dev/null 2>&1; then
    ip="$(ip route get 1.1.1.1 2>/dev/null | awk '/src/ {for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1)"
  fi
  [[ -n "$ip" ]] && echo "$ip" || echo "127.0.0.1"
}
write_env() {
  cat > "$INSTALL_DIR/.env" <<ENV
NODE_ENV=production
CADDY_UI_PORT=$PORT
CADDY_UI_DATA_DIR=$DATA_DIR
CADDY_UI_SECRET=$SECRET
CADDY_UI_SETUP_TOKEN=$SETUP_TOKEN_VALUE
CADDY_UI_CONFIG_MODE=$CONFIG_MODE
CADDY_UI_CADDY_API_URL=$CADDY_API_URL
ENV
  chmod 600 "$INSTALL_DIR/.env" || true
  if [[ "$IS_ROOT" -eq 1 ]]; then chown "$RUN_USER":"$RUN_USER" "$INSTALL_DIR/.env" 2>/dev/null || true; fi
}
systemd_available() { [[ "$(command -v systemctl || true)" != "" && -d /run/systemd/system ]]; }
want_systemd_service() {
  if ! systemd_available; then return 1; fi
  if [[ "${CADDYUI_SYSTEMD:-}" == "1" ]]; then return 0; fi
  if [[ "${CADDYUI_SYSTEMD:-}" == "0" ]]; then return 1; fi
  confirm "Install CaddyUI as a systemd service so it auto-starts after reboot?" yes
}
start_with_systemd() {
  local service_path="/etc/systemd/system/${SERVICE_NAME}.service"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] write %s\n' "$service_path" >> "$INSTALL_LOG"
    return 0
  fi
  cat > "$service_path" <<SERVICE
[Unit]
Description=CaddyUI web interface
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=5
StandardOutput=append:$APP_LOG
StandardError=append:$APP_LOG

[Install]
WantedBy=multi-user.target
SERVICE
  run_quiet systemctl daemon-reload
  run_quiet systemctl enable "$SERVICE_NAME"
  run_quiet systemctl restart "$SERVICE_NAME"
}
start_with_nohup() {
  local runner="$INSTALL_DIR/start-caddyui.sh"
  cat > "$runner" <<RUNNER
#!/usr/bin/env bash
set -a
source "$INSTALL_DIR/.env"
set +a
cd "$INSTALL_DIR"
exec "$(command -v node)" server/index.js
RUNNER
  chmod +x "$runner"
  if [[ "$DRY_RUN" == "1" ]]; then return 0; fi
  if [[ -f "$INSTALL_DIR/caddyui.pid" ]]; then
    old_pid="$(cat "$INSTALL_DIR/caddyui.pid" 2>/dev/null || true)"
    if [[ -n "$old_pid" ]]; then kill "$old_pid" >/dev/null 2>&1 || true; fi
  fi
  nohup "$runner" >> "$APP_LOG" 2>&1 &
  echo $! > "$INSTALL_DIR/caddyui.pid"
}
wait_for_app() {
  if [[ "$DRY_RUN" == "1" ]]; then return 0; fi
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  warn "Service did not answer yet. Check $APP_LOG"
}

read_tty() {
  local prompt="$1"
  local answer=""
  if [[ -r /dev/tty ]]; then
    read -r -p "$prompt" answer < /dev/tty
  elif [[ -t 0 ]]; then
    read -r -p "$prompt" answer
  else
    return 1
  fi
  printf '%s' "$answer"
}
valid_domain() {
  [[ "$1" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]]
}
select_config_mode() {
  local answer=""
  case "${CONFIG_MODE,,}" in
    api|file) CONFIG_MODE="${CONFIG_MODE,,}"; return 0 ;;
  esac
  if [[ "${CADDYUI_ASSUME_YES:-0}" == "1" ]]; then
    CONFIG_MODE="api"
    return 0
  fi
  answer="$(read_tty "Install in API mode or file mode? [api/file] (default: api): " || true)"
  answer="${answer:-api}"
  answer="${answer,,}"
  [[ "$answer" == "api" || "$answer" == "file" ]] || fail "Invalid config mode: $answer"
  CONFIG_MODE="$answer"
}
caddy_api_healthy() {
  curl -fsS "${CADDY_API_URL%/}/config/" >/dev/null 2>&1
}
enable_caddy_api_in_file() {
  local file="$1"
  local tmp
  tmp="$(mktemp)"
  if grep -Eq '^[[:space:]]*\{' "$file"; then
    awk '
      BEGIN { inserted = 0 }
      /^[[:space:]]*\{/ && inserted == 0 {
        print $0
        print "\tadmin 127.0.0.1:2019"
        inserted = 1
        next
      }
      { print $0 }
    ' "$file" > "$tmp"
  else
    {
      printf "{\n\tadmin 127.0.0.1:2019\n}\n\n"
      cat "$file"
    } > "$tmp"
  fi
  if caddy validate --config "$tmp" --adapter caddyfile >> "$INSTALL_LOG" 2>&1; then
    copy_caddyfile "$tmp" "$file"
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 1
}
ensure_api_mode_ready() {
  local file=""
  if caddy_api_healthy; then
    ok "Caddy API is reachable at $CADDY_API_URL"
    return 0
  fi
  warn "Caddy API is not reachable at $CADDY_API_URL"
  confirm "Try to enable the Caddy admin API on this machine?" yes || return 0
  file="$(find_caddyfiles | head -1 || true)"
  [[ -n "$file" ]] || fail "Could not find a readable Caddyfile to enable the admin API."
  step "Enabling Caddy admin API in $file"
  enable_caddy_api_in_file "$file" || fail "Failed to update Caddyfile for admin API. Check $INSTALL_LOG"
  if command -v caddy >/dev/null 2>&1; then
    run_quiet caddy reload --config "$file" --adapter caddyfile || warn "Caddy reload failed. Reload it manually after install."
  fi
  if caddy_api_healthy; then
    ok "Caddy API is now reachable"
    return 0
  fi
  warn "Caddy API is still not reachable. You may need to reload Caddy manually."
}

# Caddy's file-backed unit deliberately reloads the Caddyfile on every start.
# That is incompatible with an API-managed configuration: it silently discards
# changes made through CaddyUI. The distribution ships caddy-api.service for
# this exact mode; prefer it whenever systemd is available.
ensure_durable_caddy_api_service() {
  [[ "$CONFIG_MODE" == "api" ]] || return 0
  if ! systemd_available; then
    warn "systemd is unavailable; ensure Caddy starts with 'caddy run --resume' yourself."
    return 0
  fi
  if ! systemctl cat caddy-api.service >/dev/null 2>&1; then
    warn "caddy-api.service is not installed. Configure Caddy to run with --resume before relying on API-managed configuration."
    return 0
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    ok "Would switch Caddy to durable API mode (caddy-api.service)"
    return 0
  fi

  step "Making Caddy API configuration durable"
  # The active config is also Caddy's resume source. Keep a private snapshot
  # before changing units so an operator can recover even if a local package is
  # customised.
  mkdir -p "$DATA_DIR/backups"
  curl -fsS "${CADDY_API_URL%/}/config/" > "$DATA_DIR/backups/caddy-api-before-service-switch-$(date +%Y%m%d%H%M%S).json" || true
  chmod 600 "$DATA_DIR"/backups/caddy-api-before-service-switch-*.json 2>/dev/null || true

  sudo_cmd systemctl enable caddy-api.service
  sudo_cmd systemctl disable caddy.service || true
  if systemctl is-active --quiet caddy.service; then
    sudo_cmd systemctl stop caddy.service
  fi
  sudo_cmd systemctl start caddy-api.service
  if ! systemctl is-active --quiet caddy-api.service || ! caddy_api_healthy; then
    warn "caddy-api.service did not become healthy. Restoring caddy.service."
    sudo_cmd systemctl stop caddy-api.service || true
    sudo_cmd systemctl enable caddy.service || true
    sudo_cmd systemctl start caddy.service || true
    fail "Could not switch Caddy to durable API mode. The original service was restored."
  fi
  ok "Caddy now resumes its API-managed configuration after restart"
}

apply_caddyfile_via_api() {
  local file="$1"
  curl -fsS -X POST \
    -H 'Content-Type: text/caddyfile' \
    --data-binary "@$file" \
    "${CADDY_API_URL%/}/load" >/dev/null
}
find_caddyfiles() {
  local paths=(
    "${CADDYFILE_PATH:-}"
    "/etc/caddy/Caddyfile"
    "/config/Caddyfile"
    "/data/caddy/Caddyfile"
    "/srv/caddy/Caddyfile"
    "/usr/local/etc/caddy/Caddyfile"
  )
  printf '%s\n' "${paths[@]}" | awk 'NF && !seen[$0]++' | while read -r file; do
    [[ -f "$file" && -r "$file" ]] && printf '%s\n' "$file"
  done
}
extract_domains() {
  local file="$1"
  sed -nE 's/^[[:space:]]*([^#][^{]*)\{[[:space:]]*$/\1/p' "$file" \
    | tr ',' '\n' \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s#^https?://##; s/:.*$//' \
    | grep -E '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' \
    | awk 'NF && $0 !~ /^\(/ && !seen[$0]++'
}
base_domain() {
  local host="$1"
  awk -F. '{ if (NF>=2) print $(NF-1) "." $NF; else print $0 }' <<< "$host"
}
choose_proxy_target() {
  local files=()
  local options=()
  local file host domain answer index subdomain manual_domain explicit_domain
  mapfile -t files < <(find_caddyfiles)
  if [[ "${#files[@]}" -eq 0 ]]; then
    printf "%b\n" "${YELLOW}!${NC} No readable Caddyfile found for reverse proxy setup." >&2
    return 1
  fi
  if [[ -n "${CADDYUI_PROXY_DOMAIN:-}" ]]; then
    explicit_domain="${CADDYUI_PROXY_DOMAIN}"
    valid_domain "$explicit_domain" || return 1
    subdomain="${CADDYUI_PROXY_SUBDOMAIN:-caddyui}"
    echo "${files[0]}|${explicit_domain}|$subdomain"
    return 0
  fi
  for file in "${files[@]}"; do
    while read -r host; do
      [[ -n "$host" ]] || continue
      domain="$(base_domain "$host")"
      [[ -n "$domain" ]] && options+=("$file|$domain")
    done < <(extract_domains "$file")
  done
  if [[ "${#options[@]}" -eq 0 ]]; then
    printf "%b\n" "${YELLOW}!${NC} No domains found in detected Caddyfiles." >&2
    if [[ "${CADDYUI_PROXY:-}" == "0" ]]; then return 1; fi
    manual_domain="$(read_tty "Domain: " || true)"
    valid_domain "$manual_domain" || return 1
    subdomain="$(read_tty "Subdomain [caddyui]: " || true)"
    subdomain="${subdomain:-caddyui}"
    echo "${files[0]}|${manual_domain}|$subdomain"
    return 0
  fi
  mapfile -t options < <(printf '%s\n' "${options[@]}" | awk 'NF && !seen[$0]++')
  printf "%b\n" "${BLUE}▶${NC} ${BOLD}Caddy reverse proxy${NC}" >&2
  printf 'Detected Caddyfiles:\n' >&2
  for file in "${files[@]}"; do
    printf '  - %s\n' "$file" >&2
  done
  printf 'Choose domain:\n' >&2
  for i in "${!options[@]}"; do
    printf '  %s) %s\n' "$((i+1))" "${options[$i]#*|}" >&2
  done
  printf '  m) manual domain\n' >&2
  if [[ "${CADDYUI_PROXY:-}" == "0" ]]; then return 1; fi
  if [[ "${CADDYUI_PROXY:-}" == "1" ]]; then
    subdomain="${CADDYUI_PROXY_SUBDOMAIN:-caddyui}"
    echo "${options[0]}|$subdomain"
    return 0
  fi
  answer="$(read_tty "Add a Caddy reverse proxy entry? [1]: " || true)"
  answer="${answer:-1}"
  if [[ "$answer" == "m" || "$answer" == "M" ]]; then
    manual_domain="$(read_tty "Domain: " || true)"
    valid_domain "$manual_domain" || return 1
    subdomain="$(read_tty "Subdomain [caddyui]: " || true)"
    subdomain="${subdomain:-caddyui}"
    echo "${files[0]}|${manual_domain}|$subdomain"
    return 0
  fi
  [[ "$answer" =~ ^[0-9]+$ ]] || return 1
  index=$((answer-1))
  [[ "$index" -ge 0 && "$index" -lt "${#options[@]}" ]] || return 1
  subdomain="$(read_tty "Subdomain [caddyui]: " || true)"
  subdomain="${subdomain:-caddyui}"
  echo "${options[$index]}|$subdomain"
}
write_caddyfile() {
  local file="$1"
  local content="$2"
  if [[ -w "$file" ]]; then
    printf '%s\n' "$content" >> "$file"
  else
    printf '%s\n' "$content" | sudo_cmd tee -a "$file" >/dev/null
  fi
}
copy_caddyfile() {
  local from="$1"
  local to="$2"
  if [[ -r "$from" && -w "$(dirname "$to")" ]]; then
    cp "$from" "$to"
  else
    sudo_cmd cp "$from" "$to"
  fi
}
setup_caddy_proxy() {
  local target file domain_sub domain subdomain host block backup validation
  target="$(choose_proxy_target || true)"
  [[ -n "$target" ]] || { ok "Caddy reverse proxy skipped"; return 0; }
  file="${target%%|*}"
  domain_sub="${target#*|}"
  domain="${domain_sub%%|*}"
  subdomain="${domain_sub#*|}"
  host="${subdomain}.${domain}"
  if grep -Eq "^[[:space:]]*$host[[:space:]]*\{" "$file"; then
    ok "Caddy reverse proxy already exists: $host"
    return 0
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    ok "Would add Caddy reverse proxy: $host"
    return 0
  fi
  block="
$host {
    reverse_proxy 127.0.0.1:$PORT
}"
  backup="$file.caddyui.$(date +%Y%m%d%H%M%S).bak"
  copy_caddyfile "$file" "$backup"
  write_caddyfile "$file" "$block"
  if has_cmd caddy; then
    validation="$(caddy validate --config "$file" --adapter caddyfile 2>&1 || true)"
    if [[ -n "$validation" ]]; then printf '%s\n' "$validation" >> "$INSTALL_LOG"; fi
    if ! caddy validate --config "$file" --adapter caddyfile >> "$INSTALL_LOG" 2>&1; then
      copy_caddyfile "$backup" "$file"
      warn "Caddy validation failed. Restored backup."
      return 0
    fi
    PENDING_CADDY_RELOAD=1
    PENDING_PROXY_HOST="$host"
    PENDING_CADDYFILE="$file"
    ok "Caddy reverse proxy added: https://$host"
  else
    ok "Caddy reverse proxy added: $host"
  fi
}

prompt_caddy_reload() {
  [[ "$PENDING_CADDY_RELOAD" -eq 1 ]] || return 0
  if confirm "Apply the CaddyUI proxy through the Admin API now?" yes; then
    if apply_caddyfile_via_api "$PENDING_CADDYFILE" >> "$INSTALL_LOG" 2>&1; then
      ok "Caddy configuration applied through the Admin API"
    else
      warn "Caddy Admin API apply failed. The Caddyfile was updated but Caddy's live API configuration was not changed."
    fi
  else
    warn "Apply the proxy through CaddyUI after installation to activate $PENDING_PROXY_HOST."
  fi
}

run_existing_update() {
  step "Existing installation detected"
  ok "Running in update mode"
  step "Updating source"
  run_quiet git -C "$INSTALL_DIR" remote set-url origin "$REPO_URL"
  if [[ "$BRANCH" == "dev" && -n "$DEV_NIGHTLY_URL" ]]; then
    install_dev_nightly
  else
    run_quiet git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH"
    run_quiet git -C "$INSTALL_DIR" checkout --quiet "$BRANCH"
    run_quiet git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
    run_quiet git -C "$INSTALL_DIR" clean -fd -e data/ -e .env -e logs/ -e '*.log' -e '*.pid'
  fi
  ok "Source updated"
  APP_VERSION="$(app_version_from_dir "$INSTALL_DIR")"
  ok "Installing app version $APP_VERSION"

  step "Installing dependencies"
  if [[ -f "$INSTALL_DIR/package-lock.json" ]]; then
    run_quiet npm --prefix "$INSTALL_DIR" ci
  else
    run_quiet npm --prefix "$INSTALL_DIR" install
  fi
  ensure_sqlite_compat
  ok "Dependencies installed"

  step "Building web interface"
  run_quiet npm --prefix "$INSTALL_DIR" run build
  ok "Production build complete"

  step "Restarting CaddyUI"
  if systemd_available && { systemctl list-unit-files | grep -q "^${SERVICE_NAME}\.service" || [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; }; then
    run_quiet systemctl daemon-reload
    run_quiet systemctl restart "$SERVICE_NAME"
    ok "Systemd service restarted"
  else
    start_with_nohup
    ok "Background process restarted"
  fi

  if [[ -f "$INSTALL_DIR/.env" && -z "${CADDYUI_PORT:-}" ]]; then
    existing_port="$(awk -F= '$1==\"CADDY_UI_PORT\" {print $2}' \"$INSTALL_DIR/.env\" 2>/dev/null | tail -1)"
    [[ -n "$existing_port" ]] && PORT="$existing_port"
  fi
  PORT="${PORT:-$START_PORT}"
  wait_for_app
  IP="$(primary_ip)"
  URL="http://$IP:$PORT"
  printf "\n%b\n" "${GREEN}${BOLD}CaddyUI updated.${NC}"
  printf "%b\n" "Open: ${BOLD}$URL${NC}"
  printf "%b\n" "Install log: $INSTALL_LOG"
  printf "%b\n" "App log:     $APP_LOG"
  exit 0
}

install_dev_nightly() {
  local temp_dir archive digest expected_url archive_commit
  [[ "$DEV_NIGHTLY_COMMIT" =~ ^[0-9a-fA-F]{40}$ ]] || fail "Dev nightly update is missing an immutable commit."
  expected_url="https://github.com/PolderLabsVOF/CaddyUI/releases/download/nightly/${DEV_NIGHTLY_ASSET_PREFIX}${DEV_NIGHTLY_COMMIT}.tar.gz"
  [[ "$DEV_NIGHTLY_URL" == "$expected_url" ]] || fail "Refusing an untrusted dev nightly download URL."
  [[ "$DEV_NIGHTLY_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || fail "Dev nightly update has an invalid archive digest."
  has_cmd sha256sum || fail "sha256sum is required to verify the dev nightly archive."

  temp_dir="$(mktemp -d)"
  archive="$temp_dir/$DEV_NIGHTLY_ASSET"
  step "Downloading latest successful dev nightly"
  run_quiet curl --fail --location --retry 3 --output "$archive" "$DEV_NIGHTLY_URL" || { rm -rf "$temp_dir"; fail "Unable to download the dev nightly archive."; }
  digest="$(sha256sum "$archive" | awk '{print $1}')"
  [[ "$digest" == "$DEV_NIGHTLY_SHA256" ]] || { rm -rf "$temp_dir"; fail "Dev nightly archive digest verification failed."; }
  tar -tzf "$archive" | grep -qx 'caddyui-nightly/package.json' || { rm -rf "$temp_dir"; fail "Dev nightly archive has an unexpected layout."; }
  archive_commit="$(tar -xOf "$archive" caddyui-nightly/.caddyui-nightly-commit 2>/dev/null || true)"
  [[ "$archive_commit" == "$DEV_NIGHTLY_COMMIT" ]] || { rm -rf "$temp_dir"; fail "Dev nightly archive does not match its advertised commit."; }

  run_quiet git -C "$INSTALL_DIR" fetch --quiet origin dev
  run_quiet git -C "$INSTALL_DIR" cat-file -e "$DEV_NIGHTLY_COMMIT^{commit}" || { rm -rf "$temp_dir"; fail "Dev nightly commit is not available from origin/dev."; }
  run_quiet git -C "$INSTALL_DIR" checkout --quiet -B caddyui-nightly "$DEV_NIGHTLY_COMMIT"
  run_quiet git -C "$INSTALL_DIR" reset --hard "$DEV_NIGHTLY_COMMIT"
  run_quiet git -C "$INSTALL_DIR" clean -fd -e data/ -e .env -e logs/ -e '*.log' -e '*.pid'
  tar -xzf "$archive" --strip-components=1 -C "$INSTALL_DIR" || { rm -rf "$temp_dir"; fail "Unable to extract the verified dev nightly archive."; }
  rm -rf "$temp_dir"
  ok "Installed verified dev nightly ${DEV_NIGHTLY_COMMIT:0:7}"
}

logo
mkdir -p "$LOG_DIR"
: > "$INSTALL_LOG"
step "Checking prerequisites"
check_and_install_prerequisites
ok "Required tools are available"
select_config_mode
if [[ "$CONFIG_MODE" == "api" ]]; then
  ensure_api_mode_ready
  ensure_durable_caddy_api_service
fi
if [[ "$BRANCH" == "dev" ]]; then
  warn "Development branch. Not stable."
fi

step "Preparing install directories"
mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$LOG_DIR"
if [[ "$IS_ROOT" -eq 1 ]]; then
  chown -R "$RUN_USER":"$RUN_USER" "$INSTALL_DIR" "$DATA_DIR" "$LOG_DIR" 2>/dev/null || true
fi
ok "Install directory: $INSTALL_DIR"

if [[ -d "$INSTALL_DIR/.git" && "${CADDYUI_FORCE_INSTALL:-0}" != "1" ]]; then
  run_existing_update
fi

step "Selecting runtime port"
select_runtime_port
ok "Using port $PORT"

step "Downloading CaddyUI from GitHub"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  run_quiet git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH"
  run_quiet git -C "$INSTALL_DIR" checkout --quiet "$BRANCH"
  run_quiet git -C "$INSTALL_DIR" pull --ff-only --quiet origin "$BRANCH"
else
  rm -rf "$INSTALL_DIR"
  run_quiet git clone --quiet --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
if [[ "$DRY_RUN" == "1" ]]; then mkdir -p "$INSTALL_DIR"; fi
ok "Source is ready"
APP_VERSION="$(app_version_from_dir "$INSTALL_DIR")"
ok "Installing app version $APP_VERSION"

step "Installing dependencies"
if [[ -f "$INSTALL_DIR/package-lock.json" ]]; then
  run_quiet npm --prefix "$INSTALL_DIR" ci
else
  run_quiet npm --prefix "$INSTALL_DIR" install
fi
ensure_sqlite_compat
ok "Dependencies installed"

step "Building web interface"
run_quiet npm --prefix "$INSTALL_DIR" run build
ok "Production build complete"

step "Writing runtime configuration"
if command -v openssl >/dev/null 2>&1; then
  SECRET="$(openssl rand -hex 32)"
  SETUP_TOKEN_VALUE="$(openssl rand -hex 12)"
else
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  SETUP_TOKEN_VALUE="$(node -e 'console.log(require("crypto").randomBytes(12).toString("hex"))')"
fi
write_env
ok "Runtime environment configured"

step "Starting CaddyUI"
if want_systemd_service; then
  if [[ "$IS_ROOT" -ne 1 ]] && ! has_cmd sudo; then
    warn "sudo is required to install a systemd service. Falling back to background process."
    start_with_nohup
    ok "Started in the background"
  else
    start_with_systemd
    ok "Systemd service installed and started: $SERVICE_NAME"
  fi
else
  start_with_nohup
  ok "Started in the background"
fi
wait_for_app
warn "CaddyUI does not modify a Caddyfile in API mode. Open the local onboarding URL below, then create its reverse proxy through CaddyUI after onboarding."

IP="$(primary_ip)"
URL="http://$IP:$PORT"
printf "\n%b\n" "${GREEN}${BOLD}CaddyUI installation complete.${NC}"
printf "%b\n" "Open onboarding: ${BOLD}$URL${NC}"
printf "%b\n" "Setup token: $SETUP_TOKEN_VALUE"
printf "%b\n" "Install log: $INSTALL_LOG"
printf "%b\n" "App log:     $APP_LOG"
