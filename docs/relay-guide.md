# Running Your Own BoilerDeck Relay

## Introduction

A BoilerDeck relay is a standalone server that stores and serves signed listing metadata over the NIP-01 WebSocket protocol. Running your own relay lets you:

- **Contribute to federation** — Help distribute listings across the network, reducing dependence on any single server.
- **Run your own marketplace** — Operate an independent storefront backed by the same protocol. Your relay can serve listings to any compatible client.
- **Data sovereignty** — Keep a local copy of all listing data you care about. Your relay, your rules.

Relays communicate with each other through federation. When a new listing is published on one relay, it propagates to all connected relays automatically. Cryptographic signatures (Nostr-style secp256k1 Schnorr) ensure that listing data cannot be tampered with in transit.

## System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 core | 2 cores |
| RAM | 512 MB | 1 GB |
| Disk | 1 GB | Scales with listing count |
| Database | PostgreSQL 14+ | PostgreSQL 16+ |
| Runtime | Node.js 22+ or Docker | Docker recommended |

The relay stores listing metadata only (titles, descriptions, signatures, torrent info hashes). It does not store or serve game files — those are distributed via BitTorrent.

## Quick Start with Docker

The fastest way to get a relay running:

```bash
git clone https://github.com/EthanGeisler/peerplay.git
cd peerplay/relay-server
cp .env.example .env
# Edit .env with your settings (see Environment Variables below)
docker compose up -d
```

This starts both the relay server and a PostgreSQL 16 database. Verify it is running:

```bash
curl http://localhost:3001/relay/info
```

You should see a JSON response with your relay name and description.

To stop the relay:

```bash
docker compose down
```

Data is persisted in a Docker volume (`pgdata`). To reset the database entirely:

```bash
docker compose down -v
```

## Manual Setup (without Docker)

### 1. Install prerequisites

- **Node.js 22+** — https://nodejs.org/
- **PostgreSQL 14+** — https://www.postgresql.org/download/

### 2. Clone and install

```bash
git clone https://github.com/EthanGeisler/peerplay.git
cd peerplay/relay-server
npm install
```

### 3. Create the database

```bash
createdb relay
```

Or via `psql`:

```sql
CREATE DATABASE relay;
CREATE USER relay WITH PASSWORD 'relay';
GRANT ALL PRIVILEGES ON DATABASE relay TO relay;
```

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your database credentials and relay settings (see Environment Variables below).

### 5. Run database migrations

```bash
npx prisma migrate deploy
```

### 6. Build and start

```bash
npm run build
npm start
```

The relay will be available at `http://localhost:3001`.

For development with auto-reload:

```bash
npm run dev
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | *(required)* | PostgreSQL connection string, e.g. `postgresql://relay:relay@localhost:5432/relay` |
| `PORT` | `3001` | HTTP and WebSocket port |
| `RELAY_NAME` | `"My BoilerDeck Relay"` | Displayed in `/relay/info` and to connected clients |
| `RELAY_DESCRIPTION` | `"A BoilerDeck federation relay"` | Relay description shown in `/relay/info` |
| `EXTERNAL_RELAYS` | `""` | Comma-separated WebSocket URLs for federation (e.g. `wss://boilerdeck.com/relay`) |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/relay/info` | GET | Relay metadata (NIP-11 compatible) |
| `/api/relay/listings` | GET | Browse all listings on this relay |
| `/api/relay/listings` | POST | Submit a signed listing event |
| `/relay` | WebSocket | NIP-01 protocol (REQ, EVENT, CLOSE) |

## Nginx Reverse Proxy

To expose your relay over HTTPS with a domain name, use Nginx as a reverse proxy. This is required for federation (other relays connect via `wss://`).

Install Nginx and obtain a TLS certificate (e.g., via Let's Encrypt):

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d relay.example.com
```

Create `/etc/nginx/sites-available/boilerdeck-relay`:

```nginx
server {
    listen 443 ssl;
    server_name relay.example.com;

    ssl_certificate /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
    }
}

