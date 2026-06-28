#!/usr/bin/env bash
# Run terminal-bench against the latest published varth release. The
# agent downloads the tarball from GitHub, verifies its sha256, and installs
# it inside the container. No local build toolchain required.
#
# Usage examples:
#   ./scripts/run-release.sh -i terminal-bench/fix-git
#   MODEL=varth-dev/minimax-m2.7 ./scripts/run-release.sh -i terminal-bench/fix-git
#   ./scripts/run-release.sh -i terminal-bench/fix-git -k 3 --agent-kwarg multi-model=true
set -euo pipefail

DATASET="terminal-bench/terminal-bench-2"

: "${VARTH_API_KEY:?set VARTH_API_KEY in env}"

BENCH_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BENCH_DIR"

# Force the release path: ignore any host-side binary.
unset VARTH_CODE_BINARY

exec uv run --python 3.14 harbor run \
    --agent-import-path varth_agent:Varth \
    --env docker \
    --model "${MODEL:-varth-dev/kimi-k2.5}" \
    --ae "VARTH_API_KEY=$VARTH_API_KEY" \
    -d "$DATASET" \
    "$@"
