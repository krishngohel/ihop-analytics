#!/bin/bash
# IHOP Operations Dashboard launcher for macOS. Double-click to start; close the window to stop.
cd "$(dirname "$0")/server" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org, then open this again."
  open "https://nodejs.org"
  read -r -p "Press Return to close."
  exit 1
fi

NODE_OK=$(node -e "const [a,b]=process.versions.node.split('.').map(Number);console.log(a>22||(a===22&&b>=9)?'yes':'no')")
if [ "$NODE_OK" != "yes" ]; then
  echo "Node.js $(node -v) is too old. Version 22.9 or newer is needed: https://nodejs.org"
  read -r -p "Press Return to close."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing components (needs internet, about a minute)..."
  npm install --omit=dev || { read -r -p "Install failed. Press Return to close."; exit 1; }
fi

[ -f .env ] || cp .env.example .env

echo "Starting the dashboard at http://localhost:4000  (leave this window open)"
( sleep 3; open "http://localhost:4000" ) &
# caffeinate keeps the Mac from idle-sleeping while the dashboard runs, so scheduled refreshes happen.
exec caffeinate -i node --experimental-sqlite --env-file-if-exists=.env src/index.js
