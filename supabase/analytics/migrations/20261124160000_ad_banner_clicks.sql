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
GRANT SELECT, INSERT ON TABLE public.ad_banner_clicks TO service_role;

CREATE FUNCTION public.ad_banner_click_report(p_offset integer)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'all', count(*),
        'iceberg', count(*) FILTER (WHERE banner = 'iceberg'),
        'sts', count(*) FILTER (WHERE banner = 'sts')
      )
      FROM public.ad_banner_clicks
    ),
    'clicks', (
      SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY clicked_at DESC, id DESC), '[]'::jsonb)
      FROM (
        SELECT id, banner, clicked_at, host(ip_address) AS ip_address
        FROM public.ad_banner_clicks
        ORDER BY clicked_at DESC, id DESC
        LIMIT 50 OFFSET greatest(p_offset, 0)
      ) AS page
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.ad_banner_click_report(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_banner_click_report(integer) TO service_role;
