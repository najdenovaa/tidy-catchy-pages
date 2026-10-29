import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Send, FlaskConical, Droplets, Zap, Shield, UserCircle, Cable, Ruler, Wrench } from "lucide-react";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import geoladLogo from "@/assets/geolad-logo.png";
import nefteservisLogo from "@/assets/nefteservis-logo.png";
import drillingBanner from "@/assets/drilling-banner.jpg";
import engineeringGraphBg from "@/assets/engineering-graph-bg.mp4";
import HelpLink from "@/components/HelpLink";
import { supabase } from "@/integrations/supabase/client";

const AppleIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
  </svg>
);

const AndroidIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084.0338-.1667.0714-.2493.1092L5.5626 5.5586c-.0943-.1633-.3074-.2209-.4707-.1269-.1634.0943-.2214.3034-.1271.4707L6.9572 9.371C3.7029 11.3036 1.3796 14.9086 1 18.6464h22c-.3796-3.7378-2.7029-7.3428-5.9572-9.2754l1.993-3.4673c.0942-.1673.0362-.3764-.1272-.4707-.1633-.094-.3764-.0364-.4706.1269zm-11.398 6.0078c.6267 0 1.1345.5078 1.1345 1.1345 0 .6266-.5078 1.1344-1.1345 1.1344-.6266 0-1.1344-.5078-1.1344-1.1344 0-.6267.5078-1.1345 1.1344-1.1345zm9.9168 0c.6266 0 1.1344.5078 1.1344 1.1345 0 .6266-.5078 1.1344-1.1344 1.1344-.6267 0-1.1345-.5078-1.1345-1.1344 0-.6267.5078-1.1345 1.1345-1.1345z" />
  </svg>
);

const modules = [
  { title: "Цементирование скважин", description: "Программа цементирования, цементные мосты, анализ качества", icon: FlaskConical, to: "/cementing", available: true },
  { title: "Буровые растворы", description: "Подбор и расчёт буровых растворов", icon: Droplets, to: "/drilling-fluids", available: false },
  { title: "ГНКТ (Coiled Tubing)", description: "Силы, пределы, гидравлика, ресурс усталости", icon: Cable, to: "/coiled-tubing", available: true },
  { title: "Интенсификация добычи (ОПЗ)", description: "Кислотные, пенные, азотные и комбинированные обработки: подбор метода, расчёт, план, прогноз", icon: FlaskConical, to: "/stimulation", available: true },
  { title: "ГРП", description: "Проектирование и расчёт гидроразрыва пласта", icon: Zap, to: "/fracturing", available: false },
  { title: "Проектирование скважины", description: "Проектирование конструкции и траектории скважины", icon: Ruler, to: "/well-design", available: false },
  { title: "КРС — Капитальный ремонт скважин", description: "Пакеры, затяжки, прихваты, ловильные работы, нагрузки на подъёмник", icon: Wrench, to: "/workover", available: true },
];

