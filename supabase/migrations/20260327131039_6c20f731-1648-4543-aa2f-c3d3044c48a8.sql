
ALTER TABLE public.user_credits ADD COLUMN IF NOT EXISTS free_followups_remaining integer NOT NULL DEFAULT 9;
