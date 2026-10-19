# Birthday Greeting via LINE

Sends birthday greetings at **07:00 Asia/Bangkok** (00:00 UTC) each day to pilots celebrating their birthday.

## Setup

1. **Add birthdate data to pilots**
   - Admin → Pilot Roster → each pilot's `birth_date` field (YYYY-MM-DD format)

2. **Deploy the function**
   ```bash
   supabase functions deploy line-birthday-greetings --no-verify-jwt
   ```

3. **Create the RPC function** (run in Supabase SQL Editor)
   ```sql
   -- Copy from shared/sql/birthday-greetings-setup.sql
   ```

4. **Schedule the cron job** (run in Supabase SQL Editor)
   ```sql
   SELECT cron.unschedule('avicore-birthday-greetings')
   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avicore-birthday-greetings');

   SELECT cron.schedule(
     'avicore-birthday-greetings',
     '0 0 * * *',
     $$ SELECT net.http_post(
       url := 'https://ofyboehfubpdicpapyop.supabase.co/functions/v1/line-birthday-greetings',
       headers := jsonb_build_object('Authorization', 'Bearer ' || 'your-secret-here'),
       body := '{}'::jsonb
     )
     $$
   );
   ```

## How It Works

- Runs every day at 00:00 UTC (07:00 Bangkok)
- Queries `get_birthday_pilots()` RPC to find today's birthdays (month-day match, any year)
- Calculates age from `birth_date`
- Sends LINE message to configured group with greeting
- Records sent greetings in `admin_birthday_greetings` table (prevents duplicates)

## Message Format

```
🎉 วันเกิดในทีมวันนี้:

🎂 John Doe (JDO) — วันนี้เป็นวันเกิดอายุ 35 ปี! สวัสดี และอวยพรให้คุณมีความสุขเต็มไปด้วยสุขภาพดีครับ
🎂 Jane Smith (JSM) — วันนี้เป็นวันเกิดอายุ 32 ปี! สวัสดี และอวยพรให้คุณมีความสุขเต็มไปด้วยสุขภาพดีครับ

ขอให้เป็นวันที่ดีเสมอ ✈️
```

## Testing

Trigger immediately:
```bash
curl -X POST https://ofyboehfubpdicpapyop.supabase.co/functions/v1/line-birthday-greetings \
  -H "Authorization: Bearer your-secret" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Check which pilots have birthdays set:
```sql
SELECT pilot_code, pilot_name, birth_date
FROM "Admin_pilot_roster"
WHERE birth_date IS NOT NULL AND deleted_at IS NULL;
```

Check greeting history:
```sql
SELECT pilot_code, pilot_name, greeting_date, greeted_at
FROM admin_birthday_greetings
WHERE greeting_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY greeting_date DESC;
```
