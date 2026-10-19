-- Add birthdate column to Admin_pilot_roster for birthday greeting feature

ALTER TABLE public."Admin_pilot_roster" ADD COLUMN IF NOT EXISTS birth_date DATE NULL;

-- Birthday greetings table: track which pilots were greeted today
CREATE TABLE IF NOT EXISTS public.admin_birthday_greetings (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  pilot_code TEXT NOT NULL,
  pilot_name TEXT,
  greeting_date DATE NOT NULL,
  greeted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_birthday_greetings_daily_pilot
  ON public.admin_birthday_greetings(company_id, pilot_code, greeting_date);

-- Enable RLS
ALTER TABLE public.admin_birthday_greetings ENABLE ROW LEVEL SECURITY;

-- Policy: only service role can write, anon cannot read
CREATE POLICY "service_role_birthday_insert"
  ON public.admin_birthday_greetings
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL)
  ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.admin_birthday_greetings IS 'Track daily birthday greetings sent via LINE';
COMMENT ON COLUMN public."Admin_pilot_roster".birth_date IS 'Pilot date of birth (YYYY-MM-DD) for birthday greetings';
