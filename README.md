# AviCore

Monorepo for the AviCore platform, restored from a Google Drive backup by Jarvis.

## Important: Admin and Crew share one codebase

AviCore Admin (desktop/web) and AviCore Crew (mobile) are **not two separate
apps** — they are two entry points into the same React source tree
(`src/`). Confirmed directly from a source comment in
`src/mobile/MobileApp.jsx`:

> "Android Crew app shell - only the four Pilot/Flight Crew pages from the
> PC app, reused completely untouched (they already talk to
> desktopDatabase.js, which auto-routes to the mobile SQLite+sync layer)."

So `MobileApp.jsx` (the Crew entry point) imports the exact same modules
Admin uses — `MyStatus`, `DutyEntry`, `MyLogbook`, `MyExperience` — directly
from `src/modules/...`, with **zero duplication**. Admin-only pages
(Dashboard, PilotRoster, FlightCrews, Settings, etc.) simply aren't
referenced by the mobile entry point, so they don't ship in a Crew build.

## Structure

- `src/` — the single shared React source tree used by BOTH the Admin
  build and the Crew (mobile) build.
  - `src/mobile/MobileApp.jsx` + `src/mobile/PilotLogin.jsx` — the Crew
    entry point / shell (mobile-only pages + pairing/login).
  - Everything else under `src/modules/`, `src/components/`, `src/hooks/`,
    `src/config/`, `src/lib/` is shared by both builds.
- `public-admin/` — PWA icons/background used when building the Admin app
- `public-web/` — PWA icons/background used when building the Crew app
- `app-config.json` — shared runtime config
- `shared/` — backend pieces used by both apps:
  - `shared/sql/` — SQL migrations / schema scripts
  - `shared/supabase/` — Supabase Edge Functions + migrations
  - `shared/docs/` — Project documentation (fatigue monitor, weekly schedule rules, etc.)
- `avicore-landing.html`, `index.html` — original marketing/landing pages (pre-existing)

## Building the two variants

This repo currently has the shared `src/` but the original build tooling
(`package.json`, `vite.config.js`, per-app HTML entry points) was not
recoverable from the Drive backup (Google Drive rate-limited that folder
during import). To restore builds:

1. Recreate a Vite (or equivalent) project pointing at `src/`.
2. Admin build: entry renders the full app (Dashboard, PilotRoster, etc.),
   uses `public-admin/` as the public dir.
3. Crew build: entry renders `src/mobile/MobileApp.jsx` only, uses
   `public-web/` as the public dir.

## Notes

- Imported from the AviCore Google Drive backup folder on 2026-09-13.
- `node_modules`, `.git`, `dist*`, `build`, and other build artifacts were
  intentionally excluded — only source and config files were imported.
- No real secrets (`.env`, API keys, service role keys) are committed here.
  Set up your own `.env` locally using `.env.example` as a reference.
