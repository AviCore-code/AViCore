import React from "react";
import { createRoot } from "react-dom/client";
import MobileApp from "./mobile/MobileApp.jsx";

// Separate entry point from src/main.jsx (the PC/Electron app) - built only
// via `npm run build:mobile` (mode "mobile", see vite.config.js), output to
// dist-mobile/ which is what capacitor.config.json's webDir points at. This
// keeps the Admin/Training/Flight Crews/Settings code (and their Electron
// IPC dependencies) completely out of the Android bundle - the phone only
// ever ships the four Pilot/Flight Crew pages.
createRoot(document.getElementById("root")).render(<MobileApp />);
