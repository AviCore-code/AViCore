// The company's aircraft type, and the type a flight entry counts under.
//
// The FDT Excel has no aircraft-type column (only the registration). The
// Duty Import page let an admin type it in, but Auto Import (VPS, from
// 16 Nov 2026) never did - every re-import left FDT flights with no type, and
// Pilot Experience Summary / Logbook / Hours Summary / Report matched flights
// to a type row by name, so the AW139 hours from the FDT files silently
// dropped out (Capt. Weera, 21 Nov 2026). A flight with no type now counts
// as the company's type, and the FDT import tags its flights with it.

export const DEFAULT_AIRCRAFT_TYPE = "AW139";

// Whitespace-insensitive, upper case: "AW 139" == "AW139".
export const normalizeType = (v) => String(v || "").replace(/\s+/g, "").toUpperCase();

// The aircraft type a flight entry counts under: its own, else its first
// flight's, else the company's.
export function entryAircraftType(entry) {
  const legType = Array.isArray(entry?.legs) ? entry.legs.find((l) => l?.aircraftType)?.aircraftType : "";
  return entry?.aircraftType || legType || DEFAULT_AIRCRAFT_TYPE;
}
