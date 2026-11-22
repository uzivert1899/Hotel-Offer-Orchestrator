#!/bin/sh
set -eu

temporal server start-dev --ip 127.0.0.1 --db-filename /tmp/temporal.db --headless &
sleep 5
node dist/temporal/worker.js &
exec node dist/server.js
