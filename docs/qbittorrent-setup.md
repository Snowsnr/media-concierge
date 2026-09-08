# Private qBittorrent setup

The qBittorrent adapter is opt-in and runs only in the private Fastify API. The family portal, GitHub Pages, and Supabase never receive its URL, API key, username, password, torrent hashes, tracker URLs, or release names.

## 1. Choose authentication

### qBittorrent 5.2 or newer — recommended

Open **Tools/Preferences → Web UI → API Key**, generate a key, and store it only in the ignored `.env.local` file:

```dotenv
QBITTORRENT_URL=http://qbittorrent:8080
QBITTORRENT_API_KEY=replace-locally
QBITTORRENT_USERNAME=
QBITTORRENT_PASSWORD=
```

API-key authentication requires qBittorrent 5.2+ or WebAPI 2.14.1+. Media Concierge sends it as a Bearer credential and never places it in a URL.

### Older qBittorrent — compatibility mode

Leave `QBITTORRENT_API_KEY` empty and use the existing Web UI login:

```dotenv
QBITTORRENT_URL=http://qbittorrent:8080
QBITTORRENT_API_KEY=
QBITTORRENT_USERNAME=replace-locally
QBITTORRENT_PASSWORD=replace-locally
```

Media Concierge creates and renews the private WebAPI session cookie. Never paste any of these credentials into chat, GitHub, Supabase, `VITE_` variables, or screenshots.

`http://qbittorrent:8080` is appropriate when both services share a Docker network and the qBittorrent service is named `qbittorrent`. During development from another computer, use a private LAN or Tailscale URL that the computer can reach. Do not expose the Web UI publicly.

## 2. Read-only validation

Restart `npm run dev`, then open the private admin page at `/salud`. The qBittorrent card should show its application version, WebAPI version, authentication mode, and **LISTO**.

If qBittorrent rejects the Host or Origin, add only the private hostname used in `QBITTORRENT_URL` to qBittorrent's Web UI server-domain allowlist. Do not disable CSRF, clickjacking, or host-header protections globally.

The first authorized read-only test queries one known torrent hash and displays:

- progress, downloaded and remaining bytes;
- speed and ETA;
- connected/total seeds and peers;
- availability and ratio;
- normalized state and sanitized tracker status.

Tracker paths and query strings are not returned to the admin because private tracker URLs can contain passkeys.

## 3. Controlled write validation

Use a disposable active download and validate one action at a time: pause, resume, and reannounce. Destructive scenarios require a separate explicit confirmation.

Media Concierge never deletes a managed torrent directly through qBittorrent. To abandon, blocklist, or delete a release, it first removes the corresponding queue entry through Radarr. Preserving partial data pauses qBittorrent and removes only Radarr's management entry; deleting partial data asks Radarr to remove the download from its client.

If Radarr no longer owns the queue entry, Media Concierge refuses the destructive action instead of guessing.

## References

- [Official qBittorrent WebUI API 5.0+](<https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)>)
- [Official API-key authentication documentation](<https://github.com/qbittorrent/qBittorrent/wiki/API-Key-Authentication-(%E2%89%A5v5.2.0)>)
