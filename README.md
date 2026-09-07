# Media Concierge

Media Concierge coordinates family movie and series requests with a private homelab while keeping the administrator in control. The public portal can only create requests; it can never start a download or reach private services.

This repository contains **Phases 0–3**. The complete simulated workflow still works without credentials, while the public portal, broker, accounts, and notifications can be activated with Supabase and TMDB configuration. Radarr, Sonarr, qBittorrent, Bazarr, and Jellyfin remain simulated.

## What works now

- Mobile-first Spanish family portal with mock bilingual search and request history.
- Private admin panel with approval, clarification, rejection, release scoring, simulated download controls, subtitle choice, Jellyfin verification, and audit timeline.
- Series season packs, multi-episode releases, unaired episodes, and manual subtitle readiness per episode.
- Failure laboratory for stalled/error downloads, delayed imports, missing subtitles, and delayed Jellyfin visibility.
- Coordinated pause, resume, reannounce, release replacement, and confirmed cancellation simulations.
- Fastify API backed by local SQLite and deterministic mock adapters.
- Strict shared contracts and a guarded, tested state machine.
- Installable family and admin PWAs with Web Push, device subscription lifecycle, test notices, and in-app history.
- Supabase schema with Row Level Security, revocable one-time invitations, permanent family credentials, and isolated family data.
- Server-validated TMDB search and request creation through rate-limited Edge Functions.
- Outbound-only, idempotent Supabase-to-homelab broker synchronization.
- Invitation, family-account, and password-reset management in the private admin panel.
- Admin alerts for new requests and family alerts for approval, clarification, ready, rejection, and failure—never every progress update.
- GitHub Pages workflow for publishing only the family portal at `pedidos.diegohomelab.fyi`.
- Development Docker Compose file and architecture/security/roadmap documentation.

The mock deliberately requires an administrator click to select a release. Low-scoring and rejected releases remain visible with explanations.

## Requirements

- Node.js 22 or newer (Node 22 is the deployment target)
- npm 10 or newer

## Run locally

```bash
npm install
npm run dev
```

Open:

- Family portal: <http://localhost:5173>
- Admin panel: <http://localhost:5174>
- API health: <http://localhost:4100/health>

The first API start creates `data/media-concierge.db` and seeds one demo request. Use **Restablecer demo** in the admin header to return to that state.

## Quality checks

```bash
npm run test
npx supabase test db
npm run test:supabase
npm run test:e2e
npm run typecheck
npm run lint
npm run format:check
npm run build
```

The browser suite runs the portal, movie workflow, series workflow, failure recovery, and invitation management in desktop and mobile Chromium. The Supabase suites require the local stack and Edge Functions to be running; see [docs/supabase-setup.md](docs/supabase-setup.md). Install the browser once with `npx playwright install chromium`.

## Docker development

```bash
docker compose -f infrastructure/docker/compose.dev.yml up
```

This is a development composition with live-mounted source, not a production deployment. No ports or private services are exposed beyond the three local development ports.

## Repository map

```text
apps/portal                 public family PWA
apps/admin                  private administrator UI
services/concierge-api      local API, state orchestration, SQLite
packages/shared             contracts, schemas, state machine
packages/ui                 small shared React components
packages/integrations       interfaces and mock adapters
supabase/                   Phase 2–3 schema and Edge Functions
infrastructure/docker/      local development composition
docs/                       architecture, security, roadmap
```

Copy `.env.example` to `.env` only if you need to change local ports. Never commit `.env` files. To activate Phases 2–3, follow [docs/supabase-setup.md](docs/supabase-setup.md). See also [docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md), and [docs/roadmap.md](docs/roadmap.md).
