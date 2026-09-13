# Selling AviCore to more than one operator

Until now every row in the database was shared. The write policies said
`using (true)`, which means **any signed-in admin could read and write every
row**. With one customer that is invisible. With two, Company B's chief pilot
opens Pilot Roster and sees Company A's pilots — their duty hours, licence
numbers and medical expiry dates.

These three files fix that. Run them in order.

---

## Before you start

**Take a backup.** Supabase dashboard → Database → Backups, or use the app's own
Server Backup (Settings → Admin Setting). Step 1 changes the shape of every
table; if something goes wrong you want a way back.

Do it when nobody is using the system.

### Set the company slug and rebuild FIRST

`.env.local` must contain:

```
VITE_COMPANY_SLUG=uoa
```

Then rebuild and redeploy **before** running step 2:

```
deploy-admin.bat
deploy-web.bat -NoBump
build-pc.bat
```

This applies to the EXISTING deployment, not just new customers. The Crew app
has no user account, so it identifies its company by sending this slug. A build
made without it sends nothing, the RLS policies match no rows, and Crew shows an
empty sign-in screen with no pilots — which looks exactly like an empty
database. It is not: the data is there and invisible.

The value is baked in at build time, so changing `.env.local` alone does
nothing. It has to be rebuilt.

---

## Step 1 — add the company column

Paste `multi-tenant-01-add-company-id.sql` into the Supabase SQL Editor and run
it.

This is **safe on a live system**. It adds a `company_id` to every table and
fills it with the existing customer's id. Nothing is enforced yet, so the
running app carries on exactly as before.

It also creates the first company (United Offshore Aviation, slug `uoa`) and
links every existing admin account to it.

Then run the check at the bottom of the file. Every table must show
`total = with_company`. **If any row is unassigned, stop** — step 2 would make
those rows invisible to everyone.

---

## Step 2 — enforce it

Run `multi-tenant-02-rls.sql`.

This is the one that changes behaviour. After it, a row is only visible to the
company that owns it.

Two kinds of caller are treated differently, and the difference matters when you
are selling:

**Admin** (Enterprise web, PC) signs in with a real account. The company is
looked up **inside the database** from `auth.uid()`. The browser never sends it
and cannot influence it. An admin cannot reach another company's rows even by
editing the request by hand. This is real isolation.

**Crew** (pilot web app, Android) uses the anon key and has no account. There is
nothing to look up, so the app sends its company slug in a header and the policy
trusts it. **This is weaker.** Anyone holding the anon key who guesses a slug can
read that company's roster and training dates.

That is acceptable only because each customer gets their own Crew deployment
with their own anon key, crew access is read-only, and the pilot password gate
still applies on top. **If a customer's contract needs a stronger guarantee than
that, give them their own Supabase project** — do not try to solve it with a
cleverer policy, and say so plainly when selling.

---

## Step 2b — give Crew back its duty writes

Run `multi-tenant-02b-crew-duty-write.sql`.

Step 2 grants anon `SELECT` and nothing else. That is right for roster, training
and settings, but wrong for duty entries: **a pilot recording their own duty is
the whole point of the Crew app**, and the policies step 2 replaced allowed it.

Without this, a pilot presses Save and is told their account is not linked to a
company — a misleading message for what is actually a refused write.

---

## Step 3 — prove it

Run `multi-tenant-03-verify.sql`. Every check must print **PASS**.

The one to read carefully is check 3: it looks for surviving `using (true)`
policies. Postgres ORs permissive policies together, so a single leftover `true`
silently cancels the isolation beside it.

---

## Adding a customer

Run this with the **service-role key** (SQL Editor is fine — it runs as service
role). Deliberately not possible from inside the app: a compromised admin
account could otherwise add itself to another company.

```sql
-- 1. the company
insert into public.companies (name, slug, expires_at)
values ('Bangkok Air Services', 'bas', now() + interval '1 year')
returning id;

-- 2. create their admin in Authentication → Users, then link them
insert into public.company_members (user_id, company_id)
values ('<the new user id>', '<the company id from step 1>');
```

Then build their Crew app with their slug:

```
VITE_COMPANY_SLUG=bas
```

in `.env.local` before `deploy-web.bat`. Each customer needs their own Crew
deployment — the slug is baked in at build time.

---

## Subscriptions

`companies.expires_at` controls it:

```sql
update public.companies set expires_at = now() + interval '1 year' where slug = 'bas';
```

Past that date **writes are refused, reads keep working**. That is deliberate: a
customer whose invoice is late should not be locked out of their own duty and
training records. This is a compliance system, and the records are theirs.
Chase the invoice; do not hold the safety data hostage.

`expires_at = null` means no expiry.

---

## What this does not cover

- **Per-customer defaults.** The FTL limits, fatigue criteria and due-date rules
  that ship with AviCore were transcribed from UOA's OPS-CM-01 and Training Track
  workbook. A new customer can change all of them in Settings, but the starting
  values are another operator's. Walk each new customer through Settings before
  they rely on a single figure.
- **Licensing for the web apps.** The PC build has `electron/license.cjs`; the
  web builds have nothing beyond `expires_at` above.
- **The Android build.** It reads from the same tables and will need the same
  slug treatment before a second customer uses it.
