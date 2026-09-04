# Architecture

## Trust boundaries

Media Concierge has three zones:

1. **Public family portal** — a static PWA. It displays public metadata and a family's own simplified request history.
2. **Public request broker** — Supabase database and Edge Functions. It validates invitations, brokers TMDB searches and request creation, and stores only public-safe state.
3. **Private concierge** — this repository's admin panel and API. It runs inside Tailscale, polls the public broker using outbound connections, and is the only zone that will eventually hold homelab credentials.

The mandatory control path is `family → portal → pending broker row → outbound homelab sync → administrator approval → ARR adapter`. A public request is data, never authorization to download.

## Local and Phase 2 topology

Without Phase 2 variables, three local processes run in mock mode. Both React applications call the Fastify API, which stores requests and history in SQLite and calls deterministic adapters from `packages/integrations`.

With Phase 2 variables, the family portal uses Supabase Auth, RLS-protected reads, and five Edge Functions. Search and creation are validated server-side; the browser never receives the TMDB token or a privileged Supabase key. The private Fastify API polls Supabase over outbound HTTPS, deduplicates each public UUID in SQLite, and publishes sanitized state back to the family's row. Supabase cannot initiate a connection to the homelab.

The state machine lives in `packages/shared`, separate from transport and adapters. Every transition is validated and appended to an audit history. Request creation accepts an idempotency key, enforced by a unique SQLite index. Series add a persisted episode matrix; several episodes may reference the same simulated season-pack download group while retaining individual subtitle and readiness state.

## Adapter boundary

The integrations package defines these replaceable interfaces:

- `MetadataProvider`
- `PublicRequestBroker`
- `RadarrClient`
- `SonarrClient`
- `TorrentClient`
- `SubtitleClient`
- `MediaServerClient`
- `PushNotificationProvider`

The Supabase broker adapter already uses bounded timeouts and limited retries with backoff. Future ARR adapters must also add runtime response validation, health checks, and secret redaction. Orchestration depends on interfaces rather than direct HTTP clients.

## Persistence and recovery

SQLite is the intended local database. The mock API already persists requests, progress, episode matrices, selected releases/subtitles, injected scenarios, and append-only state history. On restart, it resumes from the last saved state. Later workers will claim jobs with durable leases and idempotency keys so repeated broker events cannot create duplicate downloads.

## Deployment intent

The family portal is intended for GitHub Pages at `pedidos.diegohomelab.fyi`. The private admin/API will join the existing Docker network and be reachable at `concierge.diegohomelab.fyi` only through Tailscale and Traefik. Service-to-service calls will use Docker DNS names. No router port, Cloudflare Tunnel, or inbound homelab connection is part of the design.
