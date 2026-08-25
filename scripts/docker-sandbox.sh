#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX_DIR="${CADDYUI_SANDBOX_DIR:-$ROOT_DIR/.tmp/docker-test-env}"
COMPOSE_FILE="$SANDBOX_DIR/compose.yaml"
STACK_NAME="${CADDYUI_SANDBOX_STACK:-caddyui-sandbox}"

HOST_UI_PORT="${CADDYUI_SANDBOX_UI_PORT:-5173}"
HOST_API_PORT="${CADDYUI_SANDBOX_API_PORT:-8787}"
HOST_HTTP_PORT="${CADDYUI_SANDBOX_HTTP_PORT:-8080}"
HOST_ADMIN_PORT="${CADDYUI_SANDBOX_ADMIN_PORT:-2019}"

ADMIN_USER="${CADDYUI_SANDBOX_ADMIN_USER:-admin}"
ADMIN_PASSWORD="${CADDYUI_SANDBOX_ADMIN_PASSWORD:-adminpass123!}"
APP_SECRET="${CADDYUI_SANDBOX_SECRET:-sandbox-secret-please-change-me-0001}"
COOKIE_JAR="$SANDBOX_DIR/cookies.txt"

usage() {
  cat <<'EOF'
Usage: scripts/docker-sandbox.sh <command>

Commands:
  up       Create sandbox files, build, start, and auto-configure test environment
  down     Stop the sandbox containers
  logs     Tail sandbox logs
  status   Show sandbox container status
  reset    Stop stack and delete sandbox files

Environment overrides:
  CADDYUI_SANDBOX_DIR
  CADDYUI_SANDBOX_STACK
  CADDYUI_SANDBOX_UI_PORT
  CADDYUI_SANDBOX_API_PORT
  CADDYUI_SANDBOX_HTTP_PORT
  CADDYUI_SANDBOX_ADMIN_PORT
  CADDYUI_SANDBOX_ADMIN_USER
  CADDYUI_SANDBOX_ADMIN_PASSWORD
  CADDYUI_SANDBOX_SECRET
EOF
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

compose() {
  docker compose -p "$STACK_NAME" -f "$COMPOSE_FILE" "$@"
}

write_sandbox_files() {
  mkdir -p "$SANDBOX_DIR/logs" "$SANDBOX_DIR/caddyui-data"

  if [[ -f "$ROOT_DIR/Caddyfile.example" ]]; then
    cp "$ROOT_DIR/Caddyfile.example" "$SANDBOX_DIR/Caddyfile.example"
  fi

cat >"$SANDBOX_DIR/Caddyfile.test" <<'EOF'
{
  admin :2019 {
    origins http://127.0.0.1:2019 http://localhost:2019 http://127.0.0.1:5173 http://localhost:5173 http://127.0.0.1:8787 http://localhost:8787
  }
  http_port 8080
  auto_https off
}

(security_headers) {
  header {
    X-Frame-Options DENY
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
    X-Sandbox-Env caddyui
  }
}

(pass_host) {
  header_up Host {host}
  header_up X-Forwarded-Proto {scheme}
  header_up X-Forwarded-For {remote_host}
}

(json_response) {
  header Content-Type application/json
}

:8080 {
  import security_headers
  log {
    output file /sandbox/logs/caddy-access.log
    format console
  }
  handle /raw-example {
    root * /sandbox
    file_server
  }
  handle {
    respond "Caddy sandbox is running" 200
  }
}

# Simple mock API service
:8081 {
  import security_headers
  handle /healthz {
    respond "ok" 200
  }
  handle /api/info {
    import json_response
    respond "{\"service\":\"mock-api\",\"env\":\"sandbox\",\"ok\":true}" 200
  }
  handle {
    respond "mock-api fallback" 200
  }
}

# Proxy/load-balancer style config using local upstreams
:8082 {
  import security_headers
  reverse_proxy 127.0.0.1:8081 127.0.0.1:8081 {
    import pass_host
    lb_policy round_robin
    health_uri /healthz
    health_interval 10s
  }
}

# Host-based local routing examples (use Host header or local DNS override)
http://app.local.test {
  import security_headers
  reverse_proxy 127.0.0.1:5173 {
    import pass_host
  }
}

http://api.local.test {
  import security_headers
  reverse_proxy 127.0.0.1:8787 {
    import pass_host
  }
}

# Redirect + HTTPS internal CA example
http://secure.local.test {
  redir https://secure.local.test{uri} 308
}

