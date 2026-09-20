#!/usr/bin/env bash
# Live tail of ethixweb-voice-runtime logs, keeping only "call concurrency"
# lines and appending them to docs/call-concurrency.log as:
#   <ISO time> <event> <activeCalls> <machineId>
# Duplicates (same time + machineId + event) are skipped, so reconnect
# replays and overlap with collect-call-concurrency.sh are harmless.
# If the stream drops, it reconnects after 5 seconds and keeps going.
# Read-only against Fly. Meant to run under launchd; see
# scripts/com.ethixweb.call-concurrency.plist.example.
#
#   scripts/stream-call-concurrency.sh
#   FLY_APP=other-app OUT=/tmp/x.log RECONNECT_DELAY=1 scripts/stream-call-concurrency.sh
set -uo pipefail

# launchd starts with a minimal PATH; make sure `fly` and python3 are found.
export PATH="$PATH:$HOME/.fly/bin:/opt/homebrew/bin:/usr/local/bin"

APP="${FLY_APP:-ethixweb-voice-runtime}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/docs/call-concurrency.log}"
DELAY="${RECONNECT_DELAY:-5}"

mkdir -p "$(dirname "$OUT")"
touch "$OUT"

# Stop fly + python (this script's children) on launchd stop / Ctrl-C.
trap 'pkill -P $$ 2>/dev/null; exit 0' TERM INT

PY='
import json, re, sys
from datetime import datetime, timezone

out_path = sys.argv[1]
ansi = re.compile(r"\x1b\[[0-9;]*m")

seen = set()
with open(out_path) as f:
    for line in f:
        parts = line.split()
        if len(parts) == 4:
            seen.add((parts[0], parts[3], parts[1]))

for raw in iter(sys.stdin.readline, ""):
    line = ansi.sub("", raw)
    if "\"call concurrency\"" not in line or "{" not in line:
        continue
    try:
        j = json.loads(line[line.index("{"):])
        ms = int(j["time"])
        event, active, machine = j["event"], int(j["activeCalls"]), j["machineId"]
    except (ValueError, KeyError, TypeError):
        continue
    ts = datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"
    key = (ts, machine, event)
    if key in seen:
        continue
    seen.add(key)
    with open(out_path, "a") as f:
        f.write(f"{ts} {event} {active} {machine}\n")
'

while true; do
  echo "$(date -u +%FT%TZ) connecting to fly logs for $APP" >&2
  # Background + wait so the TERM trap fires immediately instead of after
  # the (never-ending) foreground pipeline.
  fly logs -a "$APP" | python3 -u -c "$PY" "$OUT" &
  wait $!
  echo "$(date -u +%FT%TZ) stream ended; reconnecting in ${DELAY}s" >&2
  sleep "$DELAY"
done
