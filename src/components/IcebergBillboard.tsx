import { Link } from "react-router-dom";
import "./IcebergBillboard.css";

/** Partner links stay separate from the entry to the calculation module. */
export default function IcebergBillboard() {
  return (
    <aside className="iceberg-placement" aria-label="Химия и сервис цементирования">
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
          alt="Рабочий засыпает реагент из мешка в смесительную воронку на буровой"
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

      <div className="cementing-connection" aria-hidden="true">
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none">
          <path className="cementing-connection__pipe" d="M0 26 H440 Q465 26 465 51 V70 H535 V51 Q535 26 560 26 H1000" />
          <path className="cementing-connection__flow" d="M1000 26 H560 Q535 26 535 51 V70 H465 V51 Q465 26 440 26 H0" />
        </svg>
      </div>

      <a
        className="iceberg-billboard sts-billboard"
        href="https://stskzn.com/"
        target="_blank"
        rel="noopener noreferrer sponsored"
        aria-label="ООО Спецтехсервис — цементирование скважин. Открыть stskzn.com в новой вкладке"
      >
        <img
          className="iceberg-billboard__scene"
          src="/ads/sts-cementing.png"
          width="1536"
          height="1024"
          alt="Цементировочный агрегат с красным насосным оборудованием на буровой"
          decoding="async"
        />
        <span className="sts-billboard__brand">
          <strong>ООО «Спецтехсервис»</strong>
          <span>Цементирование скважин</span>
        </span>
        <span className="iceberg-billboard__caption">Реклама · stskzn.com</span>
      </a>

      <Link className="cementing-entry" to="/cementing" aria-label="Открыть программу цементирования">
        <svg className="cementing-entry__hopper" viewBox="0 0 120 90" aria-hidden="true">
          <defs>
            <linearGradient id="cementing-hopper-steel">
              <stop offset="0" stopColor="#64748b" />
              <stop offset=".3" stopColor="#e2e8f0" />
              <stop offset=".5" stopColor="#f8fafc" />
              <stop offset=".75" stopColor="#94a3b8" />
              <stop offset="1" stopColor="#475569" />
            </linearGradient>
          </defs>
          <path d="M12 18 H108 L70 64 V84 H50 V64 Z" fill="url(#cementing-hopper-steel)" stroke="#64748b" strokeWidth="2" />
          <ellipse cx="60" cy="18" rx="48" ry="9" fill="#475569" stroke="#cbd5e1" strokeWidth="3" />
          <ellipse cx="60" cy="18" rx="40" ry="5" fill="#94a3b8" />
          <path d="M47 71 H73" stroke="#64748b" strokeWidth="4" />
        </svg>
        <span>Цементирование</span>
        <small>Открыть программу</small>
      </Link>
    </aside>
  );
}
