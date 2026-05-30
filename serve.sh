#!/usr/bin/env bash
# Serve Finalyze on the local network (all interfaces).
set -euo pipefail

cd "$(dirname "$0")"
PORT="${PORT:-8754}"

ip=""
for iface in en0 en1 en2; do
  candidate="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
  if [[ -n "$candidate" ]]; then
    ip="$candidate"
    break
  fi
done
if [[ -z "$ip" ]]; then
  ip="$(scutil --nwi 2>/dev/null | awk '/address.*(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))\./ {print $3; exit}')"
fi

echo "Starting Finalyze on port ${PORT}…"
echo
echo "  This Mac:    http://localhost:${PORT}"
if [[ -n "$ip" ]]; then
  echo "  Network:     http://${ip}:${PORT}"
  echo
  echo "Open the Network URL on another device on the same Wi‑Fi."
else
  echo
  echo "Could not detect a local IP. Check System Settings → Network for your address,"
  echo "then visit http://<your-ip>:${PORT} from another device."
fi
echo
echo "Press Ctrl+C to stop."
echo

exec python3 -m http.server "$PORT" --bind 0.0.0.0
