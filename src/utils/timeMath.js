export function toMin(value) {
  if (!value) return 0;
  const [h, m] = String(value).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function toHour(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function sumHours(values) {
  return toHour(values.reduce((sum, value) => sum + toMin(value), 0));
}

// Aircraft experience rows are [type, pic, picus, sic, total]. TRI/TRE are
// tracked separately in the Specialty Hours table, not per aircraft type.
// A handful of records were briefly saved with a 7-element
// [type, pic, picus, sic, tri, tre, total] shape - migrate those back down
// (dropping tri/tre) instead of misreading index 4 as pic/picus/sic total.
export function normalizeAircraftRow(row) {
  if (!Array.isArray(row)) return ["", "0:00", "0:00", "0:00", "0:00"];
  if (row.length === 5) return row;
  if (row.length === 7) return [row[0], row[1], row[2], row[3], row[6]];
  const total = row[row.length - 1] ?? "0:00";
  return [row[0] ?? "", row[1] ?? "0:00", row[2] ?? "0:00", row[3] ?? "0:00", total];
}
