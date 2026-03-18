# BoilerDeck Privacy Guide

This document describes BoilerDeck's privacy features, how they work, their limitations, and how server operators can set up a Tor hidden service for end-to-end onion routing.

---

## Privacy Modes

The Electron client supports three privacy modes, configurable from **Settings > Privacy & Network**.

### Off (default)

All traffic goes directly to `boilerdeck.com` over HTTPS. Your IP address is visible to:

- The BoilerDeck API server
- BitTorrent trackers and peers during game downloads
- DNS resolvers

### Tor (built-in)

The client bundles a Tor executable and manages its lifecycle automatically. When enabled:

- **API traffic** is routed through Tor's SOCKS5 proxy (port 9150) when "Route API traffic through proxy" is checked.
- **Game downloads (torrents)** are NOT routed through Tor. Tor is too slow for multi-gigabyte game transfers and would degrade the experience for the entire Tor network. The torrent routing checkbox is disabled in Tor mode.
- The client bootstraps Tor on activation and shows progress in the Settings UI.

**What Tor hides:**
- Your IP address from the BoilerDeck API server (API traffic exits through a Tor exit node, or stays entirely within the onion network if a `.onion` address is configured)

**What Tor does NOT hide:**
- Your IP address from BitTorrent peers and trackers during game downloads
- The fact that you are using Tor (your ISP can see Tor traffic, though not its contents)
- Metadata visible to the exit node (unless using `.onion` routing — see below)

### Custom SOCKS5

Route traffic through any SOCKS5 proxy (e.g., a VPN's SOCKS5 interface, an SSH tunnel, or another Tor instance).

- Both API traffic and torrent traffic can be independently routed through the proxy.
- You provide the proxy host, port, and optional username/password.

**What a SOCKS5 proxy hides:**
- Your IP address from BoilerDeck and BitTorrent peers (they see the proxy's IP)

**What a SOCKS5 proxy does NOT hide:**
- Your traffic from the proxy operator (the proxy can see all traffic unless it's also encrypted end-to-end)
- The destinations you connect to, from the proxy operator

---

## .onion Auto-Discovery

When Tor mode is active and API routing is enabled, the client automatically queries the relay info endpoint (`/api/relay/info`) to check for an `onion_address` field. If present, the client rewrites its API base URL from `https://boilerdeck.com/api` to `http://<onion_address>/api` for all subsequent API calls.

This provides **end-to-end onion routing**: traffic never leaves the Tor network, eliminating the Tor exit node from the path entirely. This is strictly better than routing through an exit node because:

1. No exit node can observe or tamper with the traffic
2. The server's real IP is also hidden (it's behind the hidden service)
3. Latency may actually improve (no exit-to-clearnet hop)

The discovery is best-effort. If the relay info doesn't include an `onion_address`, or if the discovery request fails, the client silently continues using the clearnet URL through Tor.

---

## Privacy Summary Table

| What | Off | Tor | SOCKS5 | Tor + .onion |
|------|-----|-----|--------|-------------|
| API server sees your IP | Yes | No (exit node IP) | No (proxy IP) | No (hidden) |
| Torrent peers see your IP | Yes | Yes (not routed) | Configurable | Yes (not routed) |
| Exit node sees API traffic | N/A | Yes | N/A | No |
| ISP sees destination | Yes | No | Depends on proxy | No |
| ISP sees you use Tor | N/A | Yes | No | Yes |
| End-to-end encrypted to server | HTTPS | HTTPS over Tor | HTTPS over proxy | Onion encryption |

---

## For Server Operators: Setting Up a Tor Hidden Service

If you run a BoilerDeck server instance, you can expose it as a Tor hidden service so that clients using Tor mode get end-to-end onion routing with no exit node involved.

### Prerequisites

- A running BoilerDeck server (typically behind nginx on port 443)
- Tor installed on the server (`apt install tor` on Debian/Ubuntu)
- Root or sudo access

### Step 1: Install and Configure Tor

```bash
# Install Tor
sudo apt update && sudo apt install -y tor

# Edit Tor configuration
sudo nano /etc/tor/torrc
```

Add (or uncomment) the following lines:

```
HiddenServiceDir /var/lib/tor/boilerdeck/
HiddenServicePort 80 127.0.0.1:3000
```

This tells Tor to:
- Create a hidden service with keys stored in `/var/lib/tor/boilerdeck/`
- Forward incoming connections on the hidden service's port 80 to `127.0.0.1:3000` (the BoilerDeck API server)

If your server runs behind nginx and you want the hidden service to go through nginx (for rate limiting, etc.), point to nginx instead:

```
HiddenServicePort 80 127.0.0.1:80
```

### Step 2: Start Tor and Get Your .onion Address

```bash
sudo systemctl restart tor
sudo cat /var/lib/tor/boilerdeck/hostname
```

This prints your `.onion` address, e.g.: `abcdefghijklmnop1234567890abcdefghijklmnop1234567890abcdefgh.onion`

### Step 3: Configure BoilerDeck

Add the `.onion` address to your server's `.env` file:

```bash
ONION_ADDRESS=abcdefghijklmnop1234567890abcdefghijklmnop1234567890abcdefgh.onion
```

Then restart the BoilerDeck server:

```bash
sudo systemctl restart boilerdeck
```

### Step 4: Verify

Check that the relay info includes the onion address:

```bash
curl https://your-server.com/api/relay/info | jq .onion_address
```

You should see your `.onion` address in the response. Clients using Tor mode will automatically discover it and route API traffic through the onion network.

### Step 5 (Optional): Verify Hidden Service Accessibility

From a machine with Tor running:

```bash
curl --socks5-hostname 127.0.0.1:9050 http://YOUR_ONION_ADDRESS.onion/api/relay/info
```

You should get a valid relay info JSON response.

---

## Limitations and Known Gaps

1. **Torrent traffic is never routed through Tor.** Game downloads are multi-gigabyte and would be impractical over Tor. Your IP is visible to BitTorrent peers and trackers during downloads, regardless of privacy mode.

2. **WebSocket relay connections are not yet proxied.** The Nostr WebSocket connection (`wss://boilerdeck.com/relay`) currently bypasses the proxy. This is a known gap that may be addressed in a future phase.

3. **Tracker announcements reveal your IP.** Even with API traffic routed through Tor/SOCKS5, BitTorrent tracker announces include your IP. Use a VPN or custom SOCKS5 proxy for torrent traffic if tracker privacy is important to you.

4. **No bridge support.** The built-in Tor does not currently support bridges or pluggable transports. If Tor is blocked in your region, use a custom SOCKS5 proxy pointed at an external Tor instance with bridge support.

5. **DNS leaks in direct mode.** When privacy mode is "off", DNS queries for `boilerdeck.com` go through your system resolver. Tor and SOCKS5 modes perform DNS through the proxy (no local DNS leak).

6. **First-party data.** BoilerDeck stores your account data (email, purchase history, etc.) regardless of privacy mode. Privacy modes protect your network identity (IP address), not your account identity.
