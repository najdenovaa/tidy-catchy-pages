export type ReportScope='cementing'|'centralization'|'running';
const CEMENTING=[
 ['pvtHydrostatics','PVT-гидростатика: сравнение и профили'],['stopStorage','Сжатие после посадки: расчёт и график'],['rheology','Реология: модели, замеры и графики'],['inputs','Исходные данные'],['hydraulics','Расчёт объёмов и гидравлики'],['schedule','Программа закачки'],['materials','Ведомость: цементы, химия, оснастка'],['lab','Рецептура и лабораторные требования'],['norms','Проверки ограничений'],['logistics','Техника, люди и график работ'],['risks','Вероятностная оценка риска'],['pressureTable','Таблица плана продавки'],['chartData','Числовые данные графиков'],['woc','ОЗЦ'],
 ['combined','Совмещённый график цементирования'],['pressures','Давления во времени'],['rate','Расход закачки и выход на устье'],['ecdTime','ЭЦП во времени: забой и башмак'],['depthPressure','Огибающие давления по глубине'],['depthEcd','ЭЦП по глубине'],['volumePressure','Объём и давление'],['safeRate','План продавки: давления и безопасный расход'],['flowRegime','Рейнольдс и режим потока'],['annularFill','Состав затрубного пространства'],['construction','Конструкция и интервалы цемента'],['trajectory','Объёмная проекция траектории'],['basket','Корзины после Стоп'],['fleetLayout','Схема расстановки техники'],['displacementSummary','Таблицы и показатели замещения'],['displacement3D','3D-кадры замещения'],['displacementMap','Карты состава замещения'],['relatedModules','Дополнительные расчёты цементажа'],
] as const;
const CENTRALIZATION=[['inputs','Данные колонны и траектории'],['materials','Наименования и количество центраторов'],['placement','Потрубная расстановка'],['standoff','Профиль Standoff'],['loads','Нагрузки и прогибы'],['clearance','Расчётные зазоры и сжатие планок'],['centralizer3D','3D: центратор в стволе'],['centralizerSection','Поперечные сечения рессор'],['bladeProfile','Продольные профили прогиба планок'],['trajectory','Объёмная проекция траектории']] as const;
const RUNNING=[['inputs','Данные колонны и параметры спуска'],['materials','Наименования и количество оснастки'],['runningLoads','Нагрузки, ограничения и контроль дохождения'],['broom','Веник по глубине башмака'],['forceProfile','Профиль осевых сил по колонне'],['torque','Сухой момент вращения по глубине спуска'],['measurements','Фактические замеры и подбор трения'],['trajectory','Объёмная проекция траектории']] as const;
export const REPORT_ITEMS:Record<ReportScope,readonly (readonly [ReportItem,string])[]>={cementing:CEMENTING,centralization:CENTRALIZATION,running:RUNNING};
export type ReportItem=typeof CEMENTING[number][0]|typeof CENTRALIZATION[number][0]|typeof RUNNING[number][0];
export type ReportSelection=Partial<Record<ReportItem,boolean>>;
export const REPORT_SCOPE_TITLES:Record<ReportScope,string>={cementing:'Программа цементирования',centralization:'Расчёт центрирования',running:'Расчёт дохождения колонны'};
export const reportIncludes=(selection:ReportSelection|undefined,item:ReportItem)=>selection?.[item]!==false;
export const defaultReportSelection=(scope:ReportScope):ReportSelection=>Object.fromEntries(REPORT_ITEMS[scope].map(([key])=>[key,true]));
export function reportFigureItem(title:string):ReportItem|undefined {
 if(/веник/i.test(title))return'broom';if(/^Профиль осевых/.test(title))return'forceProfile';if(/^Момент при спуске/.test(title))return'torque';
 if(/^Центратор на/.test(title))return'centralizer3D';if(/^Сечение через/.test(title))return'centralizerSection';if(/^Продольный профиль/.test(title))return'bladeProfile';if(/^Профиль Standoff/.test(title))return'standoff';
 if(/^Замещение: 3D/.test(title))return'displacement3D';if(/^Карта состава/.test(title))return'displacementMap';
 if(/^Траектория/.test(title))return'trajectory';if(/^Конструкция/.test(title))return'construction';if(/^Корзина:/.test(title))return'basket';if(/^Схема расстановки/.test(title))return'fleetLayout';
 return undefined;
}
export function allowedReportFigure(scope:ReportScope,selection:ReportSelection|undefined,figure:{title:string;reportItem?:ReportItem}):boolean {
 const key=figure.reportItem??reportFigureItem(figure.title);return !!key&&REPORT_ITEMS[scope].some(([item])=>item===key)&&reportIncludes(selection,key);
}

const GRAPHICS=new Set<ReportItem>(['combined','pressures','rate','ecdTime','depthPressure','depthEcd','volumePressure','safeRate','flowRegime','annularFill','construction','trajectory','basket','fleetLayout','displacement3D','displacementMap','standoff','centralizer3D','centralizerSection','bladeProfile','broom','forceProfile','torque']);
export function missingReportFigures(scope:ReportScope,selection:ReportSelection|undefined,figures:{title:string;reportItem?:ReportItem}[]):string[]{
 const found=new Set(figures.map(f=>f.reportItem??reportFigureItem(f.title)));
 return REPORT_ITEMS[scope].filter(([key])=>GRAPHICS.has(key)&&reportIncludes(selection,key)&&!found.has(key)).map(([,label])=>label+': нет актуальных данных для изображения.');
}
