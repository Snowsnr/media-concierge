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

## Phase 3 — notifications (deployed)

Installability, VAPID subscription lifecycle, admin alerts, meaningful family notifications, durable delivery retries, and an in-app fallback are implemented. Family devices receive approval, clarification, ready, rejection, and failure events; admin devices receive new-request alerts. Intermediate progress does not create notification spam.

## Phase 4 — Radarr movie workflow (complete)

The private API supports Radarr v3 health and configuration discovery, TMDB duplicate detection, safe movie creation with automatic search disabled, score-sorted interactive release results, explicit manual grab, and queue/import observation. Runtime response validation, bounded timeouts, redacted errors, contract tests, mock parity, and an explicitly authorized end-to-end homelab test are complete.

## Phase 5 — qBittorrent (complete)

The private API supports qBittorrent API-key and legacy session authentication, exact hash correlation, persisted progress/size/speed/ETA/seeds/peers/availability/ratio telemetry, sanitized tracker health, stalled/error detection, pause/resume/reannounce controls, and Radarr-coordinated cancellation with optional blocklisting and partial-data handling. Read-only telemetry, persistence across API restarts, pause/resume/reannounce, completed-download import tracking, and an explicitly authorized release-removal/blocklist recovery were validated end to end against the homelab.

## Phase 6 — Bazarr movies (adapter ready; homelab validation pending)

The private API now waits for Bazarr to recognize an imported Radarr movie, performs a real manual provider search, exposes sanitized score-sorted candidates, downloads only the administrator's explicit choice, confirms the saved subtitle, and permits a replacement search. The adapter uses header-only API-key authentication, bounded requests, runtime response validation, opaque cache-token protection, contract tests, and mock parity. Phase 6 closes after an explicitly authorized homelab check.

## Phase 7 — Jellyfin

Introduce real availability verification and a safe library refresh request when necessary. The adapter must land behind contract tests and mock parity before an explicitly authorized homelab smoke test; Media Concierge will never restart Jellyfin.

## Phase 8 — series

Add Sonarr scope editing, aired-season and episode requests, season packs, multi-episode mappings, per-episode state, manual Bazarr work, and partial readiness.

## Phase 9 — improvements

Configurable scoring, high-confidence subtitle assistance, future-episode monitoring, mountpoint guards, preference analytics, and prepared WhatsApp messages.

## Definition of safe production readiness

Production requires Tailscale/Traefik access enforcement, RLS tests, backup/restore exercises, durable workers, observability with redaction, threat review, and a rollback plan. Mock completeness alone is not production readiness.
