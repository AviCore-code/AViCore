-- Table to track intent classification feedback for continuous learning
-- Helps analyze query patterns and improve intent matching over time

CREATE TABLE IF NOT EXISTS public.admin_intent_feedback (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_query TEXT NOT NULL,
  classified_intent TEXT,
  corrected_intent TEXT,
  confidence NUMERIC(3,2),
  feedback_type TEXT NOT NULL, -- "correct" | "wrong" | "clarified" | "vague" | "no_match"
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_intent_feedback_company_date
  ON public.admin_intent_feedback(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_intent_feedback_intent
  ON public.admin_intent_feedback(classified_intent, feedback_type);

ALTER TABLE public.admin_intent_feedback ENABLE ROW LEVEL SECURITY;

-- Policy: only service role can insert, authenticated users cannot read/write directly
CREATE POLICY "service_role_feedback_insert"
  ON public.admin_intent_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

COMMENT ON TABLE public.admin_intent_feedback IS 'Track intent classification feedback for Bot learning and improvement';
COMMENT ON COLUMN public.admin_intent_feedback.feedback_type IS 'correct = matched user intent, wrong = misclassified, clarified = asked for clarification, vague = query too short';
