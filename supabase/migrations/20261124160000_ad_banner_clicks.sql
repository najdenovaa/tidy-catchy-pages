CREATE TABLE public.ad_banner_clicks (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  banner text NOT NULL CHECK (banner IN ('iceberg', 'sts')),
  clicked_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  ip_address inet
);

CREATE INDEX ad_banner_clicks_recent_idx
  ON public.ad_banner_clicks (clicked_at DESC, id DESC);

ALTER TABLE public.ad_banner_clicks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ad_banner_clicks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ad_banner_clicks TO authenticated;

CREATE POLICY ad_banner_clicks_admin_read
  ON public.ad_banner_clicks
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin((SELECT auth.uid()))));

-- Accept only the banner identifier. Time and IP come from the server request.
CREATE FUNCTION public.record_ad_banner_click(p_banner text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  client_ip inet;
BEGIN
  IF p_banner IS NULL OR p_banner NOT IN ('iceberg', 'sts') THEN
    RAISE EXCEPTION 'Unknown banner' USING ERRCODE = '22023';
  END IF;

  BEGIN
    client_ip := nullif(btrim(coalesce(
      nullif(headers->>'cf-connecting-ip', ''),
      split_part(headers->>'x-forwarded-for', ',', 1)
    )), '')::inet;
  EXCEPTION WHEN invalid_text_representation THEN
    client_ip := NULL;
  END;

  INSERT INTO public.ad_banner_clicks (banner, ip_address)
  VALUES (p_banner, client_ip);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_ad_banner_click(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ad_banner_click(text) TO anon, authenticated;
