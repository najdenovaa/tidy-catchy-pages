import type { FleetEquipment, LogisticsResult, LogisticsSettings } from './cement-logistics';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const WIDTH = 1320, CARD_WIDTH = 394, START_Y = 320;
const COLORS = { water: '#0284c7', cement: '#dc2626', dry: '#a16207', skc: '#15803d', reserve: '#64748b' };
const columns = [['bulk', 'mixer', 'water', 'averaging'], ['main', 'support-ca', 'manifold'], ['skc', 'reserve-ca']];
const cardHeight = (count: number) => 88 + Math.ceil(count / 3) * 116;
function placement(r: LogisticsResult) {
  const placed: { row: FleetEquipment; x: number; y: number; height: number }[] = [];
  // Every selected row and every actual unit is represented, including future vehicle types.
  const known = new Set(columns.flat());
  const lanes = columns.map((ids, col) => col === 0 ? [...ids, ...r.equipment.filter(e => !known.has(e.id)).map(e => e.id)] : ids);
  lanes.forEach((ids, col) => {
    let y = START_Y;
    ids.forEach(id => {
      const row = r.equipment.find(e => e.id === id && e.count > 0);
      if (!row) return;
      const height = cardHeight(row.count);
      placed.push({ row, x: 24 + col * 436, y, height });
      y += height + 30;
    });
  });
  return { placed, height: Math.max(650, ...placed.map(p => p.y + p.height)) + 140 };
}
export function cementFleetLayoutFigure(r: LogisticsResult, s: LogisticsSettings) {
  return { title: 'Схема расстановки оборудования, вид сверху', reportItem: 'fleetLayout' as const,
    svg: cementFleetLayout(r, s), width: WIDTH, height: placement(r).height };
}
/** One labelled symbol for each actual machine. Instrument taps connect SKC to the pressure line. */
export function cementFleetLayout(r: LogisticsResult, s: LogisticsSettings): string {
  const { placed, height } = placement(r), integrated = r.scheme === 'single' || r.scheme === 'twin';
  const text = (x: number, y: number, str: string, size = 15, color = '#1e293b') => `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="${color}">${esc(str)}</text>`;
  const path = (d: string, color: string, dashed = false, arrow = true) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="3" ${dashed ? 'stroke-dasharray="5 5"' : ''} ${arrow ? `marker-end="url(#fleet-${color.slice(1)})"` : ''}/>`;
  const color = (id: string) => id === 'bulk' ? COLORS.dry : id === 'skc' ? COLORS.skc : id === 'reserve-ca' ? COLORS.reserve : id === 'water' ? COLORS.water : id === 'mixer' ? '#7c3aed' : '#2563eb';
  const titles: Record<string, string> = { bulk: 'Цементовозы ЦТ-25 с тягачами', main: integrated ? (r.scheme === 'twin' ? 'Двухнасосные агрегаты' : 'Однонасосные агрегаты') : 'Рабочие ЦА', 'support-ca': 'Дополнительные рабочие ЦА', 'reserve-ca': 'Резервные ЦА', skc: 'СКЦ - отдельные автомобили', mixer: 'Отдельные смесительные машины', water: 'Автоцистерны воды', manifold: 'Блоки манифольдов', averaging: 'Осреднительные ёмкости' };
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" style="width:100%;height:auto;background:white" role="img" aria-label="Схема расстановки цементировочной техники, вид сверху"><rect width="100%" height="100%" fill="white"/><defs>`;
  for (const c of [...Object.values(COLORS), '#2563eb', '#7c3aed']) svg += `<marker id="fleet-${c.slice(1)}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7Z" fill="${c}"/></marker>`;
  svg += `</defs>${text(24, 30, 'Расстановка оборудования: каждая машина показана отдельно', 21)}${text(24, 59, `Транспорт: ${r.totalVehicles} ед.; персонал: ${r.totalPeople} чел.`, 16)}`;
  svg += `<rect x="1110" y="80" width="186" height="195" rx="12" fill="#f1f5f9" stroke="#64748b"/><path d="M1130 170L1158 96L1186 170Z M1142 140H1174" fill="none" stroke="#475569" stroke-width="3"/><circle cx="1240" cy="140" r="24" fill="white" stroke="#0f172a" stroke-width="3"/><circle cx="1240" cy="140" r="7" fill="#0f172a"/>${text(1127, 218, 'Буровая / скважина', 16)}${text(1127, 244, 'Устье', 14)}`;
  svg += `<rect x="24" y="85" width="394" height="110" rx="12" fill="#e0f2fe" stroke="${COLORS.water}"/>${text(42, 116, s.waterSource === 'tankers' ? 'Вода из автоцистерн' : 'Вода с буровой', 19, COLORS.water)}${text(42, 145, `Потребность: ${r.waterM3.toFixed(1)} м³`, 16)}${text(42, 173, s.waterSource === 'tankers' ? 'Подача в смесительную систему' : 'От точки водоснабжения буровой', 14)}`;
  if (s.waterSource !== 'tankers') svg += path('M1110 100H1060V75H440V130H418', COLORS.water);
  // One shared discharge line. All pump discharges join upstream of the SKC measurement section.
  const pumps = placed.filter(p => p.row.id === 'main' || p.row.id === 'support-ca');
  const busBottom = Math.max(START_Y, ...pumps.map(p => p.y + p.height - 45));
  svg += `<g data-pressure-line="aggregate-to-well">${path(`M866 ${busBottom}V190H1240V164`, COLORS.cement)}<circle cx="1030" cy="190" r="11" fill="white" stroke="${COLORS.skc}" stroke-width="4"/>${text(620, 231, 'Датчики СКЦ в нагнетательной линии', 14, COLORS.skc)}${text(620, 254, 'После агрегатов, перед скважиной', 13, COLORS.skc)}</g>`;
  const receiver = placed.find(p => p.row.id === (integrated ? 'main' : 'mixer'));
  if (receiver) svg += path(`M220 195V220H440V${receiver.y + 64}H${receiver.x}`, COLORS.water);
  for (const p of placed) {
    const { row, x, y } = p, c = color(row.id);
    svg += `<g data-equipment-group="${esc(row.id)}"><rect x="${x}" y="${y}" width="${CARD_WIDTH}" height="${p.height}" rx="12" fill="#f8fafc" stroke="#94a3b8"/>${text(x + 14, y + 27, titles[row.id] ?? row.name, 17)}${text(x + 14, y + 52, `${row.count} ед.`, 17, c)}`;
    const note = row.id === 'bulk' ? 'Тягач + полуприцеп; 1 водитель-оператор' : row.id === 'main' && integrated ? 'Миксер на борту; экипаж 2 человека на машину' : row.id === 'skc' ? 'Бортовой автомобиль с будкой' : row.id === 'reserve-ca' ? 'Подключение после переключения обвязки' : row.vehicle ? 'Каждый символ - отдельная машина' : 'Каждый символ - отдельный блок / ёмкость';
    svg += text(x + 14, y + 74, note, 13);
    for (let i = 0; i < row.count; i++) {
      const ix = x + 16 + (i % 3) * 124, iy = y + 92 + Math.floor(i / 3) * 116;
      const label = row.id === 'bulk' ? `ЦТ-25 №${i + 1}` : row.id === 'skc' ? `СКЦ №${i + 1}` : `№${i + 1}`;
      svg += `<g data-equipment-id="${esc(row.id)}" data-unit="${i + 1}" data-vehicle="${row.vehicle}"><title>${esc(row.name)} №${i + 1}</title>`;
      if (row.vehicle) {
        svg += `<rect x="${ix + 77}" y="${iy + 8}" width="30" height="47" rx="5" fill="${c}" stroke="#334155"/><rect x="${ix + 94}" y="${iy + 15}" width="8" height="32" fill="#dbeafe"/><path d="M${ix + 79} ${iy + 6}h23 M${ix + 79} ${iy + 57}h23" stroke="#334155" stroke-width="4"/><rect x="${ix}" y="${iy + 10}" width="70" height="43" rx="${row.id === 'bulk' ? 18 : 5}" fill="${row.id === 'bulk' ? '#f1e6cf' : c}" stroke="#334155"/><path d="M${ix + 8} ${iy + 7}h20 M${ix + 8} ${iy + 56}h20 M${ix + 70} ${iy + 31}h7" stroke="#334155" stroke-width="4"/>`;
      } else svg += `<rect x="${ix + 14}" y="${iy + 10}" width="80" height="44" rx="${row.id === 'averaging' ? 20 : 4}" fill="#e2e8f0" stroke="#475569"/>`;
      svg += text(ix + 53, iy + 82, label, 13) + '</g>';
      const unitY = iy + 32;
      if (row.id === 'main' || row.id === 'support-ca') svg += path(`M${ix + 107} ${unitY}H866`, COLORS.cement);
      if (row.id === 'bulk' && receiver) svg += path(`M${ix + 107} ${unitY}H430V${receiver.y + 78}H${receiver.x}`, COLORS.dry);
      if (row.id === 'skc') svg += path(`M${ix + 53} ${iy + 55}V${iy + 94}H1306V280H1030V201`, COLORS.skc, true, false);
      if (row.id === 'reserve-ca') svg += path(`M${ix + 53} ${iy + 55}V${iy + 94}H882V206H866`, COLORS.reserve, true);
      if (row.id === 'water') svg += path(`M${ix + 53} ${iy + 55}V${iy + 94}H12V140H24`, COLORS.water);
    }
    svg += '</g>';
  }
  const mixer = placed.find(p => p.row.id === 'mixer'), main = placed.find(p => p.row.id === 'main');
  if (mixer && main) svg += path(`M418 ${mixer.y + mixer.height - 20}H448V${main.y + main.height - 20}H460`, COLORS.cement);
  const legendY = height - 105;
  svg += text(24, legendY, 'Синий: вода. Коричневый: сухой материал. Красный: раствор от агрегатов к скважине.', 15);
  svg += text(24, legendY + 28, 'Зелёный: подключение СКЦ к датчикам в линии. Серый пунктир: резервная обвязка.', 15);
  svg += text(24, legendY + 60, 'Схема условная, без масштаба. Фактические проезды, расстояния и обвязку согласовать на площадке.', 14, COLORS.reserve);
  return svg + '</svg>';
}
