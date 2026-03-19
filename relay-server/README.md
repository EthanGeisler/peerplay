# BoilerDeck Relay Server

A standalone relay for the BoilerDeck content federation network.

## Quick Start

```bash
docker compose up -d
```

The relay will be available at `http://localhost:3001`.

## Configuration

See `.env.example` for available environment variables.

## API

- `GET /relay/info` — Relay metadata
- `GET /api/relay/listings` — Browse listings
- `POST /api/relay/listings` — Submit signed listing
- `ws://localhost:3001/relay` — NIP-01 WebSocket

## License

MIT
