// Which Supabase Auth accounts are allowed into the Enterprise Web admin
// (src/web/AdminWebApp.jsx). Supabase Auth is ONE shared user pool for the
// whole project, so without this list ANY account you create could sign in
// to admin. List the admin email(s) here to restrict it.
//
//   - Leave the array EMPTY  -> every signed-in account is allowed (no lock).
//   - Put emails in it        -> only those exact emails may use admin;
//                                anyone else is signed straight back out.
//
// Emails are compared case-insensitively. After editing, rebuild:
//   npm run build:admin   (or double-click deploy-admin.bat)
//
// NOTE: this is a client-side gate (good for keeping the wrong staff out).
// For hard server-side enforcement, the write-RLS can also be tied to these
// emails - ask if you want that added.
export const ADMIN_ALLOWED_EMAILS = [
  "weera@uoathai.com",
];
