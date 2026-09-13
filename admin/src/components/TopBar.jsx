import { useEffect, useState } from "react";
import { getSetting } from "../services/desktopDatabase.js";
import "./TopBar.css";

// Customer company name/logo, configured in Settings > Branding, synced via
// the "customer_branding" app_settings key. Renders top-right on every page;
// stays hidden until an admin actually sets something (no empty bar).
export default function TopBar() {
  const [branding, setBranding] = useState(null);

  useEffect(() => {
    load();
    window.addEventListener("branding-updated", load);
    return () => window.removeEventListener("branding-updated", load);
  }, []);

  async function load() {
    const saved = await getSetting("customer_branding");
    setBranding(saved || null);
  }

  if (!branding || (!branding.name && !branding.logo)) return null;

  return (
    <div className="topbar">
      <div className="topbar-brand">
        {branding.logo && <img src={branding.logo} alt="" />}
        {branding.name && <span>{branding.name}</span>}
      </div>
    </div>
  );
}
