#!/bin/sh
set -eu
TASK_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$TASK_ROOT"
# Optional local Node toolchain; production uses Node on PATH.
for TASK_NODE in "$TASK_ROOT"/.tools/node-v22-*/bin "$TASK_ROOT"/.tools/node-v22.*/bin; do
    if [ -x "$TASK_NODE/node" ]; then PATH="$TASK_NODE:$PATH"; export PATH; break; fi
done
if [ ! -d node_modules ]; then npm ci --omit=dev; fi
if [ ! -f dist/index.html ]; then npm ci; npm run build; fi
exec node src/server.js

