/**
 * Движок интеллектуального извлечения данных из документов
 * Версия 2.0 — контекстный парсинг уровня ИИ
 * 
 * Стратегии:
 * 1. Прямые regex-паттерны (200+)
 * 2. Контекстные окна (ищем число рядом с ключевым словом)
 * 3. Табличный парсинг (label | value)
 * 4. Числа с единицами измерения
 * 5. Секционный анализ (определяем раздел документа)
 * 6. Многострочный контекст
 */

export interface ExtractedValue {
  category: string;
  label: string;
  value: string;
  raw: string;
  confidence: number;
  context?: string; // окружающий текст
}

// ═══════════════════════════════════════════════════════════════════
// 1. ПРЯМЫЕ ПАТТЕРНЫ — максимальное покрытие
// ═══════════════════════════════════════════════════════════════════

interface ExtractionPattern {
  regex: RegExp;
  category: string;
  label: string;
  confidence: number;
  valueGroup?: number; // группа захвата для значения (default 1)
}

const DIRECT_PATTERNS: ExtractionPattern[] = [
  // ─── Плотности ─────────────────────────────────────────
  // Форматы: "1.85 г/см³", "1850 кг/м³", "плотность 1.85", "ρ=1850", "ρц 1,90"
  { regex: /плотност[ьи]\s*(?:раствора|цемент\w*|тампонаж\w*|бур\w*|буфер\w*|продавоч\w*)?\s*[:=\-–—]?\s*(\d{3,4})\s*(?:кг\/м[³3])?/gi, category: "density", label: "плотность", confidence: 0.95 },
  { regex: /плотност[ьи]\s*(?:раствора|цемент\w*|тампонаж\w*|бур\w*|буфер\w*|продавоч\w*)?\s*[:=\-–—]?\s*(\d[.,]\d{1,3})\s*(?:г\/см[³3]|т\/м[³3])?/gi, category: "density", label: "плотность", confidence: 0.95 },
  { regex: /[ρр]\s*[:=]?\s*(\d{3,4})\s*(?:кг\/м[³3])?/gi, category: "density", label: "плотность", confidence: 0.85 },
  { regex: /[ρр]\s*[:=]?\s*(\d[.,]\d{1,3})\s*(?:г\/см[³3])?/gi, category: "density", label: "плотность", confidence: 0.85 },
  { regex: /[ρр]\s*ц\w*\s*[:=]?\s*(\d[.,]?\d*)/gi, category: "density", label: "плотность цемента", confidence: 0.9 },
  { regex: /[ρр]\s*б\w*\s*[:=]?\s*(\d[.,]?\d*)/gi, category: "density", label: "плотность бур.р-ра", confidence: 0.9 },
  { regex: /[ρр]\s*пр\w*\s*[:=]?\s*(\d[.,]?\d*)/gi, category: "density", label: "плотность продавки", confidence: 0.9 },
  { regex: /density\s*[:=\-]?\s*(\d+[.,]?\d*)\s*(?:kg\/m3|g\/cc|ppg|lb\/gal)?/gi, category: "density", label: "density", confidence: 0.9 },
  { regex: /(\d[.,]\d{1,3})\s*г\/см[³3]/g, category: "density", label: "плотность", confidence: 0.85 },
  { regex: /(\d{3,4})\s*кг\/м[³3]/g, category: "density", label: "плотность", confidence: 0.85 },
  { regex: /(\d+[.,]?\d*)\s*ppg/gi, category: "density", label: "density ppg", confidence: 0.8 },
  { regex: /(\d+[.,]?\d*)\s*lb\/gal/gi, category: "density", label: "density lb/gal", confidence: 0.8 },
  { regex: /удельн\w*\s*вес\s*[:=]?\s*(\d[.,]?\d*)/gi, category: "density", label: "удельный вес", confidence: 0.85 },

  // ─── Глубины ───────────────────────────────────────────
  { regex: /глубин[аы]\s*(?:скважин\w*|забо[йя]\w*|спуск\w*|по стволу|по вертикали)?\s*[:=\-–—]?\s*(\d{2,5}[.,]?\d*)\s*м(?:\b|\.)/gi, category: "depth", label: "глубина", confidence: 0.95 },
  { regex: /забо[йя]\s*[:=\-–—]?\s*(\d{2,5}[.,]?\d*)\s*м/gi, category: "depth", label: "забой", confidence: 0.95 },
  { regex: /(?:MD|МД)\s*[:=\-–—]?\s*(\d{2,5}[.,]?\d*)\s*м?/gi, category: "depth", label: "MD", confidence: 0.9 },
  { regex: /(?:TVD|ТВД|вертикальн\w*)\s*[:=\-–—]?\s*(\d{2,5}[.,]?\d*)\s*м?/gi, category: "depth", label: "TVD", confidence: 0.9 },
  { regex: /спуск\s*(?:обсадн\w*|колонн\w*|ОК)?\s*(?:до|на)?\s*[:=\-–—]?\s*(\d{2,5}[.,]?\d*)\s*м/gi, category: "depth", label: "спуск ОК", confidence: 0.95 },
  { regex: /башмак\s*(?:обсадн\w*|колонн\w*|ОК)?\s*(?:на|в|до)?\s*[:=\-–—]?\s*(\d{2,5}[.,]?\d*)\s*м/gi, category: "depth", label: "башмак ОК", confidence: 0.95 },
  { regex: /(?:интервал|от|до)\s*(\d{2,5})\s*(?:до|[-–—])\s*(\d{2,5})\s*м/gi, category: "depth_interval", label: "интервал", confidence: 0.9 },
  { regex: /кровл[яю]\s*[:=]?\s*(\d{2,5})\s*м/gi, category: "depth", label: "кровля", confidence: 0.85 },
  { regex: /подошв[аы]\s*[:=]?\s*(\d{2,5})\s*м/gi, category: "depth", label: "подошва", confidence: 0.85 },
  { regex: /(?:H|h|Н)\s*[:=]?\s*(\d{3,5})\s*м/g, category: "depth", label: "глубина H", confidence: 0.7 },
  { regex: /цементирован\w*\s*(?:от|с)\s*(\d{2,5})\s*(?:до|[-–—])\s*(\d{2,5})\s*м/gi, category: "depth_interval", label: "интервал цементирования", confidence: 0.95 },
  { regex: /подъ[её]м\s*цемент\w*\s*(?:до|на)\s*[:=]?\s*(\d{2,5})\s*м/gi, category: "depth", label: "подъём цемента", confidence: 0.95 },
  { regex: /(?:верх|голова)\s*цемент\w*\s*[:=]?\s*(\d{2,5})\s*м/gi, category: "depth", label: "верх цемента", confidence: 0.95 },

  // ─── Давления ──────────────────────────────────────────
  { regex: /давлени[ея]\s*(?:на\s*устье|гидр\w*|пласт\w*|ГРП|опрессовк\w*|закач\w*|прод\w*)?\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:МПа|мпа|MPa)/gi, category: "pressure", label: "давление", confidence: 0.95 },
  { regex: /давлени[ея]\s*(?:на\s*устье|гидр\w*|пласт\w*|ГРП|опрессовк\w*|закач\w*|прод\w*)?\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:атм|кгс\/см[²2])/gi, category: "pressure", label: "давление", confidence: 0.9 },
  { regex: /давлени[ея]\s*(?:на\s*устье|гидр\w*|пласт\w*|ГРП|опрессовк\w*|закач\w*|прод\w*)?\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:psi|бар|bar)/gi, category: "pressure", label: "давление", confidence: 0.9 },
  { regex: /(?:P|Р)\s*(?:уст|гидр|пл|грп|зак|прод|оп)?\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:МПа|атм)?/gi, category: "pressure", label: "давление", confidence: 0.8 },
  { regex: /(\d+[.,]?\d*)\s*МПа/g, category: "pressure", label: "давление МПа", confidence: 0.8 },
  { regex: /(\d+[.,]?\d*)\s*(?:атм|кгс\/см[²2])/g, category: "pressure", label: "давление атм", confidence: 0.75 },
  { regex: /(\d+[.,]?\d*)\s*psi/gi, category: "pressure", label: "давление psi", confidence: 0.75 },
  { regex: /грп\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:МПа|атм|psi)?/gi, category: "frac_pressure", label: "давление ГРП", confidence: 0.95 },
  { regex: /fractur\w*\s*(?:press\w*|gradient)?\s*[:=]?\s*(\d+[.,]?\d*)/gi, category: "frac_pressure", label: "frac pressure", confidence: 0.9 },
  { regex: /опрессовк\w*\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:МПа|атм)?/gi, category: "pressure_test", label: "опрессовка", confidence: 0.95 },
  { regex: /(?:ECD|экд|экв\w*\s*плотн\w*)\s*[:=]?\s*(\d[.,]?\d*)/gi, category: "ecd", label: "ECD", confidence: 0.9 },

  // ─── Расходы ───────────────────────────────────────────
  { regex: /расход\s*(?:закачк\w*|цемент\w*|буфер\w*|прод\w*|промывк\w*)?\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:л\/с|л\/мин|м[³3]\/мин)/gi, category: "flow_rate", label: "расход", confidence: 0.95 },
  { regex: /(?:Q|q)\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:л\/с|л\/мин|м[³3]\/мин)/gi, category: "flow_rate", label: "расход Q", confidence: 0.9 },
  { regex: /производительност[ьи]\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:л\/с|л\/мин)/gi, category: "flow_rate", label: "производительность", confidence: 0.9 },
  { regex: /(\d+[.,]?\d*)\s*л\/с/g, category: "flow_rate", label: "расход л/с", confidence: 0.75 },
  { regex: /(\d+[.,]?\d*)\s*(?:bbl\/min|bpm)/gi, category: "flow_rate", label: "flow rate bpm", confidence: 0.8 },
  { regex: /rate\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:l\/s|bpm|m3\/min)?/gi, category: "flow_rate", label: "rate", confidence: 0.85 },

  // ─── Объёмы ────────────────────────────────────────────
  { regex: /объ[её]м\s*(?:цемент\w*|тампонаж\w*|буфер\w*|продав\w*|затруб\w*|колонн\w*|кольц\w*)?\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:м[³3]|литр|л\b)/gi, category: "volume", label: "объём", confidence: 0.95 },
  { regex: /(?:V|v)\s*(?:ц|б|пр|зат|кп)?\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:м[³3]|л)?/gi, category: "volume", label: "объём V", confidence: 0.8 },
  { regex: /(\d+[.,]?\d*)\s*м[³3](?:\b|[^\/])/g, category: "volume", label: "объём м³", confidence: 0.7 },
  { regex: /(\d+[.,]?\d*)\s*(?:bbl|баррел)/gi, category: "volume", label: "объём bbl", confidence: 0.8 },
  { regex: /(\d+[.,]?\d*)\s*тонн/gi, category: "weight", label: "масса", confidence: 0.8 },
  { regex: /масса\s*(?:цемент\w*|сух\w*)?\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:т|кг|тонн)/gi, category: "weight", label: "масса", confidence: 0.9 },

  // ─── Температуры ───────────────────────────────────────
  { regex: /температур[аы]\s*(?:забойн\w*|статич\w*|циркуляц\w*|пласт\w*|устьев\w*)?\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:°\s*[CСс]|градус)?/gi, category: "temperature", label: "температура", confidence: 0.95 },
  { regex: /(?:BHST|ЗБКТ)\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:°\s*[CС])?/gi, category: "temperature", label: "BHST", confidence: 0.95 },
  { regex: /(?:BHCT|ЗДКТ)\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:°\s*[CС])?/gi, category: "temperature", label: "BHCT", confidence: 0.95 },
  { regex: /(?:T|Т)\s*(?:заб|ст|цирк|пл)?\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:°\s*[CС])/gi, category: "temperature", label: "температура", confidence: 0.8 },
  { regex: /(\d+[.,]?\d*)\s*°\s*[CСс]/g, category: "temperature", label: "температура °C", confidence: 0.7 },
  { regex: /геотерм\w*\s*градиент\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:°\s*[CС]?\s*\/?\s*(?:100\s*)?м)?/gi, category: "temperature", label: "геотермический градиент", confidence: 0.9 },

  // ─── Время загустевания ────────────────────────────────
  { regex: /загустеван[ия][ея]?\s*[:=\-–—]?\s*(\d+)\s*(?:мин|час|hr|min)/gi, category: "thickening", label: "время загустевания", confidence: 0.95 },
  { regex: /thickening\s*(?:time)?\s*[:=\-–—]?\s*(\d+)\s*(?:min|hr)?/gi, category: "thickening", label: "thickening time", confidence: 0.9 },
  { regex: /50\s*(?:Bc|Вс|единиц)\s*[:=\-–—]?\s*(\d+)\s*(?:мин|min)?/gi, category: "thickening", label: "50 Bc", confidence: 0.95 },
  { regex: /70\s*(?:Bc|Вс)\s*[:=\-–—]?\s*(\d+)\s*(?:мин|min)?/gi, category: "thickening", label: "70 Bc", confidence: 0.9 },
  { regex: /100\s*(?:Bc|Вс)\s*[:=\-–—]?\s*(\d+)\s*(?:мин|min)?/gi, category: "thickening", label: "100 Bc", confidence: 0.9 },
  { regex: /начало\s*(?:загустеван\w*|схватыван\w*)\s*[:=]?\s*(\d+)\s*(?:мин|час)/gi, category: "thickening", label: "начало загустевания", confidence: 0.9 },
  { regex: /конец\s*(?:загустеван\w*|схватыван\w*)\s*[:=]?\s*(\d+)\s*(?:мин|час)/gi, category: "thickening", label: "конец загустевания", confidence: 0.9 },
  { regex: /(?:время\s*)?схватыван[ия]\s*[:=]?\s*(\d+)\s*(?:мин|час)/gi, category: "thickening", label: "время схватывания", confidence: 0.85 },
  { regex: /(?:время\s*)?перекачиваемост[ьи]\s*[:=]?\s*(\d+)\s*(?:мин|час)/gi, category: "thickening", label: "перекачиваемость", confidence: 0.9 },

  // ─── Водоотдача ────────────────────────────────────────
  { regex: /водоотдач[аи]\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:мл|см[³3]|cc)/gi, category: "fluid_loss", label: "водоотдача", confidence: 0.95 },
  { regex: /fluid\s*loss\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:ml|cc)?/gi, category: "fluid_loss", label: "fluid loss", confidence: 0.9 },
  { regex: /фильтрац[ия]\w*\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:мл|см[³3])?/gi, category: "fluid_loss", label: "фильтрация", confidence: 0.85 },
  { regex: /ВОТР?\s*[:=]?\s*(\d+[.,]?\d*)/gi, category: "fluid_loss", label: "ВО", confidence: 0.8 },

  // ─── Реология ──────────────────────────────────────────
  { regex: /(?:PV|ПВ|пластич\w*\s*вязкост\w*)\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:сПз|сП|mPa|cp)?/gi, category: "rheology_pv", label: "PV", confidence: 0.9 },
  { regex: /(?:YP|ДНС|динамич\w*\s*напряж\w*)\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:Па|Pa|фунт|lb)?/gi, category: "rheology_yp", label: "YP", confidence: 0.9 },
  { regex: /(?:СНС|SNS|gel\s*strength)\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:[\/и]\s*(\d+[.,]?\d*))?\s*(?:Па|Pa|дПа)?/gi, category: "sns", label: "СНС", confidence: 0.9 },
  { regex: /(?:n['′]?|показатель\s*нелинейности)\s*[:=]?\s*(\d[.,]\d+)/gi, category: "rheology_n", label: "n (индекс потока)", confidence: 0.8 },
  { regex: /(?:K|k|показатель\s*консистенции)\s*[:=]?\s*(\d+[.,]?\d*)/gi, category: "rheology_k", label: "K (консистенция)", confidence: 0.7 },
  { regex: /вязкост[ьи]\s*(?:пластич\w*|условн\w*|эффективн\w*)?\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:сПз|сП|cp|мПа·с)?/gi, category: "viscosity", label: "вязкость", confidence: 0.85 },
  { regex: /(?:θ|тэта)\s*(\d+)\s*[:=]?\s*(\d+)/gi, category: "rheometer", label: "показание вискозиметра", confidence: 0.85 },

  // ─── Прочность ─────────────────────────────────────────
  { regex: /прочност[ьи]\s*(?:на\s*сжатие|цемент\w*|камн\w*)?\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*(?:МПа|мпа|psi)?/gi, category: "strength", label: "прочность на сжатие", confidence: 0.95 },
  { regex: /compressive\s*strength\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:MPa|psi)?/gi, category: "strength", label: "compressive strength", confidence: 0.9 },
  { regex: /UCS\s*[:=]?\s*(\d+[.,]?\d*)/gi, category: "strength", label: "UCS", confidence: 0.85 },
  { regex: /(?:σ|сигма)\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:МПа)?/gi, category: "strength", label: "прочность σ", confidence: 0.8 },
  { regex: /(?:прочность|strength)\s*(?:через|after|at)\s*(\d+)\s*(?:час|ч|hr|h)/gi, category: "strength_time", label: "время набора прочности", confidence: 0.9 },

  // ─── АКЦ/CBL/VDL ──────────────────────────────────────
  { regex: /АКЦ/g, category: "bond_log", label: "АКЦ", confidence: 0.95 },
  { regex: /(?:CBL|СГДТ|VDL)/gi, category: "bond_log", label: "CBL/VDL", confidence: 0.95 },
  { regex: /амплитуд[аы]\s*(?:CBL|АКЦ)?\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:мВ|мв|mv|mV)?/gi, category: "amplitude", label: "амплитуда CBL", confidence: 0.95 },
  { regex: /сцеплени[ея]\s*(?:цемент\w*|с\s*колонн\w*|с\s*пород\w*)?\s*[:=]?\s*(?:хорош|удовлетв|неудовлетв|отсутств|полн|частичн|слаб)/gi, category: "bond_quality", label: "качество сцепления", confidence: 0.95 },
  { regex: /bond\s*(?:index|quality|log)?\s*[:=]?\s*(\d+[.,]?\d*)\s*%?/gi, category: "bond", label: "bond index", confidence: 0.9 },
  { regex: /(?:хорош|удовлетв|частичн|неудовлетв|отсутств)\w*\s*сцеплени/gi, category: "bond_quality", label: "оценка сцепления", confidence: 0.95 },
  { regex: /(?:качеств\w*|состояни\w*)\s*(?:цемент\w*|крепи|сцеплени\w*)\s*[:=\-–—]?\s*(?:хорош|удовлетв|неудовлетв|отличн|плох)/gi, category: "bond_quality", label: "качество цемента", confidence: 0.95 },
  { regex: /(?:микрозазор|micro\s*annul)/gi, category: "microannulus", label: "микрозазор", confidence: 0.9 },
  { regex: /(?:каналообразован|channel)/gi, category: "channeling", label: "каналообразование", confidence: 0.9 },

  // ─── Обсадная колонна ──────────────────────────────────
  { regex: /(\d+[.,]?\d*)\s*(?:мм|mm)\s*(?:×|x|X|х)\s*(\d+[.,]?\d*)\s*(?:мм|mm)/gi, category: "casing", label: "размер ОК", confidence: 0.9 },
  { regex: /(\d+[.,]?\d*)\s*(?:"|дюйм)/g, category: "casing_inch", label: "размер ОК дюймы", confidence: 0.8 },
  { regex: /(?:ОК|обсадн\w*\s*колонн\w*)\s*(?:Ø|диаметр\w*)?\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:мм|")?/gi, category: "casing", label: "ОК", confidence: 0.9 },
  { regex: /(?:кондуктор|направлени[ея]|эксплуатационн\w*|промежуточн\w*|хвостовик|liner)\s*(?:Ø|диаметр\w*)?\s*[:=]?\s*(\d+[.,]?\d*)/gi, category: "casing_type", label: "тип колонны", confidence: 0.9 },
  { regex: /толщин[аы]\s*стенк[иы]\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:мм|mm)?/gi, category: "wall_thickness", label: "стенка ОК", confidence: 0.9 },
  { regex: /(?:марк[аи]|группа)\s*(?:стал[ьи]|прочност[ьи])\s*[:=]?\s*([ДКЛМНE]\s*\d+|[JNPLC]\s*\d+|[A-Z]\d+)/gi, category: "casing_grade", label: "марка стали", confidence: 0.9 },

  // ─── Ствол скважины ────────────────────────────────────
  { regex: /(?:диаметр|Ø)\s*(?:долот\w*|ствол\w*|скважин\w*|открыт\w*)?\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:мм|mm|"|дюйм)/gi, category: "hole_diameter", label: "диаметр ствола", confidence: 0.9 },
  { regex: /каверн\w*\s*(?:коэф\w*|коэфф\w*)?\s*[:=]?\s*(\d[.,]\d+)/gi, category: "cavern_coeff", label: "Кк (каверн.)", confidence: 0.9 },
  { regex: /(?:Кк|Kk)\s*[:=]?\s*(\d[.,]\d+)/gi, category: "cavern_coeff", label: "Кк", confidence: 0.85 },

  // ─── Центрирование ─────────────────────────────────────
  { regex: /standoff\s*[:=\-–—]?\s*(\d+[.,]?\d*)\s*%/gi, category: "standoff", label: "standoff", confidence: 0.95 },
  { regex: /(?:стенд[-\s]*офф|центрировани[ея])\s*[:=]?\s*(\d+[.,]?\d*)\s*%/gi, category: "standoff", label: "standoff", confidence: 0.9 },
  { regex: /центратор\w*\s*[:=\-–—]?\s*(\d+)\s*(?:шт|штук|единиц)/gi, category: "centralizer_count", label: "кол-во центраторов", confidence: 0.9 },
  { regex: /(\d+)\s*(?:шт\.?\s*)?центратор/gi, category: "centralizer_count", label: "кол-во центраторов", confidence: 0.85 },

  // ─── Цемент / материалы ────────────────────────────────
  { regex: /(?:ПЦТ|ПЦ|цемент)\s*[-\s]*(I{1,3}|[123])\s*[-\s]*([\d]+|[ABCGH])/gi, category: "cement_type", label: "тип цемента", confidence: 0.95 },
  { regex: /class\s*[ABCGH]/gi, category: "cement_type", label: "класс цемента", confidence: 0.9 },
  { regex: /(?:добавк[аи]|реагент)\s*[:=\-–—]?\s*([А-Яа-яA-Za-z][\w\-]+)/gi, category: "additive", label: "добавка", confidence: 0.8 },
  { regex: /(?:замедлител[ьи]|ускорител[ьи]|пеногасител[ьи]|понизител[ьи]|пластификатор)/gi, category: "additive_type", label: "тип добавки", confidence: 0.85 },
  { regex: /(?:водоцемент\w*|В\/Ц|W\/C)\s*(?:отношени\w*|фактор)?\s*[:=]?\s*(\d[.,]\d+)/gi, category: "wc_ratio", label: "В/Ц", confidence: 0.9 },

  // ─── ОЗЦ ───────────────────────────────────────────────
  { regex: /(?:ОЗЦ|WOC|ожидани\w*\s*затвердевани\w*|wait\s*on\s*cement)\s*[:=\-–—]?\s*(\d+)\s*(?:час|ч|hr|h|сут)/gi, category: "woc", label: "ОЗЦ", confidence: 0.95 },
  { regex: /(?:время\s*)?(?:твердени[ея]|затвердевани[ея]|отвержени[ея])\s*[:=]?\s*(\d+)\s*(?:час|ч|hr)/gi, category: "woc", label: "время твердения", confidence: 0.85 },

  // ─── Операционные параметры ─────────────────────────────
  { regex: /(?:число|кол-во|количеств\w*)\s*(?:ход\w*|цикл\w*)\s*(?:промывк\w*|циркуляц\w*)?\s*[:=]?\s*(\d+[.,]?\d*)/gi, category: "circulation_cycles", label: "циклы промывки", confidence: 0.85 },
  { regex: /(?:время\s*)?(?:промывк[аи]|циркуляц[ия])\s*[:=]?\s*(\d+)\s*(?:мин|час|ч)/gi, category: "circulation_time", label: "время промывки", confidence: 0.85 },
  { regex: /(?:скорость\s*)?(?:СПО|спуск\w*)\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:м\/мин|м\/с|мин\/свеч)/gi, category: "run_speed", label: "скорость СПО", confidence: 0.85 },

  // ─── Поглощения / осложнения ────────────────────────────
  { regex: /поглощен[ия]\w*\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:м[³3]\/час|м[³3]\/ч|л\/с)?/gi, category: "losses", label: "поглощение", confidence: 0.9 },
  { regex: /(?:зона|интервал)\s*поглощени/gi, category: "losses", label: "зона поглощения", confidence: 0.85 },
  { regex: /(?:ГНВП|газопроявлен|нефтепроявлен|водопроявлен)/gi, category: "influx", label: "проявление", confidence: 0.9 },
  { regex: /(?:газомигра|gas\s*migrat)/gi, category: "gas_migration", label: "газомиграция", confidence: 0.9 },
  { regex: /(?:прихват|затяжк|посадк)/gi, category: "sticking", label: "прихват", confidence: 0.85 },

  // ─── Водоотделение / седиментация ──────────────────────
  { regex: /водоотделени[ея]\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:%|мл)/gi, category: "free_water", label: "водоотделение", confidence: 0.9 },
  { regex: /free\s*(?:fluid|water)\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:%|ml)?/gi, category: "free_water", label: "free water", confidence: 0.9 },
  { regex: /седиментаци[яю]\s*[:=]?\s*(\d+[.,]?\d*)\s*%?/gi, category: "sedimentation", label: "седиментация", confidence: 0.85 },

  // ─── Расширение / усадка ───────────────────────────────
  { regex: /(?:расширени[ея]|expansion)\s*[:=]?\s*(\d+[.,]?\d*)\s*%/gi, category: "expansion", label: "расширение", confidence: 0.9 },
  { regex: /(?:усадк[аи]|shrinkage)\s*[:=]?\s*(\d+[.,]?\d*)\s*%/gi, category: "shrinkage", label: "усадка", confidence: 0.9 },

  // ─── Проницаемость ─────────────────────────────────────
  { regex: /проницаемост[ьи]\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:мД|mD|Д)?/gi, category: "permeability", label: "проницаемость", confidence: 0.85 },
  { regex: /(?:К|k)\s*пр\s*[:=]?\s*(\d+[.,]?\d*)\s*(?:мД)?/gi, category: "permeability", label: "Кпр", confidence: 0.8 },
];

