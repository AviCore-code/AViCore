import React from "react";
import { createRoot } from "react-dom/client";
import AdminWebApp from "./web/AdminWebApp.jsx";

// Entry point for the Enterprise Web admin build (`npm run build:admin`,
// mode "admin", see vite.config.js), output to dist-admin/ - a static site
// that talks straight to Supabase with the public anon key, same as the
// Crew web build (main-web.jsx). This one ships the ADMIN monitoring pages
// (Dashboard, All Status, Training Monitor, Reports) behind a PIN gate, all
// read-only. See src/web/AdminWebApp.jsx.
createRoot(document.getElementById("root")).render(<AdminWebApp />);
