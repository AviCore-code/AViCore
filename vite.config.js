import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';

// Three build targets share this one Vite project:
//   - PC/Electron (default mode): index.html -> src/main.jsx -> dist/
//   - Android Crew app (`--mode mobile`): index-mobile.html ->
//     src/main-mobile.jsx -> dist-mobile/, which capacitor.config.json's
//     webDir points at.
//   - Plain browser web app (`--mode web`): index-web.html ->
//     src/main-web.jsx -> dist-web/, a static site deployable anywhere
//     (Netlify/Vercel/Cloudflare Pages/a public Supabase Storage bucket).
// Kept as one project (not a separate repo) so the four Pilot/Flight Crew
// page components stay literally the same files across all three builds -
// see src/services/desktopDatabase.js for how they transparently reach the
// mobile SQLite+sync layer on Android, or webDatabase.js's direct Supabase
// calls on the web build, instead of the Electron IPC bridge.
// Read once at config-load time so every build target can stamp itself with
// the same version number already used for PC releases (see release.ps1,
// which bumps this field before each release build) - one source of truth,
// no separate web-only version counter to remember to update.
const pkgVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')).version;

export default defineConfig(({ mode }) => {
  const isMobile = mode === 'mobile';
  const isWeb = mode === 'web';
  // Enterprise Web admin (read-only monitoring) - its own static build,
  // separate URL/host from the Crew web app, so neither touches the other.
  const isAdmin = mode === 'admin';
  const outDir = isMobile ? 'dist-mobile' : isWeb ? 'dist-web' : isAdmin ? 'dist-admin' : 'dist';
  const sourceHtml = isMobile ? 'index-mobile.html' : isWeb ? 'index-web.html' : isAdmin ? 'index-admin.html' : 'index.html';
  // Crew web and Admin web each need their own PWA icons (different app,
  // different install identity on the user's device) - keep them in
  // separate folders (public-web/, public-admin/) instead of the shared
  // public/ used by the PC/Android builds, so Vite only copies the icon
  // set that belongs to the app actually being built.
  const publicDir = isWeb ? 'public-web' : isAdmin ? 'public-admin' : 'public';

  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkgVersion)
    },
    plugins: [
      react(),
      // Capacitor (mobile) and static web hosts (web) both expect the
      // built entry file to be literally <outDir>/index.html. Vite's HTML
      // plugin names the emitted file after the SOURCE file
      // (index-mobile.html / index-web.html), not the rollupOptions.input
      // key below ("index" only affects JS/CSS chunk naming) - and the
      // source file can't be named index.html at the project root since
      // the PC build's own index.html already lives there. So rename the
      // output file after the fact instead of renaming the source.
      (isMobile || isWeb || isAdmin) && {
        name: 'rename-index-html',
        closeBundle() {
          const from = path.resolve(__dirname, outDir, sourceHtml);
          const to = path.resolve(__dirname, outDir, 'index.html');
          if (fs.existsSync(from)) fs.renameSync(from, to);
        }
      },
      // PWA support: only for the two plain-browser static builds (Crew
      // web + Enterprise Admin web) - NOT the PC/Electron build (which is
      // already an installed desktop app) and NOT the Android/Capacitor
      // mobile build (already an installed native app, its own manifest
      // lives in android/). Each gets its own manifest/icon/scope so the
      // two "installed" web apps are never confused with each other on a
      // user's device.
      //
      // Deliberately uses the default `generateSW` strategy with NO
      // runtime caching of Supabase/Firebase API calls - Capt. Weera
      // asked for "warn when there's no internet" (see OfflineBanner),
      // not full offline data access, since duty/roster data must always
      // be the live, authoritative copy. The service worker here only
      // caches the built app shell (JS/CSS/HTML/icons) so the app *opens*
      // instantly and looks installed, but every real data read still
      // goes straight to the network and fails/warns honestly when
      // offline instead of silently showing stale duty/roster data.
      isWeb && VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['pwa-crew-32.png', 'pwa-crew-48.png'],
        manifest: {
          id: '/',
          name: 'AviCore Crew',
          short_name: 'AviCore Crew',
          description: 'AviCore Crew — flight crew duty, roster and training app',
          theme_color: '#0b1220',
          background_color: '#0b1220',
          display: 'standalone',
          start_url: './',
          scope: './',
          icons: [
            { src: 'pwa-crew-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-crew-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-crew-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
          ]
        },
        workbox: {
          // App-shell precache only - see comment above. No navigateFallback
          // data caching, no runtime-caching entries for Supabase/Firebase.
          navigateFallbackDenylist: [/^\/api\//]
        }
      }),
      isAdmin && VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['pwa-admin-icon.svg'],
        manifest: {
          id: '/',
          name: 'AviCore Enterprise Admin',
          short_name: 'AviCore Admin',
          description: 'AviCore Enterprise — read-only admin monitoring',
          theme_color: '#0b1220',
          background_color: '#0b1220',
          display: 'standalone',
          start_url: './',
          scope: './',
          icons: [
            { src: 'pwa-admin-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-admin-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-admin-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
          ]
        },
        workbox: {
          navigateFallbackDenylist: [/^\/api\//]
        }
      })
    ].filter(Boolean),
    base: './',
    publicDir,
    build: {
      outDir,
      rollupOptions: {
        input: (isMobile || isWeb || isAdmin)
          ? { index: path.resolve(__dirname, sourceHtml) }
          : path.resolve(__dirname, 'index.html')
      }
    }
  };
});