// ═══════════════════════════════════════════════════════════════════
// 2. КОНТЕКСТНЫЕ ОКНА — ищем числа рядом с ключевым словом
// ═══════════════════════════════════════════════════════════════════

interface ContextKeyword {
  keywords: RegExp;
  category: string;
  label: string;
  numberFilter?: (n: number) => boolean; // фильтр допустимых значений
  confidence: number;
}

const CONTEXT_KEYWORDS: ContextKeyword[] = [
  { keywords: /плотност[ьи]|densit|удельн\w*\s*вес/i, category: "density", label: "плотность (контекст)", confidence: 0.7,
    numberFilter: n => (n >= 0.8 && n <= 3.0) || (n >= 800 && n <= 3000) },
  { keywords: /глубин|забо[йя]|спуск\s*(?:ОК|колонн)|башмак|depth|MD|TVD/i, category: "depth", label: "глубина (контекст)", confidence: 0.65,
    numberFilter: n => n >= 10 && n <= 15000 },
  { keywords: /давлени|press|МПа|атм|psi/i, category: "pressure", label: "давление (контекст)", confidence: 0.65,
    numberFilter: n => n >= 0.1 && n <= 200 },
  { keywords: /температур|BHST|BHCT|°C|градус/i, category: "temperature", label: "температура (контекст)", confidence: 0.65,
    numberFilter: n => n >= 5 && n <= 350 },
  { keywords: /загустеван|thickening|50\s*Bc|70\s*Bc|схватыван/i, category: "thickening", label: "загустевание (контекст)", confidence: 0.65,
    numberFilter: n => n >= 30 && n <= 1200 },
  { keywords: /водоотдач|fluid\s*loss|фильтрац/i, category: "fluid_loss", label: "водоотдача (контекст)", confidence: 0.65,
    numberFilter: n => n >= 0 && n <= 2000 },
  { keywords: /расход|rate|производительност|Q\s*[=:]/i, category: "flow_rate", label: "расход (контекст)", confidence: 0.6,
    numberFilter: n => n >= 0.1 && n <= 100 },
  { keywords: /объ[её]м|volume|V\s*[=:]/i, category: "volume", label: "объём (контекст)", confidence: 0.6,
    numberFilter: n => n >= 0.01 && n <= 500 },
  { keywords: /прочност|strength|UCS|σ/i, category: "strength", label: "прочность (контекст)", confidence: 0.65,
    numberFilter: n => n >= 0.1 && n <= 100 },
  { keywords: /standoff|центрировани|стенд.?офф/i, category: "standoff", label: "standoff (контекст)", confidence: 0.65,
    numberFilter: n => n >= 10 && n <= 100 },
  { keywords: /ОЗЦ|WOC|wait.*cement|твердени|затвердевани/i, category: "woc", label: "ОЗЦ (контекст)", confidence: 0.6,
    numberFilter: n => n >= 2 && n <= 120 },
  { keywords: /амплитуд|CBL|bond\s*index/i, category: "amplitude", label: "амплитуда (контекст)", confidence: 0.65,
    numberFilter: n => n >= 0 && n <= 100 },
  { keywords: /PV|пластич\w*\s*вязкост/i, category: "rheology_pv", label: "PV (контекст)", confidence: 0.6,
    numberFilter: n => n >= 1 && n <= 500 },
  { keywords: /YP|ДНС|динамич\w*\s*напряж/i, category: "rheology_yp", label: "YP (контекст)", confidence: 0.6,
    numberFilter: n => n >= 0 && n <= 100 },
  { keywords: /водоотделени|free\s*(?:water|fluid)/i, category: "free_water", label: "водоотделение (контекст)", confidence: 0.65,
    numberFilter: n => n >= 0 && n <= 30 },
  { keywords: /В\/Ц|W\/C|водоцемент/i, category: "wc_ratio", label: "В/Ц (контекст)", confidence: 0.7,
    numberFilter: n => n >= 0.2 && n <= 1.5 },
];

