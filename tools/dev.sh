#!/bin/sh
# Run the app locally on http://localhost:9095 with the password "dev-password".
# "tools/dev.sh styleguide" starts the stub server instead and serves the
# style guide at http://localhost:9200/styleguide (any password works).
set -e
cd "$(dirname "$0")/.."
if [ "$1" = "styleguide" ]; then
	echo "Style guide: http://localhost:9200/styleguide"
	exec python3 tools/stub.py 9200
fi
DATA_DIR=./data APP_PASSWORD=dev-password PORT=9095 exec go run ./cmd/pinned
