#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
    identity="$(node /app/scripts/prepare-container-data.mjs)"
    exec setpriv --reuid="${identity%:*}" --regid="${identity#*:}" --clear-groups \
        --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs "$@"
fi

# An explicit Docker user skips root initialization; its data must already be writable.
exec "$@"
