export const AD_BANNERS = {
  iceberg: "Айсберг",
  sts: "СТС",
} as const;

export type AdBanner = keyof typeof AD_BANNERS;

export function recordAdBannerClick(banner: AdBanner) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return;

  // Keep the partner link native and let the request finish if the visitor leaves.
  void fetch(`${url}/rest/v1/rpc/record_ad_banner_click`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ p_banner: banner }),
    keepalive: true,
  }).catch(() => undefined);
}
