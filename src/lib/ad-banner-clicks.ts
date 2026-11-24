export const CLICK_TARGETS = {
  iceberg: "Айсберг",
  sts: "СТС",
  pdf_editor: "PDF-редактор",
  ios_app: "App Store · iPhone",
  android_app: "RuStore · Android",
} as const;

export type ClickTarget = keyof typeof CLICK_TARGETS;

export const AD_ANALYTICS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ad-clicks`;

export function recordSiteClick(target: ClickTarget) {
  // Keep the partner link native and let the request finish if the visitor leaves.
  void fetch(AD_ANALYTICS_URL, {
    method: "POST",
    body: JSON.stringify({ target }),
    keepalive: true,
  }).catch(() => undefined);
}
