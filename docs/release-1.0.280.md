# Release 1.0.280 — 2026-09-18

Admin and Crew share version 1.0.280, based on the latest v1.0.279 navigation release.

- Company-scoped database writes and settings conflict key.
- Blank roster imports clear existing cells; queued imports are reported accurately.
- Correct backup restore conflict keys and Windows test paths.
- Revalidate the PWA service worker for application updates.

Validation: 164 tests passed across 23 files; Admin and Crew production builds passed. Public anonymous credentials and company uoa verified; no private keys detected in build output.

Firebase project: uoa-ftl-monitor. Hosting sites: avicore-admin and avicore-crew. No database migration.

Rollback: restore each site's previous Firebase Hosting release if login or data loading regresses. Previous live versions: Admin 1.0.279 and Crew 1.0.263.
