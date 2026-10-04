#!/bin/sh
set -eu
TASK_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$TASK_ROOT"
if [ -x "$TASK_ROOT/.tools/node-v22.23.3-darwin-arm64/bin/node" ]; then
    PATH="$TASK_ROOT/.tools/node-v22.23.3-darwin-arm64/bin:$PATH"
    export PATH
fi
if [ -x "$TASK_ROOT/.tools/python/bin/python3" ]; then
    PYTHON_PATH=${PYTHON_PATH:-"$TASK_ROOT/.tools/python/bin/python3"}
    export PYTHON_PATH
fi
if [ -x "$TASK_ROOT/.tools/php/php" ]; then
    PHP_PATH=${PHP_PATH:-"$TASK_ROOT/.tools/php/php"}
    export PHP_PATH
fi
if [ ! -d node_modules ]; then npm ci --omit=dev; fi
if [ ! -f dist/index.html ]; then npm ci; npm run build; fi
exec node src/server.js

