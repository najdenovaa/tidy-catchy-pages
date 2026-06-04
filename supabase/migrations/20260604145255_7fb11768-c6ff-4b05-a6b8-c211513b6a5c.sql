
-- 1) Storage: enforce ownership folder on upload
DROP POLICY IF EXISTS "Authenticated users can upload analysis docs" ON storage.objects;
CREATE POLICY "Authenticated users can upload analysis docs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'analysis-docs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 2) chat_messages: allow users to delete own
CREATE POLICY "Users can delete own messages" ON public.chat_messages
FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 3) chat_sessions: allow users to delete own
CREATE POLICY "Users can delete own sessions" ON public.chat_sessions
FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 4) Payments: remove unrestricted UPDATE; service_role bypasses RLS
DROP POLICY IF EXISTS "Service can update payments" ON public.payments;

-- 5) user_credits: remove self-insert; create via trigger on new auth user
DROP POLICY IF EXISTS "Users can insert own credits" ON public.user_credits;

CREATE OR REPLACE FUNCTION public.handle_new_user_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_credits (user_id, ai_analyses_used, ai_analyses_limit, free_followups_remaining, balance_rub)
  VALUES (NEW.id, 0, 6, 18, 0)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Make sure user_id is unique so ON CONFLICT works
CREATE UNIQUE INDEX IF NOT EXISTS user_credits_user_id_key ON public.user_credits(user_id);

DROP TRIGGER IF EXISTS on_auth_user_created_credits ON auth.users;
CREATE TRIGGER on_auth_user_created_credits
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_credits();

-- Backfill any existing auth users missing a credits row
INSERT INTO public.user_credits (user_id, ai_analyses_used, ai_analyses_limit, free_followups_remaining, balance_rub)
SELECT u.id, 0, 6, 18, 0 FROM auth.users u
LEFT JOIN public.user_credits c ON c.user_id = u.id
WHERE c.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- 6) is_admin: revoke from anon/public; keep authenticated for RLS usage
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