server {
    listen 80;
    server_name relay.example.com;
    return 301 https://$server_name$request_uri;
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/boilerdeck-relay /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

The `proxy_read_timeout 86400s` (24 hours) is important for long-lived WebSocket connections. Without it, Nginx will close idle connections after 60 seconds by default.

## systemd Service

To run the relay as a system service that starts on boot and restarts on failure:

Create `/etc/systemd/system/boilerdeck-relay.service`:

```ini
[Unit]
Description=BoilerDeck Relay
After=network.target postgresql.service

[Service]
Type=simple
User=relay
WorkingDirectory=/opt/boilerdeck-relay
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/opt/boilerdeck-relay/.env

[Install]
WantedBy=multi-user.target
```

Set up the service:

```bash
# Create a dedicated user
sudo useradd -r -s /bin/false relay

# Copy the relay to /opt
sudo cp -r peerplay/relay-server /opt/boilerdeck-relay
sudo chown -R relay:relay /opt/boilerdeck-relay

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable boilerdeck-relay
sudo systemctl start boilerdeck-relay
```

Check status:

```bash
sudo systemctl status boilerdeck-relay
```

View logs:

```bash
journalctl -u boilerdeck-relay -f
```

## Tor Hidden Service

You can run your relay as a Tor hidden service for censorship resistance and anonymity. This gives your relay a `.onion` address accessible through the Tor network.

Install Tor:

```bash
sudo apt install tor
```

Add to `/etc/tor/torrc`:

```
HiddenServiceDir /var/lib/tor/boilerdeck-relay/
HiddenServicePort 80 127.0.0.1:3001
```

Restart Tor and retrieve your `.onion` address:

```bash
sudo systemctl restart tor
sudo cat /var/lib/tor/boilerdeck-relay/hostname
```

The output will be something like `abc123xyz456.onion`. Your relay is now accessible at `ws://abc123xyz456.onion/relay`.

**Notes on Tor performance:**
- WebSocket connections over Tor have high latency (typically 1-5 seconds per round trip). This makes real-time subscription updates slow.
- The REST API (`/relay/info`, `/api/relay/listings`) works well over Tor since it is request/response based.
- Consider running both a clearnet and Tor endpoint for the same relay — clearnet for performance, Tor for availability.

## Federation

Federation allows your relay to exchange listings with other relays in the network. When a listing is published on any federated relay, it automatically propagates to all connected relays.

### Connecting to the main BoilerDeck relay

Set the `EXTERNAL_RELAYS` environment variable in your `.env`:

```
EXTERNAL_RELAYS=wss://boilerdeck.com/relay
```

Restart the relay after changing this value. On startup, the relay will connect to each external relay via WebSocket and subscribe to new listing events.

### Connecting to multiple relays

Separate relay URLs with commas:

```
EXTERNAL_RELAYS=wss://boilerdeck.com/relay,wss://relay.example.com/relay
```

### How federation works

1. On startup, your relay opens a WebSocket connection to each external relay.
2. It sends a `REQ` subscription for listing events.
3. Incoming events are verified (signature checked via secp256k1 Schnorr) and stored locally.
4. Events published on your relay are forwarded to all connected external relays.
5. Loop prevention ensures that imported events are not re-federated back to their source.

### Making your relay discoverable

Once your relay is running with a public domain and TLS, other relay operators can add your URL to their `EXTERNAL_RELAYS`. There is no central registry — federation is peer-to-peer by configuration.

## Monitoring

### Health check

```bash
curl http://localhost:3001/relay/info
```

A successful response means the relay is running and accepting connections. This endpoint is suitable for uptime monitoring tools.

### Logs

If running via systemd:

```bash
journalctl -u boilerdeck-relay -f
```

If running via Docker:

```bash
docker compose logs -f relay
```

### Checking WebSocket connectivity

You can test the WebSocket endpoint with `websocat` or any WebSocket client:

```bash
# Install websocat (https://github.com/nickel-org/websocat)
websocat ws://localhost:3001/relay
```

Then send a NIP-01 REQ message:

```json
["REQ", "test-sub", {}]
```

You should receive listing events followed by an `EOSE` (end of stored events) message.

## Troubleshooting

**Relay won't start — database connection refused**
- Ensure PostgreSQL is running: `sudo systemctl status postgresql`
- Verify `DATABASE_URL` in `.env` matches your database credentials
- If using Docker, make sure the `db` service is healthy: `docker compose ps`

**WebSocket connections drop after 60 seconds**
- This is an Nginx timeout issue. Ensure `proxy_read_timeout 86400s;` is set in your Nginx config (see Nginx section above).

**Federation not working — no listings appearing**
- Check that `EXTERNAL_RELAYS` is set correctly (must use `wss://` for TLS relays, `ws://` for plain)
- Verify your relay can reach the external relay: `curl https://boilerdeck.com/relay/info`
- Check logs for connection errors: `journalctl -u boilerdeck-relay | grep -i federation`

**Signature verification failures**
- This means an event arrived with an invalid signature. The relay correctly rejects these. If you see many of these, the source relay may have a bug or be sending tampered data.
