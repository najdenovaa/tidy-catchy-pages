import { useLayoutEffect, useRef, useState } from "react";
import { recordAdBannerClick } from "@/lib/ad-banner-clicks";
import "./IcebergBillboard.css";

/** Decorative streams terminate at the existing module card; partner logos retain their links. */
export default function IcebergBillboard() {
  const placementRef = useRef<HTMLElement>(null);
  const [paths, setPaths] = useState<string[]>([]);

  useLayoutEffect(() => {
    const placement = placementRef.current;
    const stage = placement?.closest<HTMLElement>(".home-module-stage");
    const entry = stage?.querySelector<HTMLElement>("[data-cementing-entry]");
    if (!placement || !stage || !entry) return;

    const update = () => {
      const origin = stage.getBoundingClientRect();
      const target = entry.getBoundingClientRect();
      const scenes = placement.querySelectorAll<HTMLElement>(".iceberg-billboard");
      setPaths(Array.from(scenes, (scene, index) => {
        const rect = scene.getBoundingClientRect();
        const right = index === 1;
        const x = rect.left - origin.left + rect.width * (right ? .81 : .32);
        const y = rect.top - origin.top + rect.height * (right ? .49 : .65);
        const endX = target.left - origin.left + target.width * (right ? .82 : .18);
        const endY = target.top - origin.top + 2;
        const lane = endY - (right ? 18 : 10);
        // Bend below the scene and run above the cards, clear of the page heading.
        const outerX = right ? origin.width - 12 : 12;
        const shoulderX = outerX + (right ? -14 : 14);
        return [
          `M ${x} ${y}`,
          `C ${outerX} ${y + 18}, ${outerX} ${lane - 48}, ${outerX} ${lane - 14}`,
          `Q ${outerX} ${lane}, ${shoulderX} ${lane}`,
          `C ${shoulderX} ${lane}, ${endX} ${lane - 12}, ${endX} ${endY}`,
        ].join(" ");
      }));
    };
    update();
    const observer = new ResizeObserver(update);
    [stage, placement, entry].forEach(element => observer.observe(element));
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <>
      <svg className="cementing-streams" aria-hidden="true" focusable="false">
        {paths.map((d, index) => (
          <g key={index} className={`cementing-stream cementing-stream--${index}`}>
            <path className="cementing-stream__halo" d={d} />
            <path className="cementing-stream__line" d={d} />
            <path className="cementing-stream__pulse" d={d} />
          </g>
        ))}
      </svg>
      <aside ref={placementRef} className="iceberg-placement" aria-label="Химия и сервис цементирования">
        <a className="iceberg-billboard" href="https://igchem.ru/" target="_blank"
          onClick={() => recordAdBannerClick("iceberg")}
          onAuxClick={event => { if (event.button === 1) recordAdBannerClick("iceberg"); }}
          rel="noopener noreferrer sponsored" aria-label="Айсберг — химия и материалы для бурения и цементирования скважин. Открыть igchem.ru в новой вкладке">
          <img className="iceberg-billboard__scene" src="/ads/iceberg-cementing.webp" width="1080" height="720"
            alt="Рабочий засыпает реагент из мешка в смесительную воронку на буровой" fetchPriority="high" decoding="async" />
          <img className="iceberg-billboard__logo" src="/ads/iceberg-logo.webp" width="280" height="142" alt="Айсберг · IG chemical" />
          <span className="iceberg-billboard__caption">Химия и материалы для бурения и цементирования скважин</span>
        </a>
        <a className="iceberg-billboard sts-billboard" href="https://stskzn.com/" target="_blank"
          onClick={() => recordAdBannerClick("sts")}
          onAuxClick={event => { if (event.button === 1) recordAdBannerClick("sts"); }}
          rel="noopener noreferrer sponsored" aria-label="СпецТехСервис — сервисные услуги цементирования скважин. Открыть stskzn.com в новой вкладке">
          <svg className="iceberg-billboard__scene" viewBox="0 0 1080 720" role="img" aria-label="Цементировочный агрегат на трёхосном шасси КамАЗ на буровой">
            <defs>
              <mask id="sts-corner-mask" style={{ maskType: "alpha" }}>
                <image href="/ads/iceberg-cementing.webp" width="1080" height="720" transform="translate(1080 0) scale(-1 1)" />
              </mask>
            </defs>
            <image href="/ads/sts-cementing-v2.webp" x="240" y="-28" width="840" height="560" mask="url(#sts-corner-mask)" />
          </svg>
          <img className="sts-billboard__logo" src="/ads/sts-logo.png" width="492" height="117" alt="СпецТехСервис" />
          <span className="iceberg-billboard__caption">Сервисные услуги цементирования скважин</span>
        </a>
      </aside>
    </>
  );
}
