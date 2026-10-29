import { Link } from "react-router-dom";
import { ArrowLeft, Home, FileDown, Send, FlaskConical, Shield, Cable, Droplets, Wrench, BookOpen } from "lucide-react";
import deallsoftLogo from "@/assets/deallsoft-logo.png";

const PDF_URL = "/docs/deallsoft-quick-start.pdf";

const modules = [
  {
    icon: FlaskConical,
    title: "Программа цементирования",
    to: "/cementing/program",
    text: "Обсадные колонны: объёмы, гидравлика, давления и ЭЦП по глубине, порядок закачки, материалы, проверка по ПБ НГП, выгрузка программы в Word.",
    tips: [
      "Нажмите «Загрузить пример» — подставится скважина из руководства.",
      "После любых изменений нажимайте «РАСЧЁТ» — графики обновляются только по этой кнопке.",
      "Порядок растворов: первый в списке — верхний, он же закачивается первым.",
    ],
  },
  {
    icon: Shield,
    title: "Цементные мосты",
    to: "/cementing/plugs",
    text: "Мосты в открытом стволе, в колонне и РИР: балансировка, недопродавка, устойчивость моста против «провала», рецептура, опорная пачка, 3D-модель оседания.",
    tips: [
      "Сначала выберите тип установки: открытый ствол, колонна или РИР.",
      "Карточка «Устойчивость моста» показывает, удержится ли цемент на лёгкой жидкости.",
      "«Автоподбор конструкции» переберёт плотность, длину и опору за вас.",
    ],
  },
  {
    icon: Cable,
    title: "ГНКТ",
    to: "/coiled-tubing",
    text: "Дохождение, вес на индикаторе, изгиб, гидравлика, прочность, усталость, сравнение с фактом, программа работ в Word.",
    tips: [
      "Начните с «Библиотеки операций» — подставятся типовые расход, жидкость и КНБК.",
      "Проверьте зазор: наружный диаметр трубы должен быть заметно меньше внутреннего диаметра НКТ.",
      "Вкладка «Сводка» собирает главное и даёт программу по шагам.",
    ],
  },
  {
    icon: Droplets,
    title: "Интенсификация (ОПЗ)",
    to: "/stimulation",
    text: "Диагностика повреждения пласта, подбор метода, расчёт кислотной, пенной или азотной обработки, график закачки, прогноз дебита и экономика.",
    tips: [
      "Идите по вкладкам слева направо: Диагностика → Метод → Расчёт → План → Прогноз → Отчёт.",
      "Метод с наибольшим баллом подходит лучше всего, но выбрать можно любой.",
      "Цены, НДПИ и затраты в «Прогнозе» замените на актуальные для месторождения.",
    ],
  },
  {
    icon: Wrench,
    title: "КРС",
    to: "/workover",
    text: "Пакеры (перемещения и силы по Lubinski), глушение, затяжки и T&D, прихваты, ловильные работы, промывка, освоение, нагрузки на подъёмник.",
    tips: [
      "Общие данные скважины и колонны вверху используются во всех вкладках.",
      "«Сводка нагрузок» сразу показывает запас подъёмника и НКТ.",
      "Кнопка «Отчёт PDF» выгружает расчёт в документ.",
    ],
  },
];

const faq = [
  ["Изменил данные, а графики старые.", "Графики и таблицы обновляются по кнопке «РАСЧЁТ». Подсказки у полей ввода — приближённая экспресс-оценка."],
  ["Пропал расчёт.", "Без сохранения данные хранятся только во вкладке браузера. Сохраняйте расчёт в кабинет или выгружайте документ."],
  ["Поле не принимает число.", "Используйте точку как десятичный разделитель: 1.45."],
  ["Насколько можно доверять расчётам?", "Модели основаны на отраслевых методиках и стандартах (API, ПБ НГП). Результаты носят информационный характер и не заменяют утверждённый проект."],
];

export default function Help() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-3">
            <img src={deallsoftLogo} alt="DeAllsoft" className="h-10 sm:h-14 object-cover object-center" />
            <p className="text-base sm:text-lg font-normal tracking-tight text-foreground uppercase">Справка</p>
          </Link>
          <div className="flex items-center gap-3">
            <button onClick={() => window.history.back()} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
              <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Назад</span>
            </button>
            <Link to="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
              <Home className="w-4 h-4" /> <span className="hidden sm:inline">Главная</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto px-4 py-8 w-full space-y-8">
        <section className="rounded-xl bg-[#152039] text-white p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div>
            <p className="text-xs uppercase tracking-widest text-lime-300 font-semibold mb-2">Руководство пользователя</p>
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">Быстрый старт</h1>
            <p className="text-sm text-slate-300 max-w-xl">
              Первый расчёт за 15 минут: пять сквозных примеров — программа цементирования, цементный мост, ГНКТ, ОПЗ и КРС. С экранами, пояснениями и тем, как читать результаты.
            </p>
          </div>
          <a
            href={PDF_URL}
            download
            className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-lime-300 text-[#152039] font-semibold text-sm hover:bg-lime-200 transition-colors"
          >
            <FileDown className="w-4 h-4" /> Скачать PDF
          </a>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center gap-2"><BookOpen className="w-5 h-5" /> Модули</h2>
          <p className="text-sm text-muted-foreground mb-4">Расчёты бесплатны и не требуют регистрации. Аккаунт нужен, чтобы сохранять расчёты и загружать документы.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {modules.map((m) => (
              <div key={m.to} className="rounded-xl border border-border bg-card p-5 flex flex-col">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center"><m.icon className="w-5 h-5 text-primary" /></div>
                  <h3 className="font-semibold text-foreground">{m.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-3">{m.text}</p>
                <ul className="text-sm space-y-1.5 mb-4 list-disc pl-5 text-foreground/90">
                  {m.tips.map((t) => <li key={t}>{t}</li>)}
                </ul>
                <Link to={m.to} className="mt-auto self-start text-sm font-semibold text-primary hover:underline">Открыть модуль →</Link>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Частые вопросы</h2>
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {faq.map(([q, a]) => (
              <div key={q} className="p-4">
                <p className="font-medium text-foreground text-sm">{q}</p>
                <p className="text-sm text-muted-foreground mt-1">{a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-foreground">Не нашли ответ или нашли ошибку?</p>
            <p className="text-sm text-muted-foreground">Напишите в поддержку — разбираем каждое обращение.</p>
          </div>
          <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
            <Send className="w-4 h-4" /> Поддержка в Telegram
          </a>
        </section>
      </main>
    </div>
  );
}
