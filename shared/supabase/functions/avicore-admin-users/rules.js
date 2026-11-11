// Pure rules for Admin Setting -> Admin Users, kept apart from index.ts so
// they can be unit-tested without Deno or a database.

export const MIN_PASSWORD_LENGTH = 5;

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

// Returns an error message (Thai, shown to the admin as-is) or null.
export function checkCreate(input) {
  if (!validEmail(input?.email)) return "กรุณาใส่อีเมลให้ถูกต้อง";
  const password = String(input?.password || "");
  if (password.length < MIN_PASSWORD_LENGTH) return `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`;
  return null;
}

export function checkUpdate(input) {
  if (!input?.userId) return "ไม่พบผู้ใช้ที่จะแก้ไข";
  if (input.email != null && !validEmail(input.email)) return "กรุณาใส่อีเมลให้ถูกต้อง";
  if (input.password && String(input.password).length < MIN_PASSWORD_LENGTH) {
    return `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`;
  }
  return null;
}

// members: [{ user_id, admin_web }] for the caller's company, BEFORE the change.
// Blocks the two ways an admin could lock everyone (or themselves) out.
export function checkAccessChange({ callerId, targetId, members, nextAdminWeb, removing }) {
  const losingAccess = removing || nextAdminWeb === false;
  if (!losingAccess) return null;
  if (targetId === callerId) {
    return removing ? "ลบบัญชีของตัวเองไม่ได้" : "ปิดสิทธิ์ Admin ของตัวเองไม่ได้";
  }
  const target = members.find((m) => m.user_id === targetId);
  const remaining = members.filter((m) => m.admin_web && m.user_id !== targetId).length;
  if (target?.admin_web && remaining === 0) return "ต้องมี Admin อย่างน้อย 1 คน";
  return null;
}
