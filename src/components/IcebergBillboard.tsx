import "./IcebergBillboard.css";

/** The approved corner artwork is a still; no video controls until a real clip is supplied. */
export default function IcebergBillboard() {
  return (
    <aside className="iceberg-placement" aria-label="Реклама Айсберг">
      <a
        className="iceberg-billboard"
        href="https://igchem.ru/"
        target="_blank"
        rel="noopener noreferrer sponsored"
        aria-label="Айсберг — химия для цементирования. Открыть igchem.ru в новой вкладке"
      >
        <img
          className="iceberg-billboard__scene"
          src="/ads/iceberg-cementing.webp"
          width="1080"
          height="720"
          alt="Рабочий засыпает реагент IG FLice из белого мешка 20 кг в смесительную воронку на фоне буровой"
          fetchPriority="high"
          decoding="async"
        />
        <img
          className="iceberg-billboard__logo"
          src="/ads/iceberg-logo.webp"
          width="280"
          height="142"
          alt="Айсберг · IG chemical"
        />
        <span className="iceberg-billboard__caption">Реклама · Айсберг · igchem.ru</span>
      </a>
    </aside>
  );
}
