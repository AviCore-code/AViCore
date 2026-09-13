# Pilot LINE due date alerts

Implementation is local until deployed and configured. This is a separate job from email;
email delivery and its deduplication settings are unchanged.

## Setup

1. Create a LINE Official Account, enable Messaging API and **Allow bot to join group chats**,
   then invite the account into the intended pilot group.
2. Obtain that group's `source.groupId` from a verified LINE webhook event. Use an existing
   signature-verifying webhook or deploy `line-group-webhook` in the adjacent directory.
   For that helper, set `LINE_CHANNEL_SECRET` in Edge Function Secrets, deploy with JWT
   verification disabled, and set its URL in LINE Developers → Messaging API → Webhook URL.
   Enable Use webhook, send a message in the intended group, and copy the verified group ID
   from the function logs. The helper does not save messages or reply to group members.
   Never use the first observed group automatically: check the intended group explicitly.
3. Store these in Supabase Edge Function Secrets, never in frontend settings or source:
   - `LINE_CHANNEL_ACCESS_TOKEN`: the channel's access token.
   - `LINE_PILOT_GROUP_ID`: the selected group ID (`C` plus 32 hex characters).
   - `LINE_ALERT_CRON_SECRET`: optional override; otherwise the scheduler secret is verified
     against Vault through the service-role-only `avicore_verify_line_cron` RPC.
   - `COMPANY_SLUG`: the intended AviCore company (defaults to `uoa`, matching daily-alerts).
4. Deploy `line-due-alerts` with JWT verification disabled: the handler verifies its own
   dedicated bearer secret. Use the Supabase dashboard or CLI after checking CLI help.
5. Apply `sql/line-alert-cron-auth.sql`. In Supabase Vault create
   `avicore_line_function_url` with the full deployed function URL and
   `avicore_line_cron_secret` with a random secret of at least 32 bytes. This can be generated
   server-side using `encode(extensions.gen_random_bytes(32),'hex')` without displaying it.
   Run `schedule.sql` once. It schedules 05:00 Asia/Bangkok daily.
6. In AviCore Settings → Admin Setting → LINE Due Date Alerts, enable and save.
   On desktop, sync settings to the server before expecting the job to see them.

## Verification

An authorized POST with `Authorization: Bearer <LINE_ALERT_CRON_SECRET>` runs the real job
and sends real pilot data to the configured group. Test only after checking the destination.
No browser test button exposes this secret. Reopen Admin Settings to refresh the last status.
Check both the function response and the actual group: LINE acceptance does not prove display.
Use `{"dryRun":true}` with the same Vault/override authorization to validate configuration,
group membership/name and warning count without sending messages or marking warnings sent.

## UOA activation — 2026-09-06

Deployed `line-due-alerts` version 2. Dry run returned HTTP 200, company `uoa`,
group `UOA thai pilot`, 104 warnings and one request batch. Enabled the UOA setting and
cron job `avicore-line-due-alerts` for 22:00 UTC (05:00 Bangkok the next day).
No immediate real due-date digest was sent during setup. First scheduled run is
2026-09-07 at 05:00 Bangkok. Verify delivery after that run; deployment alone is not delivery.

## Behavior and limits

- Uses the shared training thresholds, disabled items and custom courses; includes training
  currency/count warnings alongside dated documents and courses. No FTL data is included.
- One summary per Bangkok day when warnings exist, with overdue items first. Existing alerts
  recur daily until resolved. No message when there are no warnings.
- Groups see pilot code/name, course/document name, due date and days remaining from the same
  recommendation text used by AviCore. Tokens stay on the server.
- Text is split into at most 5 messages per request, each below 5,000 UTF-16 units.
- Stores batch progress before sending and stable LINE retry keys per company/group/day/batch;
  failures can be retried on the same day without resending accepted batches. The schedule
  itself runs once daily; inspect failures and rerun manually when necessary.
- LINE retry keys expire after 24 hours. A new day's summary uses new keys. Persisted payloads
  freeze that day's retry content. Run only one scheduled job per company and destination.
- Disable the Admin toggle to stop sending. Delivery requires a valid token, bot membership,
  an active schedule and available LINE message quota.

Sources: [LINE groups](https://developers.line.biz/en/docs/messaging-api/group-chats/),
[LINE API](https://developers.line.biz/en/reference/messaging-api/nojs/#send-push-message),
[Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions).
