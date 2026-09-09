# Private Bazarr setup

The Bazarr adapter runs only in the private Fastify API. The family portal, GitHub Pages, and Supabase never receive the Bazarr URL or API key, Radarr movie IDs, media paths, provider URLs, or opaque subtitle cache tokens.

## 1. Check Bazarr first

Before connecting Media Concierge:

1. In Bazarr, open **Settings → Radarr**, enable Radarr, test the connection, and save it.
2. Make sure Bazarr can see the same movie files as Radarr. Containers should normally mount the movie library at the same path; otherwise configure Bazarr's Radarr path mapping.
3. Create or select the desired language profile for movies and enable at least one subtitle provider.
4. Assign that language profile to the movie used for the test. Manual search only returns languages and providers enabled by Bazarr.
5. If you want Media Concierge to preserve full manual control, disable or defer automatic subtitle searching after Radarr import.

## 2. Add the private connection

Find the key under **Settings → General → Security → API Key**. Store it only in the ignored `.env.local` file:

```dotenv
BAZARR_URL=http://bazarr:6767
BAZARR_API_KEY=
```

`http://bazarr:6767` is appropriate when the API and Bazarr share a Docker network and the Bazarr service is named `bazarr`. During development from another computer, use a private LAN or Tailscale URL that the computer can reach. Include Bazarr's URL base in `BAZARR_URL` when one is configured. Do not expose Bazarr publicly and never paste the key into chat, GitHub, Supabase, frontend variables, or screenshots.

Restart `npm run dev`, then open the private admin page at `/salud`. Bazarr should show its version, API-key authentication, **Manual obligatoria**, and **LISTO**.

## 3. Read-only synchronization check

Use a movie that Radarr has already imported. Media Concierge should enter **Esperando a Bazarr** and automatically advance after Bazarr recognizes the exact Radarr movie ID. This check never moves or changes media files.

If it remains waiting:

- confirm the movie appears in Bazarr's Movies screen;
- test Bazarr's Radarr connection;
- verify both containers see the movie at the same path or correct the path mapping;
- confirm the movie has a language profile.

## 4. Controlled subtitle check

Open the subtitle selector and confirm each candidate shows language, provider, score, release, matches, mismatches, hearing-impaired/forced flags, and uploader. Choosing **Seleccionar** asks Bazarr to download only that result. Media Concierge then queries Bazarr again and advances only after the subtitle is indexed as saved.

Use **Buscar otro subtítulo** to run a fresh manual search and replace the selection. Bazarr may overwrite or keep an existing subtitle according to its own language-profile and subtitle settings.

## Official references

- [Bazarr settings and API-key location](https://wiki.bazarr.media/Additional-Configuration/Settings/)
- [Bazarr setup guide for Radarr, path mappings, languages, and providers](https://wiki.bazarr.media/Getting-Started/Setup-Guide/)
- [Bazarr manual movie subtitle API source](https://github.com/morpheus65535/bazarr/blob/master/bazarr/api/providers/providers_movies.py)
