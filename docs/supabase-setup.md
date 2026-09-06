# Phase 2 setup: Supabase, TMDB, and GitHub Pages

Phase 2 is implemented but remains disabled until configuration is supplied. Without the variables below, `npm run dev` continues to use the safe local mocks.

## 1. Create the Supabase project

Install the Supabase CLI, authenticate, and link this repository to the intended project. Then apply the migration:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

In Supabase Authentication settings, keep anonymous sign-ins enabled temporarily so existing invited sessions can be converted without losing their request history. New invitations create permanent username/password accounts directly; anonymous users cannot access application data unless a valid `family_members` row already exists.

## 2. Configure Edge Function secrets

Generate the bridge token locally with a cryptographically secure password generator. Use the same value on Supabase and the private homelab API.

```bash
supabase secrets set TMDB_API_READ_TOKEN=YOUR_TMDB_READ_TOKEN
supabase secrets set HOMELAB_BRIDGE_TOKEN=YOUR_LONG_RANDOM_BRIDGE_TOKEN
supabase secrets set PUBLIC_PORTAL_ORIGIN=https://pedidos.diegohomelab.fyi
```

Deploy the six functions:

```bash
supabase functions deploy redeem-invite
supabase functions deploy account-access --no-verify-jwt
supabase functions deploy tmdb-search
supabase functions deploy create-request
supabase functions deploy invitations --no-verify-jwt
supabase functions deploy bridge-sync --no-verify-jwt
```

Never place the TMDB token, service-role key, or bridge token in `VITE_*` variables.

## 3. Configure the private homelab process

Set these only in the private container environment:

```text
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_BRIDGE_TOKEN=YOUR_LONG_RANDOM_BRIDGE_TOKEN
BROKER_POLL_INTERVAL_MS=15000
```

The concierge API then polls `bridge-sync` outbound. Supabase never initiates a connection to the homelab. Repeated pulls are deduplicated by the public request UUID before any future ARR action can occur.

## 4. Configure GitHub Pages

Create these **repository variables** (not secrets) because the Supabase URL and anon key are public client configuration protected by RLS:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

Enable GitHub Pages with **GitHub Actions** as its source. The included workflow builds only the family portal and publishes the `CNAME` for `pedidos.diegohomelab.fyi`.

## 5. DNS

Point `pedidos.diegohomelab.fyi` to GitHub Pages using the DNS records GitHub documents for the repository. Cloudflare remains DNS-only for this architecture; do not create a Tunnel.

## 6. Create the first invitation

Once the homelab API has its bridge token, open the private admin panel and use **Invitaciones**. The returned token appears in the URL fragment (`#invite=...`), is shown only once, and is stored in Supabase only as a SHA-256 hash. Opening the link lets the family member choose a username and password; submitting the form creates a confirmed account and atomically redeems the invitation.

Existing anonymous family sessions are prompted to choose credentials. The conversion updates the same Supabase Auth user, preserving the member row and every existing request. Afterwards, the private admin panel lists family accounts and can set a replacement password without learning or displaying the previous one.

## Verification checklist

- An uninvited user cannot create a family account or read profiles, requests, or history.
- A redeemed invitation cannot be used to create a second account.
- An existing anonymous member can convert its account without changing its user ID.
- Family A cannot read Family B requests.
- A revoked member immediately loses RLS access.
- Invitation redemption, TMDB search, and request creation rate-limit callers.
- Browser bundles contain no private tokens.
- The homelab makes only outbound HTTPS calls.
- A duplicated broker delivery creates one local request.

## Local verification

Docker can validate the migration and security policies before touching a hosted project:

```bash
npx supabase start
npx supabase db lint --local --level warning
npx supabase test db
```

To run the HTTP integration suite, create an ignored local Edge environment whose `HOMELAB_BRIDGE_TOKEN` is `local-bridge-test-token-256-bits-not-production`, serve the functions in one terminal, and run the test in another:

```bash
npx supabase functions serve --env-file /path/to/local-functions.env
npm run test:supabase
```

The HTTP suite verifies invitation redemption/replay/revocation, RLS isolation, column permissions, bridge authentication, status publication, the real Fastify broker adapter, and the private invitation proxy. A successful TMDB search/request smoke test requires the real `TMDB_API_READ_TOKEN` and should be performed only after setting that secret in the hosted project.
