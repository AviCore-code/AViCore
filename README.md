# AviCore

Monorepo for the AviCore platform, restored from a Google Drive backup by Jarvis.

## Structure

- `admin/` — AviCore Admin web app (React source + config + PWA assets)
- `crew/` — AviCore Crew web app (PWA assets; source pending — only public assets were recovered from the backup)
- `shared/` — Shared backend pieces used by both apps:
  - `shared/sql/` — SQL migrations / schema scripts
  - `shared/supabase/` — Supabase Edge Functions + migrations
  - `shared/docs/` — Project documentation (fatigue monitor, weekly schedule rules, etc.)
- `avicore-landing.html`, `index.html` — original marketing/landing pages (pre-existing)

## Notes

- Imported from the AviCore Google Drive backup folder on 2026-09-13.
- `node_modules`, `.git`, `dist*`, `build`, and other build artifacts were
  intentionally excluded — only source and config files were imported.
- No real secrets (`.env`, API keys, service role keys) are committed here.
  Set up your own `.env` locally using `.env.example` as a reference.