export default function Home() {
  const [visitCount, setVisitCount] = useState(0);
  const [calcCount, setCalcCount] = useState(0);

  const fetchStats = useCallback(() => {
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-stats`, {
      headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
    })
      .then(r => r.json())
      .then(data => {
        setVisitCount(data.visits ?? 0);
        setCalcCount(data.calculations ?? 0);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    supabase.functions.invoke("log-activity", {
      body: { type: "visit", module: "home", page_url: "/" },
    }).then(() => fetchStats()).catch(() => {});
    fetchStats();
  }, [fetchStats]);

  return (
    <div className="relative min-h-screen bg-background flex flex-col overflow-hidden">
      <video
        className="absolute inset-0 w-full h-full object-cover opacity-20"
        autoPlay muted loop playsInline
      >
        <source src={engineeringGraphBg} type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-background/75" />
      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="border-b border-border bg-card">
          <div className="max-w-5xl mx-auto px-4 py-1 sm:py-2 flex items-center justify-between">
            <div className="flex flex-col items-start gap-0">
              <Link to="/" className="flex flex-col items-start gap-0">
                <div className="flex items-center gap-3 -mt-1 sm:-mt-1">
                  <img src={deallsoftLogo} alt="DeAllsoft" className="h-20 sm:h-28 w-auto object-contain -ml-2 sm:-ml-5" />
                  <p className="text-lg sm:text-2xl font-normal tracking-tight text-foreground uppercase">
                    Инженерные расчёты
                  </p>
                </div>
              </Link>
              <div className="flex flex-col items-start leading-none">
                <span className="text-[10px] sm:text-xs text-muted-foreground italic mb-0.5">при поддержке</span>
                <div className="flex items-center gap-3">
                  <a href="http://geolad.ru/" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
                    <img src={geoladLogo} alt="Геолад" className="h-7 sm:h-9 w-auto object-contain" />
                  </a>
                  <a href="https://nefteserv.ru/" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
                    <img src={nefteservisLogo} alt="Нефтесервис" className="h-6 sm:h-7 w-auto object-contain" />
                  </a>
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 sm:gap-3">
              <HelpLink />
              <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs sm:text-sm">
                <Send className="w-4 h-4" /><span>Поддержка</span>
              </a>
              <Link to="/auth" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs sm:text-sm">
                <UserCircle className="w-4 h-4" /><span>Кабинет</span>
              </Link>
              <Link to="/admin-login" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs sm:text-sm">
                <Shield className="w-4 h-4" /><span>Админ</span>
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-5xl mx-auto px-4 py-10 sm:py-16 w-full">
          <div className="flex items-center justify-center gap-6 text-[11px] text-muted-foreground/70 mb-6">
            <span>👁 Посещений: <span className="font-semibold text-muted-foreground">{visitCount}</span></span>
            <span>🧮 Расчётов: <span className="font-semibold text-muted-foreground">{calcCount}</span></span>
          </div>
          <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-8 text-center">
            Выберите модуль
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {modules.map((m) =>
              m.available ? (
                <Link
                  key={m.to}
                  to={m.to}
                  className="group rounded-xl border border-border bg-card p-6 sm:p-8 flex flex-col items-center text-center gap-4 hover:border-primary/50 hover:shadow-lg transition-all"
                >
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <m.icon className="w-7 h-7 text-primary" />
                  </div>
                  <h3 className="text-base sm:text-lg font-semibold text-foreground">{m.title}</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground">{m.description}</p>
                </Link>
              ) : (
                <div
                  key={m.to}
                  className="rounded-xl border border-border bg-card/50 p-6 sm:p-8 flex flex-col items-center text-center gap-4 opacity-60 cursor-not-allowed"
                >
                  <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                    <m.icon className="w-7 h-7 text-muted-foreground" />
                  </div>
                  <h3 className="text-base sm:text-lg font-semibold text-muted-foreground">{m.title}</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground">{m.description}</p>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 bg-muted px-2 py-0.5 rounded">
                    В разработке
                  </span>
                </div>
              )
            )}
          </div>
        </main>

        <footer className="w-full">
          <div className="bg-card border-t border-border py-6">
            <div className="max-w-5xl mx-auto px-4 text-center space-y-3">
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <a href="https://t.me/deallbiz_bot" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">🧪 Бот химической продукции DeAll</a>
                <span className="text-border">|</span>
                <a href="https://t.me/deallbiz" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">📢 Новостной канал DeAll</a>
                <span className="text-border">|</span>
                <a href="https://apps.apple.com/ru/app/deallsoft/id6793684019" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors">
                  <AppleIcon className="w-3.5 h-3.5" />
                  Приложение в App Store
                </a>
                <span className="text-border">|</span>
                <a href="https://www.rustore.ru/catalog/app/app.rork.w7r61ukk1hg2jt8ys7bgb" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors">
                  <AndroidIcon className="w-3.5 h-3.5" />
                  Приложение Android
                </a>
              </div>
              <div className="pt-2 border-t border-border/50">
                <Link to="/terms" className="text-xs text-muted-foreground hover:text-primary transition-colors">
                  Пользовательское соглашение и Политика конфиденциальности
                </Link>
              </div>
            </div>
          </div>
          <img src={drillingBanner} alt="Буровые установки" className="w-full h-20 sm:h-28 object-cover object-center opacity-30" />
        </footer>
      </div>
    </div>
  );
}
