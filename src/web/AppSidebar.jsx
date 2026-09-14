import { useEffect, useState } from "react";

// Shared sidebar used by both the Admin shell (.admin-shell) and the Crew
// shell (.crew-shell) - each parent applies its own theme class so the two
// pick up different colors from the same markup/behaviour (see
// AppSidebar.css). Replaces the old horizontal .web-tabbar.
//
// UX fix (2026-09-14): the sidebar only showed icons at rest and expanded
// to reveal labels on `:hover` / `:focus-within`. That's undiscoverable -
// a new user has no way to know hovering the rail expands it, so on first
// visit every item looks like an unlabeled icon. Two independent fixes,
// both kept:
//   1. Every item still carries a native `title` attribute (tooltip on
//      hover over the SPECIFIC icon, no CSS needed, works even if JS is
//      slow to hydrate).
//   2. A pin toggle (📌) at the top lets the user keep the sidebar
//      expanded permanently - persisted in localStorage so the choice
//      survives a reload. Hover-to-expand still works when unpinned.
const PIN_KEY = "avicore_sidebar_pinned";

function readPinned() {
  try { return localStorage.getItem(PIN_KEY) === "1"; } catch { return false; }
}

function writePinned(value) {
  try { localStorage.setItem(PIN_KEY, value ? "1" : "0"); } catch { /* private mode: not fatal */ }
}

/**
 * @param {{
 *   groups: Array<{ label?: string, items: Array<{ key: string, label: string, icon: string, onClick: () => void, active?: boolean, danger?: boolean }> }>,
 *   brand?: { icon: string, title: string, subtitle?: string },
 *   sync?: { status: string, label: string },
 *   footItems?: Array<{ key: string, label: string, icon: string, onClick: () => void }>
 * }} props
 */
export default function AppSidebar({ groups, brand, sync, footItems }) {
  const [pinned, setPinned] = useState(readPinned);

  useEffect(() => { writePinned(pinned); }, [pinned]);

  return (
    <nav className={`app-sidebar${pinned ? " pinned" : ""}`}>
      {brand && (
        <div className="app-sidebar-item app-sidebar-brand" title={brand.title}>
          <span className="app-sidebar-icon" aria-hidden="true">{brand.icon}</span>
          <span className="app-sidebar-text">
            <strong>{brand.title}</strong>
            {brand.subtitle && <small>{brand.subtitle}</small>}
          </span>
        </div>
      )}

      <button
        type="button"
        className="app-sidebar-item app-sidebar-pin"
        title={pinned ? "Unpin sidebar (auto-collapse)" : "Pin sidebar open"}
        aria-pressed={pinned}
        onClick={() => setPinned((v) => !v)}
      >
        <span className="app-sidebar-icon" aria-hidden="true">{pinned ? "📌" : "📍"}</span>
        <span className="app-sidebar-text">{pinned ? "Pinned open" : "Pin sidebar"}</span>
      </button>

      {sync && (
        <span className={`web-sync-status app-sidebar-sync ${sync.status}`} title={sync.label}>
          <span className="web-sync-dot" />
          <span className="app-sidebar-text">{sync.label}</span>
        </span>
      )}

      {groups.map((group, gi) => (
        <div className="app-sidebar-group" key={group.label || gi}>
          {group.label && <span className="app-sidebar-label">{group.label}</span>}
          {group.items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`app-sidebar-item${item.active ? " active" : ""}${item.danger ? " app-sidebar-signout" : ""}`}
              title={item.label}
              aria-current={item.active ? "page" : undefined}
              onClick={item.onClick}
            >
              <span className="app-sidebar-icon" aria-hidden="true">{item.icon}</span>
              <span className="app-sidebar-text">{item.label}</span>
            </button>
          ))}
        </div>
      ))}

      {footItems && footItems.length > 0 && (
        <div className="app-sidebar-foot">
          {footItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className="app-sidebar-item"
              title={item.label}
              onClick={item.onClick}
            >
              <span className="app-sidebar-icon" aria-hidden="true">{item.icon}</span>
              <span className="app-sidebar-text">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
