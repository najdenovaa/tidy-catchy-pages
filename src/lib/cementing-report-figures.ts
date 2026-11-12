import { allowedReportFigure, type ReportScope, type ReportSelection, type ReportItem } from "./cementing-report-options";
import { reportSeriesPlot } from "./report-series-plot";
import { calculateCasingRunning, normalizeRunningSettings } from "./casing-running-analysis";
import { runningBroomSVG } from "./casing-running-plot";
import { centralizerShape, bladeCurve, bladeSection, bladeRadius, displayCentralizerPoint } from "./centralizer-shape";
import * as THREE from "three";
import { centralizerMesh, surveyTransform, type Vec3 } from "./centralizer-mesh";
import { pathPoints, frames } from "./displacement-geometry";
import { centralizerReportSamples } from "./cementing-report-sections";
import { getEffectiveTrajectory, type WellData, type SlurryInput } from "./cementing-calculations";
import type { CementingReportExtras, ReportFigure } from "./cementing-report-data";
export interface ReportSvg { reportItem?: ReportItem; title: string; svg: string; width: number; height: number; }
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
interface Polygon { v: number[][]; color: string; opacity?: number; }
function sceneSvg(title: string, polygons: Polygon[], width: number, height: number, lines: number[][][] = [], boreLines:number[][][] = []) {
  const points = [...polygons.flatMap(x => x.v), ...lines.flat(), ...boreLines.flat()];
  const xs = points.map(x => x[0]), ys = points.map(x => x[1]);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const scale = Math.min((width - 70) / Math.max(1e-6, Math.max(...xs) - Math.min(...xs)),
    (height - 110) / Math.max(1e-6, Math.max(...ys) - Math.min(...ys)));
  const at = (a: number[]) => [(width / 2 + (a[0] - cx) * scale).toFixed(2), (height / 2 - (a[1] - cy) * scale).toFixed(2)].join(",");
  const sorted = polygons.slice().sort((a, b) => a.v.reduce((s, v) => s + v[2], 0) / a.v.length - b.v.reduce((s, v) => s + v[2], 0) / b.v.length);
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height +
    '"><rect width="100%" height="100%" fill="#101b2c"/><text x="24" y="28" fill="#e2e8f0" font-size="15" font-family="sans-serif">' + esc(title) + '</text>' +
    sorted.map(x => '<polygon points="' + x.v.map(at).join(" ") + '" fill="' + x.color + '" stroke="' + x.color + '" stroke-width=".3" opacity="' + (x.opacity ?? 1) + '"/>').join("") +
    boreLines.map(v => '<polyline points="' + v.map(at).join(" ") + '" fill="none" stroke="#94a3b8" opacity=".75" stroke-width="1.2"/>').join("") +
    lines.map(v => '<polyline points="' + v.map(at).join(" ") + '" fill="none" stroke="#38bdf8" stroke-width="1" stroke-dasharray="6 4"/>').join("") +
    '<text x="24" y="' + (height - 22) + '" fill="#cbd5e1" font-size="12" font-family="sans-serif">Расчётный 3D-вид; радиальные размеры увеличены для наглядности</text></svg>';
}
export function buildCementingReportSvgs(w: WellData, extras: CementingReportExtras, scope:ReportScope="cementing", selection?:ReportSelection): ReportSvg[] {
  const images: ReportSvg[] = [];
  const c=extras.centralization;
  if(scope==='running'&&c?.running){
    const settings=normalizeRunningSettings(w.runningSettings,c.running.frictionCased,c.running.frictionOpenhole);
    const a=calculateCasingRunning({well:w,intervals:c.intervals,turbPoints:c.turbPoints,...c.running,settings});
    if(a.valid){images.push(reportSeriesPlot('Профиль осевых сил по колонне','forceProfile',a.profile.map(p=>p.md),'MD сечения, м','Осевое усилие, кН',[{name:'Спуск',color:'#15803d',values:a.profile.map(p=>p.runInKN)},{name:'Подъём',color:'#dc2626',values:a.profile.map(p=>p.pullOutKN)}]),reportSeriesPlot('Момент при спуске: сухое вращение','torque',a.broom.map(p=>p.md),'Глубина башмака MD, м','Момент, кН·м',[{name:'Сухое трение при вращении',color:'#7c3aed',values:a.broom.map(p=>p.torqueKNm)}]));}
    if(a.valid)images.push({title:"Спуск колонны: веник по глубине башмака",svg:runningBroomSVG(a,settings),width:820,height:510});
  }
  if(scope==='centralization'&&extras.centralization?.results.length)images.push(reportSeriesPlot('Профиль Standoff на опорах и в пролёте','standoff',extras.centralization.results.map(p=>p.md),'MD, м','Standoff, %',[{name:'В пролёте',color:'#dc2626',values:extras.centralization.results.map(p=>p.standoff)},{name:'На опоре',color:'#0284c7',values:extras.centralization.results.map(p=>100*(1-(p.supportEccentricity??p.eccentricity)))}]));
  if (scope==='centralization'&&extras.centralization) for (const s of centralizerReportSamples(w, extras.centralization)) {
    if (!s.geometry) continue;
    const g = centralizerShape(s.spec,w.casingOD,s.bore,s.result.supportEccentricity ?? s.result.eccentricity)! , gain = 6;
    const camera = (v: Vec3) => {
      const world = surveyTransform(displayCentralizerPoint(g,v,gain), s.result.zenith, s.azimuth);
      const a = -s.azimuth * Math.PI / 180, p = 12 * Math.PI / 180;
      const rx = world[0] * Math.cos(a) - world[1] * Math.sin(a), ry = world[0] * Math.sin(a) + world[1] * Math.cos(a);
      return [rx, world[2] * Math.cos(p) - ry * Math.sin(p), ry * Math.cos(p) + world[2] * Math.sin(p)];
    };
    const polygons = centralizerMesh(s.spec, w.casingOD, w.casingOD - 2 * w.casingWall, s.bore,
      s.result.supportEccentricity ?? s.result.eccentricity, 0).map(face => {
      const v = face.points.map(camera), a = new THREE.Vector3().fromArray(v[0]), b = new THREE.Vector3().fromArray(v[1]), c = new THREE.Vector3().fromArray(v[2]);
      const n = b.sub(a).cross(c.sub(a)).normalize(), light = Math.abs(n.dot(new THREE.Vector3(-.45, .45, .77)));
      const grey = Math.round(65 + 130 * light);
      return { v, opacity: face.part === "pipe" ? .18 : 1, color: face.kind === "red" ? "rgb(" + Math.round(130 + 115 * light) + ",20,38)" :
        face.kind === "edge" ? "rgb(52,66,82)" : "rgb(" + grey + "," + (grey + 5) + "," + Math.min(255, grey + 13) + ")" };
    });
    const free = g.blades.map(b => bladeCurve(g,b,'free').map(camera));
    const boreLines:number[][][]=[-.8,.8].map(z=>Array.from({length:65},(_,i)=>camera([g.boreRadius*Math.cos(i*Math.PI/32),g.boreRadius*Math.sin(i*Math.PI/32),z*g.length])));
    for(let i=0;i<4;i++){const a=i*Math.PI/2;boreLines.push([camera([g.boreRadius*Math.cos(a),g.boreRadius*Math.sin(a),-.8*g.length]),camera([g.boreRadius*Math.cos(a),g.boreRadius*Math.sin(a),.8*g.length])]);}
    const title = "Центратор на MD " + s.result.md.toFixed(1) + " м; зенит " + s.result.zenith.toFixed(1) + "°; прогиб ×6";
    images.push({ title, width: 720, height: 650, svg: sceneSvg(title, polygons, 720, 650, free, boreLines) });
    const scale = 120 / g.boreRadius, cy = 175, cx = 260;
    const bladeLines = g.blades.map(b => {
      const points=(state:'loaded'|'free')=>bladeSection(g,b,state).map(v=>(cx-v[1]*scale).toFixed(2)+','+(cy+v[0]*scale).toFixed(2)).join(' ');
      return '<polygon points="'+points('free')+'" fill="none" stroke="#0891b2" stroke-dasharray="4 3"/>'+ '<polygon points="'+points('loaded')+'" fill="#df1739" stroke="#df1739"/>';
    }).join("");
    images.push({ title: "Сечение через вершины рессор, MD " + s.result.md.toFixed(1) + " м", width: 720, height: 390,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="390"><rect width="720" height="390" fill="#fff"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="120" fill="#e2e8f0" stroke="#64748b"/>' +
        '<circle cx="' + cx + '" cy="' + (cy + g.offset * scale) + '" r="' + (g.pipeRadius * scale) + '" fill="#334155"/>' + bladeLines +
        '<text x="430" y="100" font-family="sans-serif" font-size="15">Зазоры труба-стенка:</text><text x="430" y="130" font-family="sans-serif" font-size="17">' +
        g.minPipeGap.toFixed(2) + ' / ' + g.maxPipeGap.toFixed(2) + ' мм</text><text x="430" y="175" font-family="sans-serif" font-size="15">Смещение ' + g.offset.toFixed(2) +
        ' мм</text><text x="24" y="355" font-family="sans-serif" font-size="13">Размеры сечения в одном масштабе. Значения по каждой рессоре - в таблице.</text></svg>' });
    if(g.spring){
      const b=g.blades.reduce((a,b)=>a.compression>b.compression?a:b);
      const curve=(state:'free'|'installed'|'loaded')=>Array.from({length:65},(_,i)=>(40+i/64*620).toFixed(2)+','+(255-(bladeRadius(g,b,i/64,state)-g.pipeRadius)*185/Math.max(1,b.freeRadius-g.pipeRadius)).toFixed(2)).join(' ');
      images.push({title:'Продольный профиль планки '+b.index+', MD '+s.result.md+' м',width:720,height:370,svg:'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="370"><rect width="720" height="370" fill="white"/><rect x="30" y="257" width="640" height="10" fill="#64748b"/>'+ ['free','installed','loaded'].map((state,i)=>'<polyline points="'+curve(state as 'free'|'installed'|'loaded')+'" fill="none" stroke="'+['#0891b2','#94a3b8','#e11d48'][i]+'" stroke-width="3"'+(i<2?' stroke-dasharray="6 4"':'')+'/>').join('')+'<text x="30" y="28" font-size="15" font-family="sans-serif">Свободная / монтажная / нагруженная форма планки '+b.index+'</text><text x="30" y="300" font-size="13" font-family="sans-serif">Монтаж: '+b.mountingCompression.toFixed(2)+' мм; от нагрузки: '+b.loadCompression.toFixed(2)+' мм; всего: '+b.compression.toFixed(2)+' мм</text><text x="30" y="335" font-size="12" font-family="sans-serif">Осевой и поперечный масштабы различаются для наглядности.</text></svg>'});
    }

  }
  const data = scope==='cementing'?extras.displacement:undefined;
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
  return images.filter(figure=>allowedReportFigure(scope,selection,figure));
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
      out.push({ reportItem:x.reportItem, title: x.title, dataUrl: canvas.toDataURL("image/png"), width: x.width, height: x.height });
    } finally { URL.revokeObjectURL(url); }
  }
  return out;
}

