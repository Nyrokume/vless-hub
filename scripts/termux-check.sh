#!/usr/bin/env bash
# Full check of the published list from this device's network.
# This runs the same core probe as the server (Xray / sing-box), not the browser timing check.
# On a phone, run it in Termux with mobile data if you want that network's address.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec python -m vlesshub check-local "$@"
