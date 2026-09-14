import React from "react";
import { createRoot } from "react-dom/client";
import WebApp from "./web/WebApp.jsx";

// Separate entry point for the plain-browser web build (`npm run
// build:web`, mode "web", see vite.config.js), output to dist-web/ - a
// static site that can be deployed anywhere (Netlify, Vercel, Cloudflare
// Pages, even a Supabase Storage public bucket) since it talks directly to
// Supabase with the public anon key, the same way the Android app does.
// Ships only the four Pilot/Flight Crew pages, same as the mobile build -
// no Admin/Training/Flight Crews/Settings code, and no Electron or
// Capacitor dependencies at all.
createRoot(document.getElementById("root")).render(<WebApp />);