function extractByContext(text: string): ExtractedValue[] {
  const results: ExtractedValue[] = [];
  const seen = new Set<string>();
  
  // Split text into sentences/lines for context analysis
  const segments = text.split(/[.!?\n;]+/).filter(s => s.trim().length > 5);
  
  for (const segment of segments) {
    for (const ctx of CONTEXT_KEYWORDS) {
      if (!ctx.keywords.test(segment)) continue;
      
      // Find all numbers in this segment
      const numberMatches = segment.matchAll(/(\d+[.,]?\d*)/g);
      for (const nm of numberMatches) {
        const numStr = nm[1].replace(",", ".");
        const num = parseFloat(numStr);
        if (!isFinite(num)) continue;
        
        // Apply filter if available
        if (ctx.numberFilter && !ctx.numberFilter(num)) continue;
        
        const key = `${ctx.category}:${num}`;
        if (seen.has(key)) continue;
        seen.add(key);
        
        // Get surrounding context (±30 chars)
        const start = Math.max(0, (nm.index || 0) - 30);
        const end = Math.min(segment.length, (nm.index || 0) + nm[0].length + 30);
        const context = segment.slice(start, end).trim();
        
        results.push({
          category: ctx.category,
          label: ctx.label,
          value: numStr,
          raw: context,
          confidence: ctx.confidence,
          context: segment.trim().slice(0, 120),
        });
      }
    }
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════
// 3. ТАБЛИЧНЫЙ ПАРСИНГ — извлечение из таблиц
// ═══════════════════════════════════════════════════════════════════

function extractFromTables(text: string): ExtractedValue[] {
  const results: ExtractedValue[] = [];
  const seen = new Set<string>();
  const lines = text.split("\n");
  
  // Table patterns: "Label | Value", "Label : Value", "Label   Value" (tab-separated)
  const tablePatterns: { labelRegex: RegExp; category: string; label: string; valueFilter?: (v: number) => boolean }[] = [
    { labelRegex: /плотност[ьи]|dens/i, category: "density", label: "плотность (таблица)", valueFilter: n => (n >= 0.8 && n <= 3.0) || (n >= 800 && n <= 3000) },
    { labelRegex: /глубин|забой|depth|MD|TVD|спуск/i, category: "depth", label: "глубина (таблица)", valueFilter: n => n >= 10 && n <= 15000 },
    { labelRegex: /давлени|press/i, category: "pressure", label: "давление (таблица)", valueFilter: n => n > 0 && n <= 200 },
    { labelRegex: /температур|temp|BHST|BHCT/i, category: "temperature", label: "температура (таблица)", valueFilter: n => n >= 5 && n <= 350 },
    { labelRegex: /загустеван|thickening|50\s*Bc/i, category: "thickening", label: "загустевание (таблица)", valueFilter: n => n >= 30 && n <= 1200 },
    { labelRegex: /водоотдач|fluid.*loss|фильтрац/i, category: "fluid_loss", label: "водоотдача (таблица)", valueFilter: n => n >= 0 && n <= 2000 },
    { labelRegex: /расход|rate|производительн/i, category: "flow_rate", label: "расход (таблица)", valueFilter: n => n > 0 && n <= 100 },
    { labelRegex: /объ[её]м|volume/i, category: "volume", label: "объём (таблица)", valueFilter: n => n > 0 && n <= 500 },
    { labelRegex: /прочност|strength|UCS/i, category: "strength", label: "прочность (таблица)", valueFilter: n => n > 0 && n <= 100 },
    { labelRegex: /standoff|центрировани/i, category: "standoff", label: "standoff (таблица)", valueFilter: n => n >= 10 && n <= 100 },
    { labelRegex: /ОЗЦ|WOC/i, category: "woc", label: "ОЗЦ (таблица)", valueFilter: n => n >= 2 && n <= 120 },
    { labelRegex: /диаметр|Ø|diam/i, category: "hole_diameter", label: "диаметр (таблица)", valueFilter: n => n >= 50 && n <= 1000 },
    { labelRegex: /каверн|Кк/i, category: "cavern_coeff", label: "Кк (таблица)", valueFilter: n => n >= 1.0 && n <= 3.0 },
    { labelRegex: /В\/Ц|W\/C|водоцемент/i, category: "wc_ratio", label: "В/Ц (таблица)", valueFilter: n => n >= 0.2 && n <= 1.5 },
    { labelRegex: /PV|пластич\w*\s*вязкост/i, category: "rheology_pv", label: "PV (таблица)", valueFilter: n => n >= 1 && n <= 500 },
    { labelRegex: /YP|ДНС|динамич\w*\s*напряж/i, category: "rheology_yp", label: "YP (таблица)", valueFilter: n => n >= 0 && n <= 100 },
    { labelRegex: /СНС|gel/i, category: "sns", label: "СНС (таблица)", valueFilter: n => n >= 0 && n <= 100 },
    { labelRegex: /масс[аы]|вес\s*цемент/i, category: "weight", label: "масса (таблица)", valueFilter: n => n > 0 },
    { labelRegex: /водоотделени|free.*water/i, category: "free_water", label: "водоотделение (таблица)", valueFilter: n => n >= 0 && n <= 30 },
    { labelRegex: /амплитуд|CBL/i, category: "amplitude", label: "амплитуда (таблица)", valueFilter: n => n >= 0 && n <= 100 },
    { labelRegex: /поглощен|loss.*zone/i, category: "losses", label: "поглощение (таблица)" },
    { labelRegex: /геотерм|градиент/i, category: "temperature", label: "геотерм. градиент (таблица)", valueFilter: n => n > 0 && n <= 10 },
    { labelRegex: /опрессовк|pressure.*test/i, category: "pressure_test", label: "опрессовка (таблица)", valueFilter: n => n > 0 && n <= 200 },
    { labelRegex: /проницаемост|permeab/i, category: "permeability", label: "проницаемость (таблица)", valueFilter: n => n >= 0 },
    { labelRegex: /толщин.*стенк|wall.*thick/i, category: "wall_thickness", label: "стенка ОК (таблица)", valueFilter: n => n >= 3 && n <= 30 },
    { labelRegex: /(?:марк|групп).*стал|grade/i, category: "casing_grade", label: "марка стали (таблица)" },
    { labelRegex: /центратор|centralizer/i, category: "centralizer_count", label: "центраторы (таблица)", valueFilter: n => n >= 1 && n <= 500 },
  ];
  
  for (const line of lines) {
    // Try to split line into label and value parts
    // Patterns: "Label | Value", "Label : Value", "Label     Value" (multiple spaces/tabs)
    const splitPatterns = [
      /^(.+?)\s*\|\s*(.+)$/,       // pipe separated
      /^(.+?)\s*[:\-–—=]\s*(.+)$/, // colon/dash separated
      /^(.{10,}?)\s{3,}(.+)$/,     // space separated (at least 3 spaces)
      /^(.+?)\t+(.+)$/,            // tab separated
    ];
    
    for (const sp of splitPatterns) {
      const match = line.match(sp);
      if (!match) continue;
      
      const [, labelPart, valuePart] = match;
      
      for (const tp of tablePatterns) {
        if (!tp.labelRegex.test(labelPart)) continue;
        
        // Extract numbers from value part
        const nums = valuePart.matchAll(/(\d+[.,]?\d*)/g);
        for (const nm of nums) {
          const numStr = nm[1].replace(",", ".");
          const num = parseFloat(numStr);
          if (!isFinite(num)) continue;
          if (tp.valueFilter && !tp.valueFilter(num)) continue;
          
          const key = `${tp.category}:${num}`;
          if (seen.has(key)) continue;
          seen.add(key);
          
          results.push({
            category: tp.category,
            label: tp.label,
            value: numStr,
            raw: line.trim().slice(0, 120),
            confidence: 0.8,
            context: line.trim(),
          });
        }
      }
    }
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════
// 4. СЕКЦИОННЫЙ АНАЛИЗ — определяем раздел документа
// ═══════════════════════════════════════════════════════════════════

interface DocumentSection {
  title: string;
  type: "program" | "report" | "akc" | "lab" | "geology" | "operations" | "general";
  startLine: number;
  endLine: number;
  text: string;
}

function detectSections(text: string): DocumentSection[] {
  const lines = text.split("\n");
  const sections: DocumentSection[] = [];
  const sectionHeaders: { regex: RegExp; type: DocumentSection["type"] }[] = [
    { regex: /программ[аы]\s*цементирован/i, type: "program" },
    { regex: /план\s*цементирован/i, type: "program" },
    { regex: /график\s*закачк/i, type: "program" },
    { regex: /отчёт|рапорт|акт/i, type: "report" },
    { regex: /результат\w*\s*(?:АКЦ|CBL|VDL|СГДТ|геофиз|каротаж)/i, type: "akc" },
    { regex: /интерпретац|заключени\w*\s*(?:по|геофиз)/i, type: "akc" },
    { regex: /лаборатор|испытан|рецептур/i, type: "lab" },
    { regex: /геолог|литолог|стратиграф|разрез/i, type: "geology" },
    { regex: /операци|технолог|ход\s*работ/i, type: "operations" },
  ];
  
  let currentSection: DocumentSection | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length < 3) continue;
    
    let matched = false;
    for (const sh of sectionHeaders) {
      if (sh.regex.test(line)) {
        // Close previous section
        if (currentSection) {
          currentSection.endLine = i - 1;
          currentSection.text = lines.slice(currentSection.startLine, i).join("\n");
          sections.push(currentSection);
        }
        currentSection = { title: line, type: sh.type, startLine: i, endLine: lines.length - 1, text: "" };
        matched = true;
        break;
      }
    }
  }
  
  // Close last section
  if (currentSection) {
    currentSection.text = lines.slice(currentSection.startLine).join("\n");
    sections.push(currentSection);
  }
  
  // If no sections detected, treat entire text as general
  if (sections.length === 0) {
    sections.push({ title: "Документ", type: "general", startLine: 0, endLine: lines.length - 1, text });
  }
  
  return sections;
}

// ═══════════════════════════════════════════════════════════════════
// 5. КАЧЕСТВЕННЫЕ ВЫВОДЫ ИЗ ТЕКСТА
// ═══════════════════════════════════════════════════════════════════

interface QualitativeFinding {
  category: string;
  finding: string;
  confidence: number;
  context: string;
}

function extractQualitativeFindings(text: string): QualitativeFinding[] {
  const findings: QualitativeFinding[] = [];
  const segments = text.split(/[.!?\n]+/).filter(s => s.trim().length > 10);
  
  const qualitativePatterns: { regex: RegExp; category: string; finding: string }[] = [
    // Качество сцепления
    { regex: /(?:хорош|качественн|надёжн|отличн)\w*\s*(?:сцеплени|контакт|крепь|цементировани)/i, category: "bond_quality", finding: "хорошее качество сцепления/крепи" },
    { regex: /(?:удовлетвор|допустим|приемлем)\w*\s*(?:сцеплени|контакт|крепь|цементировани)/i, category: "bond_quality", finding: "удовлетворительное качество" },
    { regex: /(?:неудовлетвор|плох|слаб|недостаточн|дефект)\w*\s*(?:сцеплени|контакт|крепь|цементировани)/i, category: "bond_quality", finding: "неудовлетворительное качество" },
    { regex: /отсутстви[ея]\s*(?:сцеплени|контакт|цемент)/i, category: "bond_quality", finding: "отсутствие сцепления" },
    { regex: /(?:полное|сплошное)\s*(?:сцеплени|заполнени)/i, category: "bond_quality", finding: "полное сцепление" },
    { regex: /(?:частичн|неполн)\w*\s*(?:сцеплени|заполнени|контакт)/i, category: "bond_quality", finding: "частичное сцепление" },
    
    // Проблемы
    { regex: /каналообразовани/i, category: "problems", finding: "обнаружено каналообразование" },
    { regex: /(?:микрозазор|micro.*annul)/i, category: "problems", finding: "обнаружен микрозазор" },
    { regex: /(?:недоподъём|не.*поднялся)\s*цемент/i, category: "problems", finding: "недоподъём цемента" },
    { regex: /(?:оставлени|наличи)\w*\s*(?:глинист\w*\s*корк|фильтрац\w*\s*корк)/i, category: "problems", finding: "остаточная глинистая корка" },
    { regex: /(?:перетоки?|межпластов\w*\s*перетоки?)/i, category: "problems", finding: "межпластовые перетоки" },
    { regex: /негерметичност/i, category: "problems", finding: "негерметичность крепи" },
    { regex: /пропуск\w*\s*(?:газ|жидкост|воды)/i, category: "problems", finding: "пропуски среды" },
    
    // Рекомендации
    { regex: /рекоменд\w*\s*(?:РИР|ремонт|повторн|перецементировани|squeeze)/i, category: "recommendations", finding: "рекомендован РИР" },
    { regex: /рекоменд\w*\s*(?:опрессовк|испытани)/i, category: "recommendations", finding: "рекомендована опрессовка" },
    { regex: /(?:допуска|допущен|разрешен)\w*\s*(?:к\s*(?:эксплуатаци|дальнейш|следующ|бурени))/i, category: "recommendations", finding: "допущена к дальнейшим работам" },
    
    // Режимы
    { regex: /турбулентн\w*\s*(?:режим|течени|поток)/i, category: "flow_regime", finding: "турбулентный режим течения" },
    { regex: /ламинарн\w*\s*(?:режим|течени|поток)/i, category: "flow_regime", finding: "ламинарный режим течения" },
    
    // Осложнения при бурении
    { regex: /(?:осыпани|обвал|сужени)\w*\s*(?:ствол|стенок)/i, category: "complications", finding: "осыпание/обвал стенок" },
    { regex: /(?:поглощени|уход)\s*(?:бур\w*\s*раствор|промывочн)/i, category: "complications", finding: "поглощение бурового раствора" },
    { regex: /(?:нефтегазоводо)?проявлени/i, category: "complications", finding: "проявление" },
  ];
  
  for (const segment of segments) {
    for (const qp of qualitativePatterns) {
      if (qp.regex.test(segment)) {
        findings.push({
          category: qp.category,
          finding: qp.finding,
          confidence: 0.85,
          context: segment.trim().slice(0, 150),
        });
      }
    }
  }
  
  return findings;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN: Комбинированный движок извлечения
// ═══════════════════════════════════════════════════════════════════

export function extractAllValues(text: string): {
  values: ExtractedValue[];
  sections: DocumentSection[];
  qualitative: QualitativeFinding[];
} {
  if (!text || text.trim().length < 5) {
    return { values: [], sections: [], qualitative: [] };
  }
  
  // 1. Прямые regex-паттерны
  const directValues = extractByDirectPatterns(text);
  
  // 2. Контекстные окна
  const contextValues = extractByContext(text);
  
  // 3. Табличный парсинг
  const tableValues = extractFromTables(text);
  
  // 4. Секции документа
  const sections = detectSections(text);
  
  // 5. Качественные выводы
  const qualitative = extractQualitativeFindings(text);
  
  // Объединяем и дедуплицируем с приоритетом по confidence
  const allValues = [...directValues, ...contextValues, ...tableValues];
  const deduped = deduplicateValues(allValues);
  
  return { values: deduped, sections, qualitative };
}

function extractByDirectPatterns(text: string): ExtractedValue[] {
  const results: ExtractedValue[] = [];
  const seen = new Set<string>();
  
  for (const pattern of DIRECT_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    let count = 0;
    while ((match = regex.exec(text)) !== null && count < 50) {
      count++;
      const valueGroup = pattern.valueGroup || 1;
      const value = match[valueGroup] || match[0];
      const key = `${pattern.category}:${value.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      
      // Get context
      const start = Math.max(0, match.index - 20);
      const end = Math.min(text.length, match.index + match[0].length + 20);
      
      results.push({
        category: pattern.category,
        label: pattern.label,
        value: value.trim(),
        raw: match[0].trim(),
        confidence: pattern.confidence,
        context: text.slice(start, end).trim(),
      });
    }
  }
  
  return results;
}

function deduplicateValues(values: ExtractedValue[]): ExtractedValue[] {
  const map = new Map<string, ExtractedValue>();
  
  for (const v of values) {
    // Normalize key: category + numeric value
    const numStr = v.value.replace(",", ".");
    const num = parseFloat(numStr);
    const key = isFinite(num) ? `${v.category}:${num}` : `${v.category}:${v.value.toLowerCase()}`;
    
    const existing = map.get(key);
    if (!existing || v.confidence > existing.confidence) {
      map.set(key, v);
    }
  }
  
  return [...map.values()].sort((a, b) => b.confidence - a.confidence);
}

// ═══════════════════════════════════════════════════════════════════
// Backward compatibility — drop-in replacement for old extractValuesFromText
// ═══════════════════════════════════════════════════════════════════

export function extractValuesFromText(text: string): ExtractedValue[] {
  const { values } = extractAllValues(text);
  return values;
}
