#!/usr/bin/env bash
# Run terminal-bench with GSD, configured to use one selected Varth model.
#
# Usage examples:
#   MODEL=varth-dev/kimi-k2.5 ./scripts/run-gsd-varth.sh -i terminal-bench/fix-git
#   MODEL=varth-dev/minimax-m2.7 ./scripts/run-gsd-varth.sh -i terminal-bench/fix-git -k 3
#   GSD_VERSION=3.0.0 MODEL=varth-dev/kimi-k2.5 ./scripts/run-gsd-varth.sh -i terminal-bench/fix-git
set -euo pipefail

DATASET="terminal-bench/terminal-bench-2"

: "${VARTH_API_KEY:?set VARTH_API_KEY in env}"

BENCH_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BENCH_DIR"

HARBOR_ARGS=(
    --agent-import-path varth_agent:GsdVarth
    --env docker
    --model "${MODEL:-varth-dev/kimi-k2.5}"
    --ae "VARTH_API_KEY=$VARTH_API_KEY"
    -d "$DATASET"
)

if [[ -n "${GSD_VERSION:-}" ]]; then
    HARBOR_ARGS+=(--agent-kwarg "version=$GSD_VERSION")
fi

exec uv run --python 3.14 harbor run "${HARBOR_ARGS[@]}" "$@"
