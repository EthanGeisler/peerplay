# Tor Expert Bundle

This directory should contain the Tor Expert Bundle binaries for Windows.
These files are NOT committed to the repository (~15 MB).

## Setup

1. Download the Tor Expert Bundle from https://www.torproject.org/download/tor/
2. Extract and place the following files in this directory:
   - `tor.exe`
   - `libcrypto-3.dll` (or similar OpenSSL lib)
   - `libssl-3.dll`
   - `libwinpthread-1.dll`
   - `zlib1.dll`
   - `libgcc_s_seh-1.dll` (if present)
   - Any other DLLs bundled with the Expert Bundle

The electron-builder config will copy these into `resources/tor/` inside the
packaged app. At runtime, `torManager.ts` spawns `tor.exe` from
`process.resourcesPath/tor/tor.exe`.

## In development

Place the same files here. The dev fallback path in `torManager.ts` looks for
`<appPath>/resources/tor/tor.exe`.
