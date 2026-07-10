#!/usr/bin/env bash
set -euo pipefail

repo="${PAODING_DEPLOY_DIR:-$HOME/Code/paoding}"
state="$repo/.git/paoding-deployed"
marker="$repo/app/deploy-version.txt"

cd "$repo"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Paoding deploy checkout has tracked local changes; refusing to overwrite them." >&2
  exit 1
fi

git fetch origin main
local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse origin/main)"

if [ "$local_sha" != "$remote_sha" ]; then
  git pull --ff-only origin main
fi

current_sha="$(git rev-parse HEAD)"
deployed_sha="$(tr -d '\r\n' < "$state" 2>/dev/null || true)"
marker_sha="$(tr -d '\r\n' < "$marker" 2>/dev/null || true)"

if [ "$current_sha" = "$deployed_sha" ] && [ "$current_sha" = "$marker_sha" ]; then
  exit 0
fi

/usr/bin/node --test
systemctl --user restart paoding.service

for _ in $(seq 1 30); do
  if /usr/bin/curl -fsS http://127.0.0.1:4177/ >/dev/null; then
    printf '%s\n' "$current_sha" > "$state"
    printf '%s\n' "$current_sha" > "$marker"
    exit 0
  fi
  sleep 1
done

journalctl --user-unit paoding.service -n 80 --no-pager >&2 || true
echo "Paoding did not become healthy after deploying $current_sha." >&2
exit 1
