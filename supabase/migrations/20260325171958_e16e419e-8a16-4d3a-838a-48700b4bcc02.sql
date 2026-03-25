
CREATE TABLE public.analysis_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id text,
  user_email text,
  module text NOT NULL DEFAULT 'cementing',
  well_summary text,
  documents_count int DEFAULT 0,
  document_names text[],
  ip_address text,
  user_agent text,
  location text
);

ALTER TABLE public.analysis_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view analysis logs" ON public.analysis_logs
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Anyone can insert analysis logs" ON public.analysis_logs
  FOR INSERT WITH CHECK (true);
