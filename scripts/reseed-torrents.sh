#!/bin/bash
# Re-seed all published game torrents in Transmission on the VPS.
#
# Usage (from local machine):
#   ssh root@204.168.133.38 'bash -s' < scripts/reseed-torrents.sh
#
# This is needed after:
#   - Uploading new games (addToTransmission is fire-and-forget, often fails for large torrents)
#   - Restarting Transmission (doesn't persist torrents)
#   - Any VPS rebuild

set -e

echo "=== Re-seeding all published torrents ==="

# Get Transmission CSRF token
CSRF=$(curl -s -o /dev/null -D - http://127.0.0.1:9091/transmission/rpc 2>&1 | grep -oP "X-Transmission-Session-Id: \K.*" | tr -d "\r\n")
echo "CSRF token acquired"

# Query all torrents for published games
sudo -u postgres psql -d peerplay -t -A -c "
  SELECT t.id, g.title
  FROM torrents t
  JOIN game_versions gv ON gv.torrent_id = t.id
  JOIN games g ON g.id = gv.game_id
  WHERE g.status = 'PUBLISHED'
  ORDER BY g.title;
" | while IFS='|' read -r tid title; do
  echo "Re-seeding: $title (torrent $tid)"

  # Write base64 torrent to temp file (avoids 'Argument list too long' for large torrents)
  sudo -u postgres psql -d peerplay -t -A -c "SELECT encode(torrent_file, 'base64') FROM torrents WHERE id = '$tid';" > /tmp/torrent_b64.txt

  # Build JSON payload via python (handles large base64 safely)
  python3 -c "
import json
with open('/tmp/torrent_b64.txt') as f:
    b64 = f.read().strip()
payload = json.dumps({'method': 'torrent-add', 'arguments': {'metainfo': b64, 'download-dir': '/opt/boilerdeck/games'}})
with open('/tmp/torrent_payload.json', 'w') as f:
    f.write(payload)
print(f'  Payload: {len(payload)} bytes')
"

  RESULT=$(curl -s -X POST http://127.0.0.1:9091/transmission/rpc \
    -H "X-Transmission-Session-Id: $CSRF" \
    -d @/tmp/torrent_payload.json)
  echo "  $RESULT"
done

rm -f /tmp/torrent_b64.txt /tmp/torrent_payload.json

echo ""
echo "=== Transmission status ==="
transmission-remote -l
