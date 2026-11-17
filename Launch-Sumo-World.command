#!/bin/zsh -l
set -e
cd "${0:A:h}"
if curl --silent --max-time 2 http://127.0.0.1:3000 | grep -q 'Sumo World'; then
  open http://127.0.0.1:3000
  exit 0
fi
if [[ ! -d node_modules ]]; then
  npm ci --no-audit --no-fund
fi
npm run dev &
game_pid=$!
trap 'kill "$game_pid" 2>/dev/null || true' EXIT INT TERM
for attempt in {1..40}; do
  if curl --silent --max-time 2 http://127.0.0.1:3000 | grep -q 'Sumo World'; then
    open http://127.0.0.1:3000
    break
  fi
  sleep 1
done
wait "$game_pid"
