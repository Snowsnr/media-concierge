# Security model

## Invariants

- The public side cannot reach the homelab and cannot authorize downloads.
- Homelab synchronization is outbound-only.
- Administrator approval and release selection are separate explicit decisions.
- No internal hostname, address, torrent name, indexer, path, or service credential enters the public broker.
- Destructive operations require a clear confirmation and will be coordinated through Radarr/Sonarr, not qBittorrent alone.
- Jellyfin is queried or asked to scan; it is never stopped or restarted.

## Secrets

`.env` and all `.env.*` files except `.env.example` are ignored. Public builds may receive only public configuration. Supabase service-role, VAPID private, and internal service keys belong only in server environments. Logs must redact authorization headers, API keys, cookies, invitation tokens, and signed URLs.

## Invitations and public data

Invitation tokens are generated with 256 bits of cryptographic randomness and stored only as SHA-256 hashes. Because the source tokens have high entropy, offline guessing is impractical without storing the plaintext. Redemption is one-time, expiring, revocable, rate-limited, and exchanged for an anonymous Supabase Auth session tied to one family profile. Tokens use a URL fragment and are removed from browser history after redemption.

Supabase Row Level Security binds every read to the authenticated family identity, while column grants hide bridge timestamps, internal identifiers, and version fields. Family roles cannot insert, update, or delete broker rows directly; a rate-limited Edge Function validates the request, reloads canonical metadata from TMDB, and writes with the service role. Adult search is rejected, result counts are constrained, and user-supplied internal URLs are not accepted. The service-role key never reaches a browser.

## Web safety

All inputs are parsed through shared schemas. React escapes release names by default. Future adapters must use allowlisted base URLs from server configuration; Media Concierge will not provide a generic proxy. State-changing admin routes will gain Tailscale identity enforcement plus CSRF/origin protections before deployment.

## Development safety

ARR, torrent, subtitle, media-server, and push adapters are mocks and perform no network calls. The optional Supabase broker is the only real adapter and is disabled unless both private variables are supplied. The repository contains no credentials. Real integration tests must be opt-in, clearly named, and require explicit administrator authorization. They must never delete production data as part of an automated suite.

## Threat review before Phase 4

Phase 2 addresses invitation replay, basic brute force, direct broker writes, cross-family reads, duplicated broker deliveries, private-state leakage, and inbound homelab exposure. Before connecting ARR services, review session theft, broker-token rotation, SSRF, malicious release strings, log leakage, Tailscale identity enforcement, CSRF, push subscription abuse, and least-privilege network policy.