https://secure.local.test {
  tls internal
  import security_headers
  encode zstd gzip
  respond "secure route via internal TLS" 200
}

# Matcher + rewrite + route chaining examples
:8090 {
  import security_headers
  @api path /v1/* /v2/*
  handle @api {
    rewrite * /api/info
    reverse_proxy 127.0.0.1:8081 {
      import pass_host
    }
  }
  handle /docs/* {
    uri strip_prefix /docs
    respond "docs path after strip: {uri}" 200
  }
  handle {
    respond "route/matcher demo on :8090" 200
  }
}

# Static files + browse example
:8091 {
  import security_headers
  root * /usr/share/caddy
  file_server browse
}

# Named matcher with method + path
:8092 {
  import security_headers
  @webhook {
    method POST
    path /webhook/*
  }
  handle @webhook {
    respond "webhook accepted" 202
  }
  handle {
    respond "use POST /webhook/*" 405
  }
}

EOF

  cat >"$SANDBOX_DIR/entrypoint.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

mkdir -p /sandbox/logs /sandbox/caddyui-data
cd /workspace

LOCK_HASH_FILE="/sandbox/.package-lock.sha256"
CURRENT_LOCK_HASH="$(sha256sum /workspace/package-lock.json | awk '{print $1}')"
PREV_LOCK_HASH=""

if [[ -f "$LOCK_HASH_FILE" ]]; then
  PREV_LOCK_HASH="$(cat "$LOCK_HASH_FILE" 2>/dev/null || true)"
fi

if [[ ! -d /workspace/node_modules || "$CURRENT_LOCK_HASH" != "$PREV_LOCK_HASH" ]]; then
  npm ci --no-audit --no-fund
  printf '%s\n' "$CURRENT_LOCK_HASH" > "$LOCK_HASH_FILE"
fi

caddy run --config /sandbox/Caddyfile.test --adapter caddyfile > /sandbox/logs/caddy.log 2>&1 &
CADDY_PID=$!

npm run dev > /sandbox/logs/caddyui.log 2>&1 &
APP_PID=$!

shutdown() {
  kill "$APP_PID" "$CADDY_PID" >/dev/null 2>&1 || true
  wait "$APP_PID" "$CADDY_PID" >/dev/null 2>&1 || true
}
trap shutdown EXIT INT TERM

wait -n "$APP_PID" "$CADDY_PID"
EOF
  chmod +x "$SANDBOX_DIR/entrypoint.sh"

  cat >"$SANDBOX_DIR/Dockerfile" <<'EOF'
FROM node:22-trixie-slim

COPY --from=caddy:2 /usr/bin/caddy /usr/local/bin/caddy

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ pkg-config libsqlite3-dev \
  && rm -rf /var/lib/apt/lists/*

EXPOSE 5173 8787 8080 2019
CMD ["/sandbox/entrypoint.sh"]
EOF

  cat >"$SANDBOX_DIR/.dockerignore" <<'EOF'
caddyui-data/
logs/
*.db
*.db-wal
*.db-shm
cookies.txt
.last-api-body.json
.package-lock.sha256
EOF

  cat >"$COMPOSE_FILE" <<EOF
name: $STACK_NAME
services:
  app:
    build:
      context: $SANDBOX_DIR
      dockerfile: Dockerfile
    environment:
      CADDY_UI_PORT: "8787"
      CADDY_UI_DATA_DIR: "/sandbox/caddyui-data"
      CADDY_UI_SECRET: "$APP_SECRET"
      CADDY_UI_CONFIG_MODE: "file"
      CADDY_UI_CADDY_API_URL: "http://127.0.0.1:2019"
      CADDY_UI_LOG_ROOTS: "/sandbox/logs,/var/log/caddy,/data/caddy/logs,/config/log"
      CADDY_UI_ALLOW_REMOTE_SETUP: "1"
      CHOKIDAR_USEPOLLING: "true"
      NODE_ENV: "development"
    volumes:
      - $SANDBOX_DIR:/sandbox
      - $ROOT_DIR:/workspace
      - caddyui_node_modules:/workspace/node_modules
    ports:
      - "$HOST_UI_PORT:5173"
      - "$HOST_API_PORT:8787"
      - "$HOST_HTTP_PORT:8080"
      - "$HOST_ADMIN_PORT:2019"
    restart: unless-stopped
volumes:
  caddyui_node_modules:
EOF
}

wait_for_app() {
  local url="http://127.0.0.1:${HOST_API_PORT}/api/status"
  for _ in $(seq 1 360); do
    if curl --max-time 2 -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for CaddyUI API at $url" >&2
  return 1
}

api_post() {
  local endpoint="$1"
  local payload="$2"
  local tmp_body="$SANDBOX_DIR/.last-api-body.json"
  local origin="http://127.0.0.1:${HOST_API_PORT}"
  local code

  code="$(
    curl -sS -o "$tmp_body" -w '%{http_code}' \
      -H "Content-Type: application/json" \
      -H "Origin: $origin" \
      -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
      --data "$payload" \
      "${origin}${endpoint}"
  )"
  echo "$code"
}

bootstrap_setup() {
  rm -f "$COOKIE_JAR"
  touch "$COOKIE_JAR"

  local code

  code="$(api_post '/api/setup/user' "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASSWORD\"}")"
  if [[ "$code" != "200" && "$code" != "409" ]]; then
    echo "Failed to create setup user (HTTP $code)." >&2
    cat "$SANDBOX_DIR/.last-api-body.json" >&2 || true
    return 1
  fi

  if [[ "$code" == "409" ]]; then
    code="$(api_post '/api/login' "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASSWORD\"}")"
    if [[ "$code" != "200" ]]; then
      echo "User exists but login failed (HTTP $code)." >&2
      cat "$SANDBOX_DIR/.last-api-body.json" >&2 || true
      return 1
    fi
  fi

  code="$(api_post '/api/setup/config' "{\"configMode\":\"file\",\"caddyfilePath\":\"/sandbox/Caddyfile.test\",\"caddyApiUrl\":\"http://127.0.0.1:2019\",\"logPaths\":[\"/sandbox/logs/caddy-access.log\"]}")"
  if [[ "$code" != "200" ]]; then
    echo "Failed to configure sandbox Caddy settings (HTTP $code)." >&2
    cat "$SANDBOX_DIR/.last-api-body.json" >&2 || true
    return 1
  fi
}

cmd_up() {
  if [[ ${#APP_SECRET} -lt 32 ]]; then
    echo "CADDYUI_SANDBOX_SECRET must be at least 32 chars." >&2
    exit 1
  fi

  write_sandbox_files
  compose up -d --build
  wait_for_app
  bootstrap_setup

  cat <<EOF
Sandbox is running.

Sandbox directory (ignored by git): $SANDBOX_DIR
UI:        http://127.0.0.1:$HOST_UI_PORT
CaddyUI:   http://127.0.0.1:$HOST_API_PORT
Caddy app: http://127.0.0.1:$HOST_HTTP_PORT
Caddy API: http://127.0.0.1:$HOST_ADMIN_PORT

Login:
  username: $ADMIN_USER
  password: $ADMIN_PASSWORD

Manage stack:
  scripts/docker-sandbox.sh status
  scripts/docker-sandbox.sh logs
  scripts/docker-sandbox.sh down
EOF
}

cmd_down() {
  [[ -f "$COMPOSE_FILE" ]] || {
    echo "No compose file found at $COMPOSE_FILE" >&2
    return 0
  }
  compose down
}

cmd_logs() {
  local app_log="$SANDBOX_DIR/logs/caddyui.log"
  local caddy_log="$SANDBOX_DIR/logs/caddy.log"
  if [[ -f "$app_log" || -f "$caddy_log" ]]; then
    tail -n 150 -f "$app_log" "$caddy_log"
    return
  fi
  [[ -f "$COMPOSE_FILE" ]] || {
    echo "No compose file found at $COMPOSE_FILE" >&2
    exit 1
  }
  compose logs -f --tail=150
}

cmd_status() {
  [[ -f "$COMPOSE_FILE" ]] || {
    echo "No compose file found at $COMPOSE_FILE" >&2
    exit 1
  }
  compose ps
}

cmd_reset() {
  if [[ -f "$COMPOSE_FILE" ]]; then
    compose down --remove-orphans --volumes || true
  fi
  rm -rf "$SANDBOX_DIR"
  echo "Removed sandbox: $SANDBOX_DIR"
}

main() {
  local command="${1:-up}"
  need_cmd docker
  need_cmd curl
  docker compose version >/dev/null

  case "$command" in
    up) cmd_up ;;
    down) cmd_down ;;
    logs) cmd_logs ;;
    status) cmd_status ;;
    reset) cmd_reset ;;
    -h|--help|help) usage ;;
    *)
      echo "Unknown command: $command" >&2
      usage
      exit 1
      ;;
  esac
}

main "$@"