export { pvtHydrostaticReportCharts as buildPvtHydrostaticReportSvgs,stopStorageReportCharts as buildStopStorageReportSvgs,hydraulicReportCharts as buildHydraulicReportSvgs, depthReportCharts as buildDepthPressureReportSvgs } from './cementing-report-charts';

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

export function buildBasketStopReportSvgs(result: import('./cement-basket-stop').BasketStopResult | undefined): ReportSvg[] {
 if(!result?.rows.length)return [];
 const maxP=Math.max(1,...result.rows.map(r=>r.withoutMPa))*1.05,depth=Math.max(1,...result.rows.map(r=>r.md));
 const X=(p:number)=>75+p/maxP*570,Y=(d:number)=>65+d/depth*360;
 const line=(key:'withoutMPa'|'scenarioMPa',color:string,dash='')=>'<polyline fill="none" stroke="'+color+'" stroke-width="2" '+dash+' points="'+result.rows.map(r=>X(r[key]).toFixed(2)+','+Y(r.md).toFixed(2)).join(' ')+'"/>';
 return [{title:'Корзина: полный столб и сценарий через '+result.elapsedMin+' мин после Стоп',width:720,height:520,svg:'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="520"><rect width="720" height="520" fill="white"/><text x="24" y="25" font-family="sans-serif" font-size="15">Полная гидростатика / сценарная передача нагрузки</text><text x="24" y="48" fill="#2563eb" font-family="sans-serif" font-size="12">Синий: без разгрузки</text><text x="300" y="48" fill="#ea580c" font-family="sans-serif" font-size="12">Пунктир: сценарий после Стоп</text>'+Array.from({length:6},(_,i)=>'<line x1="75" x2="645" y1="'+Y(depth*i/5)+'" y2="'+Y(depth*i/5)+'" stroke="#dbe3ec"/><text x="15" y="'+(Y(depth*i/5)+4)+'" font-family="sans-serif" font-size="11">'+(depth*i/5).toFixed(0)+'</text><text x="'+X(maxP*i/5)+'" y="448" font-family="sans-serif" font-size="11">'+(maxP*i/5).toFixed(1)+'</text>').join('')+line('withoutMPa','#2563eb')+line('scenarioMPa','#ea580c','stroke-dasharray="6 4"')+'<text x="265" y="475" font-family="sans-serif" font-size="12">Давление, МПа; глубина MD, м</text><text x="24" y="502" font-family="sans-serif" font-size="11">Сценарий не уменьшает давление в основных проверках ГРП.</text></svg>'}];
}
