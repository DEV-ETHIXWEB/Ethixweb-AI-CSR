#!/usr/bin/env bash
# Appends new "call concurrency" log lines from ethixweb-voice-runtime to
# docs/call-concurrency.log as: <ISO time> <event> <activeCalls> <machineId>
# Fly only returns the latest ~100 log lines per pull, so run this often
# enough that no call scrolls out between runs. Read-only against Fly.
#
#   scripts/collect-call-concurrency.sh
#   FLY_APP=other-app OUT=/tmp/x.log scripts/collect-call-concurrency.sh
set -euo pipefail

APP="${FLY_APP:-ethixweb-voice-runtime}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/docs/call-concurrency.log}"

mkdir -p "$(dirname "$OUT")"
touch "$OUT"

LOGS="$(fly logs -a "$APP" --no-tail)"

PY='
import json, re, sys
from datetime import datetime, timezone

out_path = sys.argv[1]
ansi = re.compile(r"\x1b\[[0-9;]*m")

with open(out_path) as f:
    seen = set()
    for line in f:
        parts = line.split()
        if len(parts) == 4:
            seen.add((parts[0], parts[3], parts[1]))

new = []
for raw in sys.stdin:
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
    new.append(f"{ts} {event} {active} {machine}")

new.sort()
if new:
    with open(out_path, "a") as f:
        f.write("\n".join(new) + "\n")
print(f"added {len(new)} new line(s) to {out_path}")
'

printf '%s\n' "$LOGS" | python3 -c "$PY" "$OUT"
