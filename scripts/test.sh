#!/usr/bin/env bash
set -euo pipefail
# Direct execution provides individual assertion results in managed runtimes
# that restrict Node's child-process test isolation.
for suite in tests/*.test.js tests/*.test.mjs; do
  node "$suite"
done
