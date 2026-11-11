import { useEffect, useState } from "react";
import { listAdminUsers, createAdminUser, updateAdminUser, deleteAdminUser } from "../../services/webDatabase.js";

// Admin Setting -> Admin Users (web/admin build only).
// Who can sign in to the Admin web app, with what email and password. The
// privileged work (creating logins, setting passwords) runs in the
// avicore-admin-users Edge Function; this page only collects the input.
// Delete removes the person from AviCore - their login is kept, because the
// Supabase login pool is shared with another app on the same project.

const MIN_PASSWORD = 8;
const EMPTY_FORM = { userId: null, email: "", name: "", password: "", confirm: "", adminWeb: true };

function formatWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function adminUserFormProblem(form) {
  const email = form.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email.";
  const needsPassword = !form.userId;
  if (needsPassword && !form.password) return "Enter a password.";
  if (form.password && form.password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (form.password !== form.confirm) return "The two passwords do not match.";
  return null;
}

export default function AdminUsersPanel() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);       // null = no form open
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  async function refresh() {
    setLoading(true);
    try {
      setUsers(await listAdminUsers());
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  function openAdd() {
    setMsg(null);
    setForm({ ...EMPTY_FORM });
  }

  function openEdit(u) {
    setMsg(null);
    setForm({ userId: u.userId, email: u.email, name: u.name, password: "", confirm: "", adminWeb: u.adminWeb, isYou: u.isYou });
  }

  async function handleSave() {
    const problem = adminUserFormProblem(form);
    if (problem) { setMsg({ ok: false, text: problem }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const payload = { email: form.email.trim(), name: form.name.trim(), adminWeb: form.adminWeb };
      if (form.password) payload.password = form.password;
      if (form.userId) {
        await updateAdminUser({ userId: form.userId, ...payload });
        setMsg({ ok: true, text: `Saved ${payload.email}.` });
      } else {
        const res = await createAdminUser(payload);
        setMsg({
          ok: true,
          text: res?.linkedExisting
            ? `Added ${payload.email}. This email already had a login on the server; its password is now the one entered here.`
            : `Added ${payload.email}. They can sign in with this email and password now.`
        });
      }
      setForm(null);
      await refresh();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(u) {
    if (!confirm(`Remove ${u.email} from AviCore Admin?\n\nThey will no longer be able to sign in to the Admin web app.`)) return;
    setMsg(null);
    try {
      await deleteAdminUser(u.userId);
      setMsg({ ok: true, text: `Removed ${u.email}.` });
      if (form?.userId === u.userId) setForm(null);
      await refresh();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  return (
    <div className="settings-card settings-card-wide">
      <div className="module-header settings-subheader">
        <div>
          <h2>Admin Users</h2>
          <p>Who can sign in to the AviCore Admin web app. Add a person with an email and password, change their password, switch their access off, or remove them.</p>
        </div>
      </div>

      <div className="settings-actions">
        <button className="primary" onClick={openAdd} disabled={saving}>+ Add User</button>
        <button onClick={refresh} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button>
      </div>

      {form && (
        <div className="settings-detail admin-users-form">
          <h3>{form.userId ? `Edit ${form.email}` : "New Admin User"}</h3>
          <label className="settings-field">
            <span>Email (used to sign in)</span>
            <input type="email" value={form.email} onChange={set("email")} autoComplete="off" placeholder="name@uoathai.com" />
          </label>
          <label className="settings-field">
            <span>Name</span>
            <input value={form.name} onChange={set("name")} autoComplete="off" placeholder="Full name" />
          </label>
          <label className="settings-field">
            <span>{form.userId ? "New password (leave blank to keep the current one)" : "Password"}</span>
            <input type="password" value={form.password} onChange={set("password")} autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`} />
          </label>
          <label className="settings-field">
            <span>Confirm password</span>
            <input type="password" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" />
          </label>
          <label className="settings-toggle">
            <input type="checkbox" checked={form.adminWeb} onChange={set("adminWeb")} disabled={form.isYou} />
            <span>Admin web access {form.isYou ? "(you cannot switch off your own access)" : "(off = keeps the account but blocks sign-in)"}</span>
          </label>
          <div className="settings-actions">
            <button className="primary" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
            <button onClick={() => { setForm(null); setMsg(null); }} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}

      {msg && <div className={`settings-msg ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}

      {!loading && users.length === 0 && !msg && (
        <div className="settings-status settings-status-off">No users found.</div>
      )}

      {users.length > 0 && (
        <table className="settings-devices-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Admin Access</th>
              <th>Last Sign-in</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.userId}>
                <td>{u.email || "—"}{u.isYou ? " (you)" : ""}</td>
                <td>{u.name || "—"}</td>
                <td>
                  <span className={`settings-devices-dot ${u.adminWeb ? "online" : "offline"}`} />
                  {u.adminWeb ? "On" : "Off"}
                </td>
                <td>{formatWhen(u.lastSignInAt)}</td>
                <td className="admin-users-row-actions">
                  <button onClick={() => openEdit(u)} disabled={saving}>Edit</button>
                  <button className="danger" onClick={() => handleDelete(u)} disabled={saving || u.isYou}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
