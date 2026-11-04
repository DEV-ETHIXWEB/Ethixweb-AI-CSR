#!/usr/bin/env bash
# Everything that can be verified without spending a single API credit.
#
#   scripts/check.sh            full run
#   scripts/check.sh --quick    skips the build (the slowest step)
#
# Exits 0 only if every CHECK passed. Costs nothing: no Anthropic or OpenAI
# call is made anywhere in here, including the QA suite step, which uses the
# suite's own --list mode.
#
# WARN lines are deliberately not failures. They are things only a human can
# clear (a missing key, a token scope), so they are reported every run rather
# than blocking it.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

FAILED=()
WARNED=()

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
amber() { printf '\033[33m%s\033[0m\n' "$1"; }

# run <label> <command...>
run() {
  local label="$1"; shift
  printf '%-34s' "$label"
  local out
  if out="$("$@" 2>&1)"; then
    green "PASS"
  else
    red "FAIL"
    FAILED+=("$label")
    printf '%s\n' "$out" | tail -25 | sed 's/^/    | /'
  fi
}

warn() {
  WARNED+=("$1")
}

echo "Ethixweb AI CSR — pre-flight check"
echo "$(date '+%Y-%m-%d %H:%M:%S')  $(git rev-parse --short HEAD 2>/dev/null || echo 'no git')"
echo

# --- static gates -----------------------------------------------------
run "lint"               pnpm run lint
run "typecheck"          pnpm run typecheck
run "format"             pnpm run format:check
[ "$QUICK" -eq 1 ] || run "build" pnpm run build

# --- tests ------------------------------------------------------------
# --force so a green turbo cache can never stand in for a real run.
run "unit tests"         pnpm run test:unit --force
run "e2e: orchestrator"  pnpm --filter @ethixweb/voice-orchestrator run test:e2e
run "e2e: voice-runtime" pnpm --filter @ethixweb/voice-runtime run test:e2e

# --- QA suite inventory (free: --list makes no completion) -------------
run "qa suite loads"     pnpm --filter @ethixweb/voice-orchestrator exec \
                           ts-node -T scripts/qa-suite.ts --list

# --- counts, for the record -------------------------------------------
echo
UNIT=$(pnpm run test:unit 2>&1 | grep -oE 'Tests: +[0-9]+ passed' | grep -oE '[0-9]+' | paste -sd+ - | bc 2>/dev/null || echo '?')
SCEN=$(pnpm --filter @ethixweb/voice-orchestrator exec ts-node -T scripts/qa-suite.ts --list 2>/dev/null \
        | grep -oE '^[0-9]+ scenarios' | grep -oE '^[0-9]+' || echo '?')
echo "unit tests passing : $UNIT"
echo "qa scenarios ready : $SCEN  (not run — see WARN below)"

# --- things only a human can clear ------------------------------------
if ! grep -qE '^QA_ANTHROPIC_API_KEY=.' apps/voice-orchestrator/.env 2>/dev/null; then
  warn "QA_ANTHROPIC_API_KEY is not set in apps/voice-orchestrator/.env.
      The $SCEN-scenario real-model suite CANNOT RUN without it, so nothing here
      has been checked against the live model. It must be a key from a SEPARATE
      Anthropic workspace with its own spend cap: this suite has twice exhausted
      the production account and taken the live phone line down.
      Then: pnpm --filter @ethixweb/voice-orchestrator exec ts-node -T scripts/qa-suite.ts"
fi

if git rev-parse --verify --quiet ci-e2e-gate >/dev/null 2>&1 \
   && [ -n "$(git log origin/main..ci-e2e-gate --oneline 2>/dev/null)" ]; then
  warn "Branch ci-e2e-gate is unpushed. It adds both e2e suites to CI, which is
      why three contract tests sat red on main for days unnoticed. Pushing it
      needs a GitHub token with 'workflow' scope.
      Then: git push origin ci-e2e-gate:main"
fi

AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
if [ "$AHEAD" -gt 0 ]; then
  warn "$AHEAD commit(s) on $(git branch --show-current) are not pushed to origin."
fi

# --- verdict ----------------------------------------------------------
echo
if [ ${#WARNED[@]} -gt 0 ]; then
  for w in "${WARNED[@]}"; do amber "WARN  $w"; done
  echo
fi

if [ ${#FAILED[@]} -eq 0 ]; then
  green "ALL CHECKS PASSED"
  if [ ${#WARNED[@]} -gt 0 ]; then
    echo "...but this is LOCAL AND DETERMINISTIC ONLY. See the WARN lines above:"
    echo "nothing here proves the CSR behaves correctly on a real call."
  fi
  exit 0
fi

red "FAILED: ${FAILED[*]}"
exit 1
