# Roadmap

## Phase 0 — foundation (complete)

- npm/TypeScript monorepo, strict contracts, formatting, linting, tests.
- React portal and admin applications.
- Fastify/SQLite API and replaceable mock adapters.
- Architecture, security, development Docker composition.

## Phase 1 — fully simulated prototype (complete)

The complete mock path is navigable: search → request → approve → inspect scored releases → manually select → simulate download/import → select subtitles → verify ready. Movies and series include desktop/mobile browser tests. Series model season packs, episode groups, unaired episodes, and per-episode subtitle readiness. A failure laboratory covers stalled and failed downloads, pause/resume/reannounce, delayed imports, missing subtitles, delayed Jellyfin visibility, safe release replacement, and confirmed cancellation variants.

No real service credentials are required by Phase 1.

## Phase 2 — public search and broker (deployed)

Supabase migrations, Row Level Security, one-time account invitations, revocation, username/password family access, bilingual TMDB search, server-validated request creation, rate limiting, and idempotent outbound polling are implemented. Existing anonymous family sessions can be upgraded in place without losing requests. The private admin can create and revoke invitations, list family accounts, and reset passwords. GitHub Pages publishes only the family portal; the administration surface and outbound broker stay in the homelab. No ARR control exists yet.

## Phase 3 — notifications

Complete installability, VAPID subscription lifecycle, admin alerts, meaningful family notifications, and in-app fallback. Do not notify for every progress update.

## Phases 4–7 — movie workflow

Introduce real adapters in order: Radarr, qBittorrent observability and coordinated cancellation, manual Bazarr subtitle choice, then Jellyfin availability verification. Each adapter lands behind contract tests and mock parity before an explicitly authorized homelab smoke test.

## Phase 8 — series

Add Sonarr scope editing, aired-season and episode requests, season packs, multi-episode mappings, per-episode state, manual Bazarr work, and partial readiness.

## Phase 9 — improvements

Configurable scoring, high-confidence subtitle assistance, future-episode monitoring, mountpoint guards, preference analytics, and prepared WhatsApp messages.

## Definition of safe production readiness

Production requires Tailscale/Traefik access enforcement, RLS tests, backup/restore exercises, durable workers, observability with redaction, threat review, and a rollback plan. Mock completeness alone is not production readiness.
