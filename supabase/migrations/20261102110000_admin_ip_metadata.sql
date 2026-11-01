-- Public network attribution for admin analytics. This is NOT an individual's address.
ALTER TABLE public.visit_logs ADD COLUMN IF NOT EXISTS ip_metadata jsonb;
ALTER TABLE public.calculation_logs ADD COLUMN IF NOT EXISTS ip_metadata jsonb;
COMMENT ON COLUMN public.visit_logs.ip_metadata IS 'Approximate public-IP network/region attribution: ASN, ISP, network owner, country/region/city; not a physical visitor address.';
COMMENT ON COLUMN public.calculation_logs.ip_metadata IS 'Approximate public-IP network/region attribution: ASN, ISP, network owner, country/region/city; not a physical visitor address.';
