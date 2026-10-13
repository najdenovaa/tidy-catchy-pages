/**
 * Шрифт для подписей в 3D-сценах (drei <Text>, troika-three-text).
 * Хранится на сайте: без него troika подбирает шрифты через CDN (cdn.jsdelivr.net) — при недоступном CDN
 * подписи не появляются, а ожидание загрузки задерживает обновления интерфейса.
 * Подмножество DejaVu Sans: латиница, кириллица, греческий, знаки ∅ ° × ≈ ≤ ≥ и др.
 */
export const FONT_3D = `${import.meta.env.BASE_URL}fonts/deallsoft-3d.woff`;
