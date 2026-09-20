#!/usr/bin/env bash
# Reads docs/call-concurrency.log and prints the peak combined activeCalls
# across all machines, and the number of calls (call_start events) per UTC day.
#
#   scripts/analyze-call-concurrency.sh [path-to-log]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="${1:-$ROOT/docs/call-concurrency.log}"

if [ ! -s "$FILE" ]; then
  echo "no data in $FILE yet"
  exit 0
fi

PY='
import sys
from collections import Counter

rows = []
for line in open(sys.argv[1]):
    p = line.split()
    if len(p) == 4:
        rows.append((p[0], p[1], int(p[2]), p[3]))
rows.sort()

latest = {}
peak, peak_at = 0, None
per_day = Counter()
for ts, event, active, machine in rows:
    latest[machine] = active
    total = sum(latest.values())
    if total > peak:
        peak, peak_at = total, ts
    if event == "call_start":
        per_day[ts[:10]] += 1

print(f"lines: {len(rows)}  machines: {len(latest)}  span: {rows[0][0]} .. {rows[-1][0]}")
print(f"peak combined activeCalls: {peak}" + (f"  (first reached {peak_at})" if peak_at else ""))
print("calls per day (UTC):")
for day in sorted(per_day):
    print(f"  {day}  {per_day[day]}")
'

python3 -c "$PY" "$FILE"
