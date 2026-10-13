/** Шкала «План / прогноз» положения моста: проект и ожидаемое положение (обмен жидкостями, осложнения), отбивка по факту. */
interface Props {
  planTopMD: number;
  planBottomMD: number;
  /** Кровля по объёму с запасом на загрязнение */
  topByVolumeMD?: number;
  /** Прогноз: кровля и подошва чистого цемента */
  forecastTopMD: number;
  forecastBottomMD: number;
  /** Размыв подошвы «языками» цемента, м */
  bottomSmearM?: number;
  padHeightM?: number;
  /** Зона поглощения (при включённых осложнениях) */
  lossZone?: { topMD: number; thicknessM: number } | null;
  verdict: string;
  /** Фактическая отбивка кровли, м */
  factTagMD?: number;
}

export default function PlugPlanFactBar({ planTopMD, planBottomMD, topByVolumeMD, forecastTopMD, forecastBottomMD, bottomSmearM = 0, padHeightM = 0, lossZone, verdict, factTagMD }: Props) {
  const drop = Math.max(0, forecastTopMD - planTopMD);
  const washedOut = forecastBottomMD - forecastTopMD < 0.5;
  const zMin = Math.min(planTopMD, topByVolumeMD ?? planTopMD, factTagMD ?? Infinity);
  const zMaxRaw = Math.max(planBottomMD + padHeightM, forecastBottomMD + bottomSmearM, factTagMD ?? 0, lossZone ? lossZone.topMD + lossZone.thicknessM : 0);
  const span = Math.max(20, zMaxRaw - zMin);
  const z0 = zMin - span * 0.15, z1 = zMaxRaw + span * 0.15;
  const H = 300, W = 300, pad = 18;
  const y = (md: number) => pad + ((md - z0) / (z1 - z0)) * (H - 2 * pad);
  const colX = [70, 190], colW = 56;
  const fmt = (v: number) => v.toFixed(0);
  const ok = drop < 0.5 && bottomSmearM < 0.5;
  const rect = (x: number, a: number, b: number, cls: string, fill?: string) =>
    b - a > 0.01 ? <rect x={x} y={y(a)} width={colW} height={Math.max(1, y(b) - y(a))} className={cls} fill={fill} /> : null;

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
      {lossZone && (
        <g>
          <rect x={colX[0] - 4} y={y(lossZone.topMD)} width={colX[1] + colW - colX[0] + 8} height={Math.max(2, y(lossZone.topMD + lossZone.thicknessM) - y(lossZone.topMD))} className="fill-red-500/25" />
          <text x={colX[1] + colW + 9} y={y(lossZone.topMD) + 10} fontSize={9} className="fill-red-600">поглощение</text>
        </g>
      )}
      <Col x={colX[0]} title="План">
        {rect(colX[0], planBottomMD, planBottomMD + padHeightM, "fill-purple-400/60")}
        {rect(colX[0], planTopMD, planBottomMD, "fill-slate-400")}
        {topByVolumeMD !== undefined && topByVolumeMD < planTopMD - 0.5 && rect(colX[0], topByVolumeMD, planTopMD, "", "url(#mix-hatch)")}
      </Col>
      <Col x={colX[1]} title="Прогноз">
        {rect(colX[1], forecastBottomMD, forecastBottomMD + padHeightM, "fill-purple-400/60")}
        {!washedOut && rect(colX[1], forecastTopMD, forecastBottomMD, "fill-slate-400")}
        {drop > 0.5 && rect(colX[1], planTopMD, forecastTopMD, "", "url(#mix-hatch)")}
        {bottomSmearM > 0.5 && rect(colX[1], forecastBottomMD, forecastBottomMD + bottomSmearM, "", "url(#mix-hatch)")}
      </Col>
      {[planTopMD, planBottomMD].map((md) => (
        <g key={`p${md}`}>
          <line x1={colX[0] - 6} x2={colX[0]} y1={y(md)} y2={y(md)} className="stroke-foreground" />
          <text x={colX[0] - 9} y={y(md) + 4} textAnchor="end" fontSize={10} className="fill-foreground">{fmt(md)}</text>
        </g>
      ))}
      {[forecastTopMD, forecastBottomMD].map((md, i) => (
        <text key={`f${i}`} x={colX[1] + colW + 9} y={y(md) + 4} fontSize={10} className={ok ? "fill-green-600" : "fill-destructive"}>{fmt(md)}</text>
      ))}
      {factTagMD !== undefined && (
        <g>
          <line x1={colX[1] - 8} x2={colX[1] + colW + 8} y1={y(factTagMD)} y2={y(factTagMD)} className="stroke-blue-600" strokeWidth={2.5} />
          <text x={colX[1] - 10} y={y(factTagMD) - 4} textAnchor="end" fontSize={10} fontWeight={600} className="fill-blue-600">факт {fmt(factTagMD)}</text>
        </g>
      )}
      <line x1={colX[0] + colW} x2={colX[1]} y1={y(planTopMD)} y2={y(forecastTopMD)} className={ok ? "stroke-green-600" : "stroke-destructive"} strokeDasharray="3 3" />
      <text x={W / 2} y={H - 3} textAnchor="middle" fontSize={10} className={ok ? "fill-green-600" : drop > 0.5 ? "fill-destructive" : "fill-amber-600"}>
        {washedOut ? "мост размыт" : drop > 0.5 ? `кровля ниже плана на ~${drop.toFixed(1)} м` : bottomSmearM > 0.5 ? `кровля на месте, подошва размыта ~${fmt(bottomSmearM)} м` : "мост останется на месте"} · {verdict}
      </text>
    </svg>
  );
}
