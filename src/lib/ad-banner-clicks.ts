export const AD_BANNERS = {
  iceberg: "Айсберг",
  sts: "СТС",
} as const;

export type AdBanner = keyof typeof AD_BANNERS;

export const AD_ANALYTICS_URL = "https://voeqxqtglzrsjkocctag.supabase.co/functions/v1/ad-clicks";

export function recordAdBannerClick(banner: AdBanner) {
  // Keep the partner link native and let the request finish if the visitor leaves.
  void fetch(AD_ANALYTICS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ banner }),
    keepalive: true,
  }).catch(() => undefined);
}
