# Private Radarr setup

The Radarr adapter is opt-in. With either `RADARR_URL` or `RADARR_API_KEY` missing, Media Concierge keeps using its deterministic mock and makes no Radarr network calls.

## 1. Create a Radarr API key

In Radarr, open **Settings → General → Security** and copy the API key. Treat it as a private homelab secret.

Never paste this key into chat, GitHub, Supabase, a `VITE_` variable, or either browser application. Store it only in the private API environment. Rotate it in Radarr if it is ever exposed.

## 2. Add the connection pair

In the ignored local `.env.local` file used by the API, add:

```dotenv
RADARR_URL=http://radarr:7878
RADARR_API_KEY=replace-locally
```

`http://radarr:7878` is appropriate when Media Concierge and Radarr share a Docker network and the Radarr service is named `radarr`. While developing on another computer, use a private LAN or Tailscale URL that computer can actually reach. Do not expose Radarr publicly just to make this connection work.

Restart `npm run dev`, then open the private admin page at `/salud`. The Radarr card lists the available quality profile IDs and root-folder paths. This discovery step is read-only.

## 3. Select the destination

Copy one displayed profile ID and one exact root-folder path into `.env.local`:

```dotenv
RADARR_QUALITY_PROFILE_ID=4
RADARR_ROOT_FOLDER_PATH=/movies
RADARR_TAG_IDS=
```

`RADARR_TAG_IDS` is optional and accepts comma-separated numeric Radarr tag IDs. Restart the API again. The Radarr card should now show **Listo para altas manuales**. If it reports an inaccessible root, fix Radarr's mount/permissions instead of choosing a guessed path.

## 4. Validate in two explicit steps

1. **Read-only check:** inspect version, health, profiles, roots, an existing movie lookup, and the queue. This changes nothing.
2. **Write check:** after a separate explicit authorization, approve one test movie, inspect interactive results, and manually choose one release.

Approval may add the movie to Radarr, but Media Concierge sends `searchForMovie: false`. It will not start a download until the administrator opens the results and selects one candidate. If the movie already has a file, the duplicate download is skipped.

Back up Radarr's configuration before the first write check. Automated tests use a fake Radarr transport and never delete or mutate homelab data.

## Current Phase 4 boundary

Media Concierge reads download/import state through Radarr's queue. Detailed qBittorrent telemetry and controls are Phase 5; real Bazarr subtitle selection and Jellyfin verification arrive in Phases 6 and 7. Until those adapters land, the flow continues with the existing safe simulations after Radarr reports the import.
