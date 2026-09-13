# Daily Alert Email — setup

Sends one email at **05:00 Asia/Bangkok** every day listing new FTL and Training
warnings. Runs on Supabase, so it works with every office computer switched off.

Capt. Weera does steps 1–4 (they involve an account and a secret key). Everything
else is already in the repo.

---

## 1. Create a Resend account

1. Go to <https://resend.com> and sign up with **wjuntaklud@gmail.com**.
2. Verify the email address Resend sends you.
3. Open **API Keys → Create API Key**, name it `avicore`, permission
   **Sending access**. Copy the key — it is shown once and starts with `re_`.

The free plan is 100 emails a day / 3,000 a month. This job sends at most one a
day, so it stays free.

### About the sending address

Without a verified domain, mail must be sent from `onboarding@resend.dev`.
It arrives, but it does not look like the company, and mail from an unfamiliar
sender to several people at one company is the kind that a spam filter quietly
discards.

That is why the recipient list starts as **Capt. Weera only** (step 5). Once you
have seen a real alert land in the inbox rather than the spam folder, add the
other six.

To send from `alerts@uoathai.com` later, add the domain in Resend and put the
three DNS records it gives you (SPF, DKIM, DMARC) on `uoathai.com`. Then change
`ALERT_FROM` — no code change is needed.

---

## 2. Store the secrets in Supabase

Supabase dashboard → **Edge Functions → Manage secrets**, add three:

| Name | Value |
|---|---|
| `RESEND_API_KEY` | the `re_...` key from step 1 |
| `ALERT_FROM` | `AviCore <onboarding@resend.dev>` |
| `ALERT_REPLY_TO` | `wjuntaklud@gmail.com` |

`ALERT_REPLY_TO` means anyone who hits Reply writes to Capt. Weera, not to an
address nobody reads.

Never put these in the repo — they are the equivalent of a password.

---

## 3. Deploy the function

From `C:\AviCore_Platform1`:

```
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase functions deploy daily-alerts --no-verify-jwt
```

`<PROJECT_REF>` is in your Supabase project URL:
`https://<PROJECT_REF>.supabase.co`.

---

## 4. Schedule it

Open `schedule.sql` in this folder, replace `<PROJECT_REF>` and
`<SERVICE_ROLE_KEY>` (Settings → API → `service_role`), then paste the whole file
into the Supabase **SQL Editor** and run it.

It schedules `0 22 * * *` — 22:00 UTC, which is 05:00 the next morning in
Bangkok. Thailand has no daylight saving, so this stays correct all year.

---

## 5. Switch it on in AviCore

**Settings → Admin Setting → Daily Alert Email**

- Tick **Send the daily alert email**
- Recipients: **`wjuntaklud@gmail.com` only** for the first few days
- Save

---

## 6. Check it worked

Next morning, open the same card. **Last check** should show today's date.

- **Last check is "Never"** → the cron job is not firing. Run the
  `cron.job_run_details` query at the bottom of `schedule.sql`.
- **Last check updates but no email** → there was nothing new to report, which is
  normal. Only items not previously reported are sent.
- **Email in spam** → mark it "not spam" and add the sender to contacts. If it
  keeps happening, verify the domain (step 1) before adding the other six people.

To test immediately instead of waiting for 05:00:

```
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/daily-alerts \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
```

It replies with how many items were checked and how many were emailed.

---

## 7. Only after it is proven — turn off the old checker

The PC checker (`scripts/alertCheck.mjs`, Windows Task Scheduler) still runs.
Leave it on until the new emails have arrived for two or three days: during the
overlap you may get two emails for the same warning, which is better than a gap
with no alerts at all.

Then, on the PC: **Task Scheduler → find the AviCore alert task → Disable**, and
untick **Enable email notifications** in Settings → Admin Setting → Email
Notifications (this computer).

Both paths share the same `email_notified_warnings` record, so during the overlap
whichever runs first claims a warning and the other will not repeat it.

---

## What the email contains

Only items that have **not been reported before** — a licence expiring in 30 days
is mentioned once, not every morning for a month. If a warning clears and later
returns, it is reported again.

Both sources are included:

- **FTL** — duty and flight time limits, recovery rest
- **Training** — licences, medicals, passports, courses (including any course
  added under Training Setting)

The figures come from the same modules the Dashboard uses, so the email and the
screen can never disagree.
