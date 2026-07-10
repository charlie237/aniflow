# Aniflow

Aniflow is a local Mikan RSS anime release tracker for OpenList download flows.

It polls Mikan RSS feeds, parses release metadata like subtitle group,
resolution, subtitle language, source and codec, applies subscription rules, and
submits matching torrent or magnet URLs to OpenList 115 offline download.
Finished files are scanned and organized through OpenList filesystem APIs, then
renamed into a Plex/Jellyfin style library path.

## Stack

- Next.js App Router, TypeScript, Tailwind CSS
- shadcn/ui-style local components
- SQLite via `better-sqlite3` + Drizzle ORM (`src/lib/db/schema.ts`)
- RSS XML parsing via `fast-xml-parser`
- OpenList 115 offline download through `/api/fs/add_offline_download`
- OpenList `/api/fs/list`, `/api/fs/rename`, `/api/fs/move` for organization

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Open <http://localhost:3000>.

For the worker:

```bash
npm run worker
```

### Access control (optional)

Set `AUTH_PASSWORD` in `.env` to require login for the web UI and APIs. When it
is empty, only loopback hosts such as `localhost` and `127.0.0.1` are accepted.
LAN, reverse-proxy, and public access require a password.

```bash
AUTH_PASSWORD=your-strong-password
# optional custom session signing secret
AUTH_SECRET=
```

- Browser: password form at `/login`, session cookie lasts 7 days
- API clients: `Authorization: Bearer <AUTH_PASSWORD>` or HTTP Basic
  (`any-username:AUTH_PASSWORD`)
- The dedicated worker process does not use this password; protect the host
  network / reverse proxy if exposed

## Required OpenList Settings

Open the **后台设置** page in the app and fill in OpenList API, 115 access
method, proxy settings, naming templates, TMDB, and worker interval settings
there. Runtime integration settings are stored in SQLite, not in `.env`.

The download directory setting is the **global incoming root**, for example
`/115/Anime/_incoming`. New subscriptions default to a **per-subscription
subdir** under that root (`/115/Anime/_incoming/{subscription name}`) so
offline jobs from different shows do not share one folder. It is an OpenList
remote path under a mounted 115 storage, not a local filesystem path and not
WebDAV. The app submits RSS torrent or magnet URLs to
`/api/fs/add_offline_download` with the subscription path, then uses OpenList
fs APIs to scan, rename, create target directories, and move completed files.

`115 Cloud` and `115 Open` are different OpenList offline backends. Choose the
one that matches the driver mounted at `/115`. Clicking the 115 check button
syncs the download directory to OpenList's matching backend configuration
before reading the ready tool list.

RSS fetching only uses the proxy configured in **后台设置** when the proxy switch
is enabled. The proxy field defaults to `http://127.0.0.1:7890`, but it is not
used unless enabled.

## Subscription Flow

Use the **订阅** page to parse an HTTPS `mikanani.me/RSS/` URL first. Other RSS
providers and torrent download hosts are rejected by the server. After parsing, create a
subscription by selecting the detected title, subtitle group, resolution, and
subtitle language from dropdowns. Selected group/resolution/language values are
saved as allow rules for that subscription.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

The compose file starts separate `web` and `worker` services that share
`./data/aniflow.sqlite`. The web port binds to `127.0.0.1` by default. Keep it
that way when running without `AUTH_PASSWORD`; use an authenticated reverse
proxy or explicitly change the port binding when remote access is required.

## Naming

Final media filenames do not include release tags. Tags are retained in SQLite
and displayed in the episode management UI.

Recommended path shape:

```text
Download directory: /115/Anime/_incoming
Media library root: /115/Anime
Season path template:   {title}/Season {season_pad}
File name template:     {title} - S{season_pad}E{episode_pad}.{ext}
```

Default final path:

```text
/115/Anime/Show Name/Season 01/Show Name - S01E01.mkv
```

The default templates are:

```text
Season path: {title}/Season {season_pad}
File name:   {title} - S{season_pad}E{episode_pad}.{ext}
```

Available variables are `{title}`, `{season}`, `{season_pad}`, `{episode}`,
`{episode_pad}`, and `{ext}`.

## Notes

- TMDB is optional and only intended for display enrichment.
- Items without a parsed episode number are held for manual handling.
- Rules can allow/block subtitle groups, resolutions, subtitle languages, and
  include/exclude keywords.
