CREATE TABLE public.analysis_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  report TEXT,
  document_names TEXT[] NOT NULL DEFAULT '{}',
  request_payload JSONB,
  credits_charged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT analysis_jobs_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own analysis jobs"
ON public.analysis_jobs
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analysis jobs"
ON public.analysis_jobs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own analysis jobs"
ON public.analysis_jobs
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all analysis jobs"
ON public.analysis_jobs
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

CREATE TRIGGER update_analysis_jobs_updated_at
BEFORE UPDATE ON public.analysis_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_analysis_jobs_user_created_at
ON public.analysis_jobs (user_id, created_at DESC);

CREATE INDEX idx_analysis_jobs_status
ON public.analysis_jobs (status, created_at DESC);