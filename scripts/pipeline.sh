#!/usr/bin/env bash
# Conduit CI-equivalent pipeline, runnable without Docker.
# Mirrors .github/workflows/ci.yml so `make verify` and CI behave identically.
#
#   ./scripts/pipeline.sh            # test + lint + build
#   ./scripts/pipeline.sh --smoke    # + boot the production build and check deep links
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf "\n\033[1;36m== %s\033[0m\n" "$1"; }

step "1/4 server integration tests"
(cd server && npm test)

step "2/4 frontend lint"
npm run lint

step "3/4 frontend production build (tsc + vite)"
npm run build

step "4/4 backend production build (tsc)"
(cd server && npm run build)

if [[ "${1:-}" == "--smoke" ]]; then
  step "5/5 production smoke — preview server + deep-link fallback"
  PORT="${PREVIEW_PORT:-4173}"
  npm run preview -- --port "$PORT" --strictPort >/tmp/conduit-preview.log 2>&1 &
  PREVIEW_PID=$!
  trap 'kill $PREVIEW_PID 2>/dev/null || true' EXIT

  for _ in $(seq 1 30); do
    curl -sf -o /dev/null "http://localhost:$PORT/" && break
    sleep 0.5
  done

  curl -sf "http://localhost:$PORT/" | grep -q "<title>Conduit" || { echo "FAIL: root does not serve the SPA"; exit 1; }
  curl -sf "http://localhost:$PORT/room/4JWJUJ" | grep -q "<title>Conduit" || { echo "FAIL: /room/:code deep link does not fall back to the SPA"; exit 1; }
  curl -sf "http://localhost:$PORT/assets/" >/dev/null 2>&1 || true
  echo "ok: / and /room/:code served by the production build"
fi

printf "\n\033[1;32m✓ pipeline green\033[0m\n"
