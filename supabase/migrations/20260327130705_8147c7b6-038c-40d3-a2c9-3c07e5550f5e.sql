
ALTER TABLE public.user_credits ADD COLUMN IF NOT EXISTS balance_rub numeric NOT NULL DEFAULT 0;

-- Table for follow-up question history
CREATE TABLE public.followup_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  question text NOT NULL,
  has_attachment boolean NOT NULL DEFAULT false,
  attachment_name text,
  cost_rub numeric NOT NULL,
  answer text,
  report_context text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.followup_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own questions" ON public.followup_questions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own questions" ON public.followup_questions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all questions" ON public.followup_questions FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
