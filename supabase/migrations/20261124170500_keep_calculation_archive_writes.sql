-- The calculation archive writes its queued snapshots via the Data API.
-- The existing RLS rules allow insertion and restrict journal reads to administrators.
GRANT INSERT ON public.calculation_logs TO anon, authenticated;
