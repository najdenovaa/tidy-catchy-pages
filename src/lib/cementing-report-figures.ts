import * as THREE from "three";
import { centralizerMesh, surveyTransform, type Vec3 } from "./centralizer-mesh";
import { pathPoints, frames } from "./displacement-geometry";
import { centralizerReportSamples } from "./cementing-report-sections";
import { getEffectiveTrajectory, type WellData, type SlurryInput } from "./cementing-calculations";
import type { CementingReportExtras, ReportFigure } from "./cementing-report-data";
export interface ReportSvg { title: string; svg: string; width: number; height: number; }
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
interface Polygon { v: number[][]; color: string; }
function sceneSvg(title: string, polygons: Polygon[], width: number, height: number, lines: number[][][] = []) {
  const points = [...polygons.flatMap(x => x.v), ...lines.flat()];
  const xs = points.map(x => x[0]), ys = points.map(x => x[1]);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const scale = Math.min((width - 70) / Math.max(1e-6, Math.max(...xs) - Math.min(...xs)),
    (height - 110) / Math.max(1e-6, Math.max(...ys) - Math.min(...ys)));
  const at = (a: number[]) => [(width / 2 + (a[0] - cx) * scale).toFixed(2), (height / 2 - (a[1] - cy) * scale).toFixed(2)].join(",");
  const sorted = polygons.slice().sort((a, b) => a.v.reduce((s, v) => s + v[2], 0) / a.v.length - b.v.reduce((s, v) => s + v[2], 0) / b.v.length);
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height +
    '"><rect width="100%" height="100%" fill="#101b2c"/><text x="24" y="28" fill="#e2e8f0" font-size="15" font-family="sans-serif">' + esc(title) + '</text>' +
    sorted.map(x => '<polygon points="' + x.v.map(at).join(" ") + '" fill="' + x.color + '" stroke="' + x.color + '" stroke-width=".3"/>').join("") +
    lines.map(v => '<polyline points="' + v.map(at).join(" ") + '" fill="none" stroke="#38bdf8" stroke-width="1" stroke-dasharray="6 4"/>').join("") +
    '<text x="24" y="' + (height - 22) + '" fill="#cbd5e1" font-size="12" font-family="sans-serif">Расчётный 3D-вид; радиальные размеры увеличены для наглядности</text></svg>';
}
export function buildCementingReportSvgs(w: WellData, extras: CementingReportExtras): ReportSvg[] {
  const images: ReportSvg[] = [];
  if (extras.centralization) for (const s of centralizerReportSamples(w, extras.centralization)) {
    if (!s.geometry) continue;
    const g = s.geometry, gain = 4;
    const camera = (v: Vec3) => {
      const x = v[0] - g.offset, y = v[1], r = Math.hypot(x, y);
      const rr = r <= g.pipeRadius ? r : g.pipeRadius + (r - g.pipeRadius) * gain;
      const world = surveyTransform([g.offset * gain + (r ? x * rr / r : 0), r ? y * rr / r : 0, v[2]], s.result.zenith, s.azimuth);
      const a = -s.azimuth * Math.PI / 180, p = 12 * Math.PI / 180;
      const rx = world[0] * Math.cos(a) - world[1] * Math.sin(a), ry = world[0] * Math.sin(a) + world[1] * Math.cos(a);
      return [rx, world[2] * Math.cos(p) - ry * Math.sin(p), ry * Math.cos(p) + world[2] * Math.sin(p)];
    };
    const polygons = centralizerMesh(s.spec, w.casingOD, w.casingOD - 2 * w.casingWall, s.bore,
      s.result.supportEccentricity ?? s.result.eccentricity, 0).map(face => {
      const v = face.points.map(camera), a = new THREE.Vector3().fromArray(v[0]), b = new THREE.Vector3().fromArray(v[1]), c = new THREE.Vector3().fromArray(v[2]);
      const n = b.sub(a).cross(c.sub(a)).normalize(), light = Math.abs(n.dot(new THREE.Vector3(-.45, .45, .77)));
      const grey = Math.round(65 + 130 * light);
      return { v, color: face.kind === "red" ? "rgb(" + Math.round(130 + 115 * light) + ",20,38)" :
        face.kind === "edge" ? "rgb(52,66,82)" : "rgb(" + grey + "," + (grey + 5) + "," + Math.min(255, grey + 13) + ")" };
    });
    const free = g.blades.map(b => Array.from({ length: 41 }, (_, i) => {
      const t = i / 40, ring = (s.spec.passport?.ringOD ?? w.casingOD + 6) / 2;
      const r = ring + (b.freeRadius - ring) * Math.sin(Math.PI * t);
      return camera([g.offset + r * Math.cos(b.angle), r * Math.sin(b.angle), (t - .5) * (s.spec.passport?.springLength ?? g.length * .72)]);
    }));
    const title = "Центратор на MD " + s.result.md.toFixed(1) + " м; зенит " + s.result.zenith.toFixed(1) + "°; прогиб ×4";
    images.push({ title, width: 720, height: 650, svg: sceneSvg(title, polygons, 720, 650, free) });
    const scale = 120 / g.boreRadius, cy = 175, cx = 260;
    const bladeLines = g.blades.map(b => {
      const x = cx + (g.offset + b.loadedRadius * Math.cos(b.angle)) * scale, y = cy + b.loadedRadius * Math.sin(b.angle) * scale;
      return '<line x1="' + (cx + (g.offset + g.pipeRadius * Math.cos(b.angle)) * scale) + '" y1="' + (cy + g.pipeRadius * Math.sin(b.angle) * scale) +
        '" x2="' + x + '" y2="' + y + '" stroke="#df1739" stroke-width="5"/>';
    }).join("");
    images.push({ title: "Сечение через вершины рессор, MD " + s.result.md.toFixed(1) + " м", width: 720, height: 390,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="390"><rect width="720" height="390" fill="#fff"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="120" fill="#e2e8f0" stroke="#64748b"/>' + bladeLines +
        '<circle cx="' + (cx + g.offset * scale) + '" cy="' + cy + '" r="' + (g.pipeRadius * scale) + '" fill="#334155"/>' +
        '<text x="430" y="100" font-family="sans-serif" font-size="15">Зазоры труба-стенка:</text><text x="430" y="130" font-family="sans-serif" font-size="17">' +
        g.minPipeGap.toFixed(2) + ' / ' + g.maxPipeGap.toFixed(2) + ' мм</text><text x="430" y="175" font-family="sans-serif" font-size="15">Смещение ' + g.offset.toFixed(2) +
        ' мм</text><text x="24" y="355" font-family="sans-serif" font-size="13">Размеры сечения в одном масштабе. Значения по каждой рессоре - в таблице.</text></svg>' });
  }
  const data = extras.displacement;
  if (data?.result.snapshots.length) {
    const r = data.result, n = r.nTheta * r.nZ;
    const indices = [...new Set([Math.round(r.pumpEndSnap / 2), r.pumpEndSnap, r.snapshots.length - 1])];
    const ptsRaw = pathPoints(getEffectiveTrajectory(w), Array.from(r.zCenters));
    const origin = ptsRaw[0].clone(), span = Math.max(1, r.zCenters[r.nZ - 1] - r.zCenters[0]);
    const pts = ptsRaw.map(p => p.clone().sub(origin).multiplyScalar(10 / span)), fr = frames(pts);
    const mid = Math.floor(r.nZ / 2), look = fr.B[mid].clone().add(fr.N[mid].clone().multiplyScalar(.25)).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), look).normalize();
    if (right.length() < .1) right.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(look, right).normalize();
    const camera = (p: THREE.Vector3) => [p.dot(right), p.dot(up), p.dot(look)];
    for (const index of indices) {
      const snap = r.snapshots[index], polygons: Polygon[] = [];
      const step = Math.max(1, Math.floor(r.nZ / 100)), seg = 48;
      const color = (j: number, theta: number) => {
        const a = theta <= Math.PI || r.full ? theta : 2 * Math.PI - theta;
        const i = Math.min(r.nTheta - 1, Math.floor(a / (r.full ? 2 * Math.PI : Math.PI) * r.nTheta));
        let red = 0, green = 0, blue = 0, sum = 0;
        r.fluids.forEach((_, f) => {
          const v = snap.frac[f * n + j * r.nTheta + i], hex = data.meta.colors[f] || "#64748b";
          red += v * parseInt(hex.slice(1, 3), 16); green += v * parseInt(hex.slice(3, 5), 16); blue += v * parseInt(hex.slice(5, 7), 16); sum += v;
        });
        return sum ? "rgb(" + [red, green, blue].map(x => Math.round(x / sum)).join(",") + ")" : "#94a3b8";
      };
      for (let j = 0; j < r.nZ - 1; j += step) {
        const k = Math.min(r.nZ - 1, j + step);
        for (let i = 0; i < seg; i++) {
          const a = i * 2 * Math.PI / seg, b = (i + 1) * 2 * Math.PI / seg;
          const vertex = (z: number, angle: number, radius: number, casing: boolean) => camera(pts[z].clone()
            .addScaledVector(fr.N[z], radius * Math.cos(angle) - (casing ? (1 - (r.rows[z]?.standoff ?? 1)) * .35 * .95 : 0))
            .addScaledVector(fr.B[z], radius * Math.sin(angle)));
          if (!((a + b) / 2 > .32 * Math.PI && (a + b) / 2 < .68 * Math.PI))
            polygons.push({ v: [vertex(j, a, .85, false), vertex(j, b, .85, false), vertex(k, b, .85, false), vertex(k, a, .85, false)], color: color(j, (a + b) / 2) });
          polygons.push({ v: [vertex(j, a, .5, true), vertex(j, b, .5, true), vertex(k, b, .5, true), vertex(k, a, .5, true)], color: "#718096" });
        }
      }
      const title = "Замещение: 3D-кадр t=" + (snap.t / 60).toFixed(1) + " мин" + (index === r.pumpEndSnap ? ", конец продавки" : index === r.snapshots.length - 1 ? ", итог" : "");
      images.push({ title, width: 720, height: 820, svg: sceneSvg(title, polygons, 720, 820) });
      // Full unwrapped composition map, generated from the very same snapshot.
      const stride = Math.max(1, Math.floor(r.nZ / 150)), cells: string[] = [];
      for (let j = 0; j < r.nZ; j += stride) for (let i = 0; i < r.nTheta; i++)
        cells.push('<rect x="' + (40 + i * 640 / r.nTheta) + '" y="' + (45 + j * 690 / r.nZ) + '" width="' + (640 / r.nTheta + .4) +
          '" height="' + (690 * stride / r.nZ + .4) + '" fill="' + color(j, (i + .5) / r.nTheta * (r.full ? 2 * Math.PI : Math.PI)) + '"/>');
      images.push({ title: "Карта состава: t=" + (snap.t / 60).toFixed(1) + " мин", width: 720, height: 800,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="800"><rect width="720" height="800" fill="white"/><text x="25" y="25" font-family="sans-serif" font-size="14">' +
          esc(title) + '</text>' + cells.join("") + '<text x="40" y="765" font-family="sans-serif" font-size="13">Сверху вниз: MD ' + r.zCenters[0].toFixed(0) +
          '-' + r.zCenters[r.nZ - 1].toFixed(0) + ' м; слева направо - угол по окружности</text></svg>' });
    }
  }
  return images;
}
export async function rasterizeReportSvgs(images: ReportSvg[]): Promise<ReportFigure[]> {
  const out: ReportFigure[] = [];
  for (const x of images) {
    const url = URL.createObjectURL(new Blob([x.svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Не удалось подготовить " + x.title)); image.src = url; });
      const canvas = document.createElement("canvas"); canvas.width = x.width * 2; canvas.height = x.height * 2;
      const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Недоступен экспорт изображений");
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      out.push({ title: x.title, dataUrl: canvas.toDataURL("image/png"), width: x.width, height: x.height });
    } finally { URL.revokeObjectURL(url); }
  }
  return out;
}

export function buildHydraulicReportSvgs(points: { time: number; surfacePressure: number; bottomholePressure: number; fracturePressure: number; pumpRateLps: number }[]): ReportSvg[] {
  if (!points.length) return [];
  const chart = (title: string, unit: string, series: { name: string; color: string; values: number[] }[]) => {
    const maxT = Math.max(1, ...points.map(p => p.time));
    const maxY = Math.max(1, ...series.flatMap(s => s.values.filter(Number.isFinite))) * 1.08;
    const X = (t: number) => 65 + t / maxT * 620, Y = (v: number) => 335 - v / maxY * 255;
    return { title, width: 720, height: 420, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420"><rect width="720" height="420" fill="white"/>' +
      '<text x="25" y="25" font-family="sans-serif" font-size="16">' + esc(title) + '</text>' +
      Array.from({ length: 6 }, (_, i) => '<line x1="65" x2="685" y1="' + Y(maxY * i / 5) + '" y2="' + Y(maxY * i / 5) +
        '" stroke="#dbe3ec"/><text x="12" y="' + (Y(maxY * i / 5) + 4) + '" font-family="sans-serif" font-size="11">' +
        (maxY * i / 5).toFixed(1) + '</text><text x="' + X(maxT * i / 5) + '" y="355" font-family="sans-serif" font-size="11">' +
        (maxT * i / 5).toFixed(0) + '</text>').join("") +
      series.map((s, j) => '<text x="' + (25 + j * 230) + '" y="55" fill="' + s.color + '" font-family="sans-serif" font-size="12">' + esc(s.name) +
        '</text><polyline fill="none" stroke="' + s.color + '" stroke-width="2" points="' +
        s.values.map((y, i) => Number.isFinite(y) ? X(points[i].time).toFixed(1) + "," + Y(y).toFixed(1) : "").join(" ") + '"/>').join("") +
      '<text x="280" y="395" font-family="sans-serif" font-size="12">Время, мин; значения ' + esc(unit) + '</text></svg>' };
  };
  return [
    chart("Давления в ходе цементирования", "МПа", [
      { name: "Устье", color: "#4f46e5", values: points.map(p => p.surfacePressure) },
      { name: "Забой", color: "#0284c7", values: points.map(p => p.bottomholePressure) },
      { name: "Граница ГРП", color: "#e11d48", values: points.map(p => p.fracturePressure) },
    ]),
    chart("Расход закачки по времени", "л/с", [{ name: "Подача", color: "#0284c7", values: points.map(p => p.pumpRateLps) }]),
  ];
}

export function buildWellReportSvgs(w: WellData, slurries: SlurryInput[]): ReportSvg[] {
  const traj = getEffectiveTrajectory(w), depth = Math.max(1, w.casingDepthMD);
  const points = pathPoints(traj, Array.from({ length: 121 }, (_, i) => i * depth / 120));
  const v = points.map(x => [x.x * .82 + x.z * .57, x.y * .94 + x.x * .18 - x.z * .26, x.z]);
  const xy = v.reduce((r, x) => [Math.min(r[0], x[0]), Math.max(r[1], x[0]), Math.min(r[2], x[1]), Math.max(r[3], x[1])],
    [Infinity, -Infinity, Infinity, -Infinity]);
  const scale = Math.min(580 / Math.max(1, xy[1] - xy[0]), 500 / Math.max(1, xy[3] - xy[2]));
  const at = (x: number[]) => [360 + (x[0] - (xy[0] + xy[1]) / 2) * scale, 320 - (x[1] - (xy[2] + xy[3]) / 2) * scale];
  const poly = v.map(x => at(x).map(n => n.toFixed(1)).join(",")).join(" ");
  const mdY = (md: number) => 70 + Math.max(0, Math.min(depth, md)) / depth * 510;
  const wrap = (title: string, body: string) => ({ title, width: 720, height: 650,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="650"><rect width="720" height="650" fill="#fff"/>' +
      '<text x="24" y="28" font-family="sans-serif" font-size="17">' + esc(title) + '</text>' + body + '</svg>' });
  const text = (x: number, y: number, s: string) => '<text x="' + x + '" y="' + y + '" font-family="sans-serif" font-size="14" fill="#223349">' + esc(s) + '</text>';
  return [
    wrap("Траектория ствола: объёмная проекция", '<polyline points="' + poly + '" fill="none" stroke="#0b4574" stroke-width="5"/>' +
      [0, 30, 60, 90, 120].map(i => { const [x, y] = at(v[i]); return '<circle cx="' + x + '" cy="' + y + '" r="4" fill="#e11d48"/>' + text(x + 9, y - 5, (depth * i / 120).toFixed(0) + " м MD"); }).join("") +
      text(24, 620, traj.length > 2 ? "Положение построено по инклинометрии." : "Положение построено по принятой траектории расчёта.")),
    wrap("Конструкция и проектные интервалы цемента", '<rect x="190" y="70" width="220" height="510" fill="#e9dccb" stroke="#64748b"/>' +
      '<rect x="215" y="70" width="170" height="' + (mdY(w.prevCasingDepth) - 70) + '" fill="#d8e4f0" stroke="#64748b"/>' +
      slurries.map((s, i) => { const top = mdY(s.topDepthMD), bottom = mdY(slurries[i + 1]?.topDepthMD ?? depth);
        return '<rect x="225" y="' + top + '" width="150" height="' + Math.max(0, bottom - top) + '" fill="' + (i % 2 ? "#aab9ca" : "#b8c5d1") + '"/>';
      }).join("") +
      '<rect x="265" y="70" width="70" height="510" fill="#f8fafc" stroke="#24394e" stroke-width="5"/>' +
      text(425, 76, "ОК Ø" + w.casingOD + " мм") + text(425, 102, "Ствол Ø" + w.holeDiameter + " мм") +
      text(425, 130, "Пред. колонна: " + w.prevCasingDepth.toFixed(0) + " м") +
      text(425, 158, "ЦКОД: " + w.ckodDepth.toFixed(0) + " м") + text(425, 580, "Башмак: " + depth.toFixed(0) + " м") +
      text(24, 620, "Глубины по стволу (MD). Радиальные размеры условные.")),
  ];
}
