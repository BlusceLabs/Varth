#!/usr/bin/env bash
# Run terminal-bench against the current working tree. Always cross-builds a
# Linux amd64 varth binary, since terminal-bench task images are amd64
# (often amd64-only — Apple Silicon hosts run them under Rosetta translation).
#
# Usage examples:
#   ./scripts/run-local.sh -i terminal-bench/fix-git
#   MODEL=varth-dev/kimi-k2.5 ./scripts/run-local.sh -i terminal-bench/fix-git -k 3
#   ./scripts/run-local.sh -i terminal-bench/fix-git -k 3 --agent-kwarg multi-model=true
set -euo pipefail

DATASET="terminal-bench/terminal-bench-2"

: "${VARTH_API_KEY:?set VARTH_API_KEY in env}"

BENCH_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(git -C "$BENCH_DIR" rev-parse --show-toplevel)"

echo "==> Cross-building varth (target=linux-x64)"
(cd "$REPO_ROOT" && pnpm run build:binary-linux-x64)
# `build:binary-linux-x64` produces dist/bin/varth alongside dist/share/varth/{package.json,theme,export-html}.
# The agent walks up from the binary to find the share/ tree, so point VARTH_CODE_BINARY at bin/varth.
export VARTH_CODE_BINARY="$REPO_ROOT/dist/bin/varth"

cd "$BENCH_DIR"
exec uv run --python 3.14 harbor run \
    --agent-import-path varth_agent:Varth \
    --env docker \
    --model "${MODEL:-varth-dev/kimi-k2.5}" \
    --ae "VARTH_API_KEY=$VARTH_API_KEY" \
    -d "$DATASET" \
    "$@"
