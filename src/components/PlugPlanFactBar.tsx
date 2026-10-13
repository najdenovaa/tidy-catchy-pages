/** Шкала «План / прогноз» положения моста: проектный интервал и ожидаемое положение после обмена жидкостями. */
interface Props {
  planTopMD: number;
  planBottomMD: number;
  /** Кровля по объёму с запасом на загрязнение */
  topByVolumeMD?: number;
  /** Оценочный «провал» цемента, м */
  fallM: number;
  padHeightM?: number;
  verdict: string;
}

export default function PlugPlanFactBar({ planTopMD, planBottomMD, topByVolumeMD, fallM, padHeightM = 0, verdict }: Props) {
  const L = Math.max(0, planBottomMD - planTopMD);
  const fall = Math.max(0, fallM);
  const washedOut = fall >= L;
  const top0 = Math.min(planTopMD, topByVolumeMD ?? planTopMD);
  const span = L + Math.max(fall, padHeightM) + L * 0.6 + 10;
  const z0 = top0 - span * 0.12, z1 = z0 + span;
  const H = 300, W = 300, pad = 18;
  const y = (md: number) => pad + ((md - z0) / (z1 - z0)) * (H - 2 * pad);
  const colX = [70, 190], colW = 56;
  const factTop = planTopMD + fall, factBot = planBottomMD + fall;
  const fmt = (v: number) => v.toFixed(0);
  const ok = fall < 0.5;

  const Col = ({ x, title, children }: { x: number; title: string; children: React.ReactNode }) => (
    <g>
      <text x={x + colW / 2} y={11} textAnchor="middle" className="fill-foreground" fontSize={11} fontWeight={600}>{title}</text>
      <rect x={x} y={pad} width={colW} height={H - 2 * pad} className="fill-amber-900/25 stroke-border" strokeWidth={1} />
      {children}
    </g>
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[320px] h-auto" role="img" aria-label="Положение моста: план и прогноз">
      <defs>
        <pattern id="mix-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" className="fill-slate-400/40" />
          <line x1="0" y1="0" x2="0" y2="6" className="stroke-slate-500" strokeWidth="2.5" />
        </pattern>
      </defs>
      <Col x={colX[0]} title="План">
        {padHeightM > 0 && <rect x={colX[0]} y={y(planBottomMD)} width={colW} height={y(planBottomMD + padHeightM) - y(planBottomMD)} className="fill-purple-400/60" />}
        <rect x={colX[0]} y={y(planTopMD)} width={colW} height={y(planBottomMD) - y(planTopMD)} className="fill-slate-400" />
        {topByVolumeMD !== undefined && topByVolumeMD < planTopMD - 0.5 && (
          <rect x={colX[0]} y={y(topByVolumeMD)} width={colW} height={y(planTopMD) - y(topByVolumeMD)} fill="url(#mix-hatch)" />
        )}
      </Col>
      <Col x={colX[1]} title="Прогноз">
        {padHeightM > 0 && <rect x={colX[1]} y={y(factBot)} width={colW} height={Math.max(0, y(planBottomMD + padHeightM + fall) - y(factBot))} className="fill-purple-400/60" />}
        {!washedOut && <rect x={colX[1]} y={y(factTop)} width={colW} height={y(factBot) - y(factTop)} className={ok ? "fill-slate-400" : "fill-slate-400/80"} />}
        {fall > 0.5 && (
          <rect x={colX[1]} y={y(planTopMD)} width={colW} height={y(washedOut ? factBot : factTop) - y(planTopMD)} fill="url(#mix-hatch)" />
        )}
      </Col>
      {/* Отметки глубин */}
      {[planTopMD, planBottomMD].map((md) => (
        <g key={`p${md}`}>
          <line x1={colX[0] - 6} x2={colX[0]} y1={y(md)} y2={y(md)} className="stroke-foreground" />
          <text x={colX[0] - 9} y={y(md) + 4} textAnchor="end" fontSize={10} className="fill-foreground">{fmt(md)}</text>
        </g>
      ))}
      {fall > 0.5 && !washedOut && [factTop, factBot].map((md) => (
        <g key={`f${md}`}>
          <line x1={colX[1] + colW} x2={colX[1] + colW + 6} y1={y(md)} y2={y(md)} className="stroke-destructive" />
          <text x={colX[1] + colW + 9} y={y(md) + 4} fontSize={10} className="fill-destructive">{fmt(md)}</text>
        </g>
      ))}
      {ok && [planTopMD, planBottomMD].map((md) => (
        <text key={`o${md}`} x={colX[1] + colW + 9} y={y(md) + 4} fontSize={10} className="fill-green-600">{fmt(md)}</text>
      ))}
      <line x1={colX[0] + colW} x2={colX[1]} y1={y(planTopMD)} y2={y(ok ? planTopMD : washedOut ? planTopMD : factTop)} className={ok ? "stroke-green-600" : "stroke-destructive"} strokeDasharray="3 3" />
      <text x={W / 2} y={H - 3} textAnchor="middle" fontSize={10} className={ok ? "fill-green-600" : "fill-destructive"}>
        {ok ? "мост останется на месте" : washedOut ? "мост размыт по стволу" : `кровля ниже плана на ~${fmt(fall)} м`} · {verdict}
      </text>
    </svg>
  );
}
